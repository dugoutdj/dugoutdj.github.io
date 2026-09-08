import { useState, useEffect, useRef } from 'react';
import { formatTime, extractVideoId, fetchVideoInfo, getVideoDuration, loadYouTubeAPI } from '../utils/youtube';
import { searchTracks, trimToWindow } from '../utils/previewDownloader';
import { clipUrl, readAudioDuration, uploadClip, deleteClip } from '../utils/mp3';
import { mediaProxy } from '../utils/media';
import { sortHistory, songComboKey } from '../utils/songHistory';
import { playAnnouncement, stopAnnouncement } from '../utils/announcer';
import './PlayerForm.css';

// The Apple preview is 30 seconds; the walk-up window is a selectable slice
// inside it (5-15 seconds, start can be 0-25s).
const PREVIEW_SECONDS = 30;
const WINDOW_SECONDS = 10; // default window length
const MIN_WINDOW = 5;
const MAX_WINDOW = 15;
const MAX_START = PREVIEW_SECONDS - MIN_WINDOW;
// YouTube songs can be several minutes long. When the exact video length
// can't be read (offline, bot check), the slider track still spans this
// generous default so any portion of the song can be selected.
const YT_FALLBACK_SECONDS = 300; // 5 minutes

// Format seconds as "m:ss" (or "h:mm:ss" for an hour+); plain seconds under
// a minute reads cleaner. Used to display/seed the YouTube start field.
const formatStartText = (secs) => {
  const s = Math.max(0, Math.floor(secs || 0));
  if (s < 60) return String(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
};

// Parse "1:35", "1:02:05", or plain seconds ("95") into total seconds.
// Returns null when the text is not a valid time (keeps the previous value).
const parseStartText = (text) => {
  const t = (text || '').trim();
  if (!t) return 0;
  if (t.includes(':')) {
    const parts = t.split(':').map((p) => p.trim());
    if (parts.length > 3 || parts.some((p) => p === '' || !/^\d+$/.test(p))) return null;
    let total = 0;
    let mult = 1;
    for (let i = parts.length - 1; i >= 0; i--) {
      total += parseInt(parts[i], 10) * mult;
      mult *= 60;
    }
    return total;
  }
  if (!/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
};

export default function PlayerForm({ player, onSave, onCancel, songOnly = false, lockScroll = true }) {
  const [formData, setFormData] = useState({
    name: '',
    pronounced: '',
    number: '',
    songUrl: '',
    songSource: '', // 'apple' ('' = legacy/unset)
    songVideoId: '',
    appleTrackId: '',
    previewUrl: '',
    artworkUrl: '',
    songTitle: '',
    songThumbnail: '',
    mp3Key: '',
    startTime: 0,
    duration: 10
  });
  const [appleQuery, setAppleQuery] = useState('');
  const [appleResults, setAppleResults] = useState([]);
  const [appleSearching, setAppleSearching] = useState(false);
  const [appleError, setAppleError] = useState(null);
  // YouTube URL paste (the full-song alternative to the 30s Apple preview).
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeError, setYoutubeError] = useState(null);
  // Known length of the loaded YouTube video, so the slider track spans the
  // whole song (null = still reading, 0 = couldn't read -> numeric fallback).
  const [ytDuration, setYtDuration] = useState(null);
  const ytDurationVideoRef = useRef(''); // guard against stale async results
  // Raw text of the YouTube start input, so the user can type "1:35" (m:ss)
  // or plain seconds while the stored value stays in seconds for playback.
  const [ytStartText, setYtStartText] = useState('0');
  // Hidden YT player used to preview a YouTube walk-up window.
  const ytPreviewPlayerRef = useRef(null);
  const ytPreviewTimerRef = useRef(null);

  // The walk-up window model is shared by both sources: a window of
  // [start, start+duration) over the source's total length. Apple caps the
  // track at the 30s preview; YouTube spans the full video.
  const isApple = formData.songSource === 'apple';
  const isYouTube = !isApple && !!formData.songVideoId;
  const isMp3 = formData.songSource === 'mp3';
  const totalSeconds = isApple
    ? PREVIEW_SECONDS
    : (isMp3
      ? (mp3Duration > 0 ? mp3Duration : 0)
      : ((ytDuration && ytDuration > 0) ? ytDuration : YT_FALLBACK_SECONDS));
  const maxStart = Math.max(0, totalSeconds - MIN_WINDOW);
  // Set while a handle is being dragged, so the wrapper's click-to-move
  // doesn't fire from the click that ends a drag.
  const draggingRef = useRef(false);
  const trackRef = useRef(null);
  // Live preview of the selected walk-up window (played from previewUrl).
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef(null);
  // Live preview of the "Now batting, ...!" announcement.
  const [announcePreviewing, setAnnouncePreviewing] = useState(false);
  // Uploaded MP3 source: the picked file (kept in memory only), its decoded
  // duration, and a local object URL for previewing before save.
  const [mp3File, setMp3File] = useState(null);      // { blob, name }
  const [mp3Duration, setMp3Duration] = useState(0);
  const [mp3ObjectUrl, setMp3ObjectUrl] = useState(null);
  const [mp3Error, setMp3Error] = useState(null);
  const [mp3Uploading, setMp3Uploading] = useState(false);
  // Previous song+window picker (collapsed by default).
  const [showHistory, setShowHistory] = useState(false);

  // Drop any in-memory MP3 selection (switching to Apple/YouTube, unmount).
  const clearMp3Selection = () => {
    if (mp3ObjectUrl) URL.revokeObjectURL(mp3ObjectUrl);
    setMp3File(null);
    setMp3Duration(0);
    setMp3ObjectUrl(null);
    setMp3Error(null);
  };

  useEffect(() => {
    if (player) {
      // Clamp legacy values into the 30s preview / 5-15s window model.
      let start = player.songSource === 'apple'
        ? Math.min(player.startTime || 0, MAX_START)
        : player.startTime || 0;
      let duration = player.songSource === 'apple'
        ? Math.max(MIN_WINDOW, Math.min(MAX_WINDOW, player.duration || WINDOW_SECONDS))
        : player.duration || 10;
      if (player.songSource === 'apple' && start + duration > PREVIEW_SECONDS) {
        duration = PREVIEW_SECONDS - start;
      }
      setFormData({
        ...player,
        pronounced: player.pronounced || player.name || '',
        startTime: start,
        duration
      });
      // Editing an existing YouTube player: read its length so the slider
      // track matches the full video, and warm the preview player.
      if (player.songVideoId && player.songSource !== 'apple') {
        setYtDuration(null);
        ytDurationVideoRef.current = player.songVideoId;
        setYtStartText(formatStartText(player.startTime || 0));
        getVideoDuration(player.songVideoId).then((d) => {
          if (ytDurationVideoRef.current === player.songVideoId) setYtDuration(d);
        });
        getYtPreviewPlayer().catch(() => {});
      }
    }
  }, [player]);

  // Close on Escape; lock page scroll while the modal is open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    // Lock page scroll only when rendered as a modal (coach side). The
    // parent page renders the form inline, where the page itself must scroll.
    const prevOverflow = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      if (lockScroll) document.body.style.overflow = prevOverflow;
    };
  }, [onCancel, lockScroll]);

  // Revoke the preview object URL when it is replaced or the form unmounts.
  useEffect(() => {
    return () => {
      if (mp3ObjectUrl) URL.revokeObjectURL(mp3ObjectUrl);
    };
  }, [mp3ObjectUrl]);

  // Debounced live search against the catalog. The 700ms debounce keeps
  // fast typing to a single request (per-keystroke bursts tripped Apple's
  // rate limiter on the server), and 2+ chars avoids useless one-letter
  // searches. Results from a superseded query are dropped.
  const latestQueryRef = useRef('');
  useEffect(() => {
    const q = appleQuery.trim();
    if (q.length < 2) {
      latestQueryRef.current = '';
      setAppleResults([]);
      setAppleError(null);
      return;
    }
    latestQueryRef.current = q;

    const timer = setTimeout(async () => {
      setAppleSearching(true);
      setAppleError(null);
      try {
        const results = await searchTracks(q);
        if (latestQueryRef.current !== q) return; // a newer query won
        setAppleResults(results);
      } catch (err) {
        if (latestQueryRef.current !== q) return;
        console.error('Song search error:', err);
        setAppleError(err.message || 'Search failed. Please try again.');
      } finally {
        if (latestQueryRef.current === q) setAppleSearching(false);
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [appleQuery]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!songOnly && !formData.name.trim()) {
      alert('Please enter a player name');
      return;
    }
    if (mp3Uploading) return;

    // The walk-up window lives entirely in formData (startTime + duration),
    // set by the slider above.
    const startTime = Math.max(0, formData.startTime || 0);
    const duration = Math.max(1, formData.duration || WINDOW_SECONDS);
    let data = { ...formData, startTime, duration };

    // MP3 songs: cut the picked file to the walk-up window and upload ONLY
    // that snippet to R2. Re-selecting a file replaces the previous clip.
    if (data.songSource === 'mp3') {
      if (mp3File) {
        setMp3Uploading(true);
        try {
          const { blob } = await trimToWindow(mp3File.blob, startTime, duration);
          const { key } = await uploadClip(blob);
          const oldKey = formData.mp3Key;
          data = { ...data, mp3Key: key };
          if (oldKey && oldKey !== key) {
            deleteClip(oldKey).catch(() => {});
          }
        } catch (err) {
          setMp3Error(err.message || 'Upload failed — try again.');
          return;
        } finally {
          setMp3Uploading(false);
        }
      } else if (!data.mp3Key) {
        // No file and no existing clip — nothing to save.
        alert('Select an MP3 file first.');
        return;
      }
    }

    onSave(data);
  };

  const selectAppleTrack = (track) => {
    setFormData((prev) => ({
      ...prev,
      songSource: 'apple',
      songUrl: track.trackViewUrl || '',
      songVideoId: '',
      songThumbnail: '',
      appleTrackId: track.trackId,
      previewUrl: track.previewUrl,
      artworkUrl: track.artworkUrl,
      songTitle: `${track.artistName} - ${track.trackName}`,
      mp3Key: '',
      startTime: 0,
      duration: WINDOW_SECONDS
    }));
    setAppleQuery('');
    setAppleResults([]);
    clearMp3Selection();
  };

  // Load a pasted YouTube link: extract the video id, fetch its title and
  // thumbnail, and store it as the player's song. Parents/coaches pick the
  // exact walk-up window with the start/length inputs below the preview.
  const handleLoadYouTube = async () => {
    const videoId = extractVideoId(youtubeUrl.trim());
    if (!videoId) {
      setYoutubeError("That doesn't look like a valid YouTube link.");
      return;
    }
    setYoutubeLoading(true);
    setYoutubeError(null);
    try {
      const info = await fetchVideoInfo(videoId);
      if (!info) {
        setYoutubeError("Couldn't load that video \u2014 check the link and try again.");
        return;
      }
      setFormData((prev) => ({
        ...prev,
        songSource: 'youtube',
        songUrl: `https://www.youtube.com/watch?v=${videoId}`,
        songVideoId: videoId,
        songTitle: info.title || prev.songTitle,
        songThumbnail: info.thumbnail || '',
        appleTrackId: '',
        previewUrl: '',
        artworkUrl: '',
        mp3Key: '',
        startTime: 0,
        duration: WINDOW_SECONDS
      }));
      clearMp3Selection();
      setYoutubeUrl('');
      // Read the video's length so the slider track spans the whole song,
      // and warm the hidden preview player (iOS needs it ready for the tap).
      setYtDuration(null);
      ytDurationVideoRef.current = videoId;
      setYtStartText('0');
      getVideoDuration(videoId).then((d) => {
        if (ytDurationVideoRef.current === videoId) setYtDuration(d);
      });
      getYtPreviewPlayer().catch(() => {});
    } catch {
      setYoutubeError("Couldn't load that video \u2014 check the link and try again.");
    } finally {
      setYoutubeLoading(false);
    }
  };

  // Pick an audio file to use as the walk-up song. Only its duration is
  // read here (to size the window slider); the 5-15s clip is trimmed and
  // uploaded on Save, so the full file never leaves this device.
  const handleMp3File = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    stopPreview();
    const looksAudio = /^audio\//.test(file.type || '') ||
      /\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(file.name || '');
    if (!looksAudio) {
      setMp3Error('Please choose an audio file (MP3, M4A, WAV, …).');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setMp3Error('That file is larger than 30 MB — try a shorter clip.');
      return;
    }
    setMp3Error(null);
    try {
      const duration = await readAudioDuration(file);
      if (!duration || duration < MIN_WINDOW) {
        setMp3Error("Couldn't read that audio file — is it a valid song?");
        return;
      }
      if (mp3ObjectUrl) URL.revokeObjectURL(mp3ObjectUrl);
      const title = (file.name || 'Uploaded song')
        .replace(/\.[^.]+$/, '')
        .replace(/[-_]+/g, ' ')
        .trim() || 'Uploaded song';
      setMp3File({ blob: file, name: file.name });
      setMp3Duration(duration);
      setMp3ObjectUrl(URL.createObjectURL(file));
      setAppleResults([]);
      setAppleError(null);
      setYoutubeError(null);
      setFormData((prev) => ({
        ...prev,
        songSource: 'mp3',
        songUrl: '',
        songVideoId: '',
        appleTrackId: '',
        previewUrl: '',
        artworkUrl: '',
        songThumbnail: '',
        mp3Key: '',
        songTitle: title,
        startTime: 0,
        duration: WINDOW_SECONDS
      }));
    } catch {
      setMp3Error("Couldn't read that audio file — is it a valid song?");
    }
  };

  // Slide/resize the walk-up window within the source's total length
  // (30s Apple preview, or the full YouTube video).
  const handleStartChange = (value) => {
    // Stop any live preview so it doesn't keep playing the old window.
    stopPreview();
    // Moving the left edge keeps the right edge fixed (resizes the window);
    // only when a min/max clamp kicks in does the right edge move along.
    let start = Math.max(0, Math.min(maxStart, Number(value) || 0));
    const currentEnd = Math.min(
      (formData.startTime || 0) + Math.max(MIN_WINDOW, Math.min(MAX_WINDOW, formData.duration || WINDOW_SECONDS)),
      totalSeconds
    );
    let duration = currentEnd - start;
    if (duration < MIN_WINDOW) {
      start = currentEnd - MIN_WINDOW;
      duration = MIN_WINDOW;
    } else if (duration > MAX_WINDOW) {
      start = currentEnd - MAX_WINDOW;
      duration = MAX_WINDOW;
    }
    start = Math.max(0, start);
    setFormData((prev) => ({ ...prev, startTime: start, duration }));
  };

  const handleEndChange = (value) => {
    // Stop any live preview so it doesn't keep playing the old window.
    stopPreview();
    let end = Math.max(MIN_WINDOW, Math.min(totalSeconds, Number(value) || WINDOW_SECONDS));
    let start = Math.max(0, Math.min(maxStart, formData.startTime || 0));
    let duration = end - start;
    if (duration < MIN_WINDOW) {
      start = end - MIN_WINDOW;
      duration = MIN_WINDOW;
    } else if (duration > MAX_WINDOW) {
      start = end - MAX_WINDOW;
      duration = MAX_WINDOW;
    }
    start = Math.max(0, start);
    setFormData((prev) => ({ ...prev, startTime: start, duration }));
  };

  // Helper: attach pointer-move/up to resize or slide the window.
  const startDrag = (onMove) => (e) => {
    e.stopPropagation();
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
    draggingRef.current = true;
    const move = (ev) => {
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      onMove(pct);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setTimeout(() => { draggingRef.current = false; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Lazily create the hidden YouTube player used to preview a YouTube
  // walk-up window (Apple previews use a plain <audio> element instead).
  const getYtPreviewPlayer = () => {
    if (ytPreviewPlayerRef.current) return Promise.resolve(ytPreviewPlayerRef.current);
    return loadYouTubeAPI().then((YT) => {
      if (ytPreviewPlayerRef.current) return ytPreviewPlayerRef.current;
      return new Promise((resolve) => {
        let host = document.getElementById('player-form-yt-preview');
        if (!host) {
          host = document.createElement('div');
          host.id = 'player-form-yt-preview';
          host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
          document.body.appendChild(host);
        }
        let player = null;
        try {
          player = new YT.Player(host, {
            height: '1',
            width: '1',
            playerVars: {
              controls: 0,
              disablekb: 1,
              modestbranding: 1,
              playsinline: 1
            },
            events: {
              onReady: () => {
                ytPreviewPlayerRef.current = player;
                resolve(player);
              },
              onError: () => resolve(null)
            }
          });
        } catch {
          resolve(null);
        }
        // Safety net: don't hang callers if the API never fires onReady.
        setTimeout(() => resolve(ytPreviewPlayerRef.current || null), 15000);
      });
    }).catch(() => null);
  };

  // Stop any running preview when the form unmounts.
  useEffect(() => {
    return () => {
      stopAnnouncement();
      if (ytPreviewTimerRef.current) {
        clearInterval(ytPreviewTimerRef.current);
        ytPreviewTimerRef.current = null;
      }
      const yt = ytPreviewPlayerRef.current;
      if (yt && typeof yt.destroy === 'function') yt.destroy();
      ytPreviewPlayerRef.current = null;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
    };
  }, []);

  // Live-play the currently selected window (startTime → startTime+duration)
  // from the Apple preview, so parents can hear exactly what will play.
  const stopPreview = () => {
    // Stop a YouTube preview if one is running.
    if (ytPreviewTimerRef.current) {
      clearInterval(ytPreviewTimerRef.current);
      ytPreviewTimerRef.current = null;
    }
    const yt = ytPreviewPlayerRef.current;
    if (yt && typeof yt.pauseVideo === 'function') yt.pauseVideo();
    // Stop an Apple <audio> preview if one is running.
    const audio = audioRef.current;
    if (audio) audio.pause();
    setPreviewing(false);
  };

  // Play the selected walk-up window through the hidden YouTube player.
  const playYtPreview = async (start, duration) => {
    const yt = await getYtPreviewPlayer();
    if (!yt || !formData.songVideoId) {
      setPreviewing(false);
      return;
    }
    const end = start + duration;
    try {
      yt.loadVideoById({ videoId: formData.songVideoId, startSeconds: start });
      yt.playVideo();
      setPreviewing(true);
      // Poll the playback position and stop exactly at start + duration.
      if (ytPreviewTimerRef.current) clearInterval(ytPreviewTimerRef.current);
      ytPreviewTimerRef.current = setInterval(() => {
        let t = 0;
        try { t = yt.getCurrentTime(); } catch { /* player busy */ }
        if (t >= end) {
          if (ytPreviewTimerRef.current) {
            clearInterval(ytPreviewTimerRef.current);
            ytPreviewTimerRef.current = null;
          }
          if (typeof yt.pauseVideo === 'function') yt.pauseVideo();
          setPreviewing(false);
        }
      }, 100);
    } catch {
      setPreviewing(false);
    }
  };

  const togglePreview = () => {
    if (previewing) {
      stopPreview();
      return;
    }
    // Don't let the song and announcement play at the same time.
    stopAnnouncePreview();
    const start = Math.max(0, Number(formData.startTime) || 0);
    const duration = Math.max(1, Number(formData.duration) || WINDOW_SECONDS);

    // YouTube songs preview through the hidden YT player.
    if (isYouTube && formData.songVideoId) {
      playYtPreview(start, duration);
      return;
    }
    // Uploaded MP3 clips: a freshly picked file previews from the local
    // object URL at [start, start+duration); an already-saved clip is
    // already cut to the window and plays from 0:00.
    if (isMp3) {
      const src = mp3ObjectUrl || (formData.mp3Key ? clipUrl(formData.mp3Key) : null);
      if (!src) return;
      playAudioWindow(src, mp3ObjectUrl ? start : 0, duration);
      return;
    }
    if (!formData.previewUrl) return;
    playAudioWindow(mediaProxy(formData.previewUrl), start, duration);
  };

  // Play [from, from+length) of an audio URL through the shared audio
  // element, stopping exactly at the end of the walk-up window.
  const playAudioWindow = (src, from, length) => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      audioRef.current = audio;
    }
    const audio = audioRef.current;
    const end = from + length;

    audio.src = src;
    audio.currentTime = from;
    audio.volume = 1;

    const onTime = () => {
      if (audio.currentTime >= end) {
        audio.pause();
        setPreviewing(false);
      }
    };
    const onEnd = () => setPreviewing(false);
    const onError = () => setPreviewing(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('error', onError, { once: true });

    const cleanup = () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('error', onError);
    };
    audio.onpause = () => {
      if (audio.currentTime >= end || audio.ended) cleanup();
    };

    const playPromise = audio.play();
    if (playPromise && playPromise.catch) playPromise.catch(() => setPreviewing(false));
    setPreviewing(true);
  };

  // Live-play "Now batting, <pronounced>!" so the coach/parent can hear
  // exactly how the announcer will sound before saving.
  const stopAnnouncePreview = () => {
    stopAnnouncement();
    setAnnouncePreviewing(false);
  };

  const toggleAnnouncePreview = () => {
    if (announcePreviewing) {
      stopAnnouncePreview();
      return;
    }
    const name = (formData.pronounced || formData.name || '').trim();
    if (!name) return;
    // Don't let the song and announcement play at the same time.
    stopPreview();
    setAnnouncePreviewing(true);
    // playAnnouncement resolves when the clip finishes (or is skipped).
    playAnnouncement(name, formData.number).then(() => setAnnouncePreviewing(false));
  };

  // --- Previous song+window history -------------------------------------
  // Every distinct (song, start, duration) the player has used, most-played
  // first. Shown inside the song picker so the coach or a parent can restore
  // an exact past selection with one tap.
  const historyRows = sortHistory(player?.history).filter((h) => h && h.songTitle);

  const isActiveHistoryEntry = (entry) => (
    String(entry?.appleTrackId || '') === String(formData.appleTrackId || '') &&
    String(entry?.songVideoId || '') === String(formData.songVideoId || '') &&
    String(entry?.mp3Key || '') === String(formData.mp3Key || '') &&
    Math.floor(Number(entry?.startTime) || 0) === Math.floor(Number(formData.startTime) || 0) &&
    Math.floor(Number(entry?.duration) || 0) === Math.floor(Number(formData.duration) || 0)
  );

  // Restore a previous song+window combo into the form. The user still hits
  // Save to apply it to the player.
  const applyHistoryEntry = (entry) => {
    stopPreview();
    stopAnnouncePreview();
    const isMp3 = entry.songSource === 'mp3' && !!entry.mp3Key;
    const isYt = Boolean(entry.songVideoId) && entry.songSource !== 'apple' && !isMp3;
    setFormData((prev) => ({
      ...prev,
      songSource: isYt ? 'youtube' : (isMp3 ? 'mp3' : 'apple'),
      songVideoId: entry.songVideoId || '',
      mp3Key: entry.mp3Key || '',
      appleTrackId: entry.appleTrackId || '',
      songUrl: entry.songUrl || '',
      previewUrl: entry.previewUrl || '',
      artworkUrl: entry.artworkUrl || '',
      songThumbnail: entry.songThumbnail || '',
      songTitle: entry.songTitle || prev.songTitle,
      startTime: Number(entry.startTime) || 0,
      duration: Math.max(1, Number(entry.duration) || WINDOW_SECONDS)
    }));
    if (isYt) {
      // Re-read the video's length so the manual start/length fields show
      // sensible limits, and warm the hidden preview player (iOS).
      setYtDuration(null);
      ytDurationVideoRef.current = entry.songVideoId;
      setYtStartText(formatStartText(Number(entry.startTime) || 0));
      getVideoDuration(entry.songVideoId).then((d) => {
        if (ytDurationVideoRef.current === entry.songVideoId) setYtDuration(d);
      });
      getYtPreviewPlayer().catch(() => {});
    }
    setShowHistory(false);
  };

  // Window geometry over the source's total length (30s Apple preview, or
  // the full YouTube video). The slider is used for Apple songs; YouTube
  // songs use manual start/length inputs instead (a multi-minute track makes
  // a slider too coarse to pick a 15s window).
  // The slider works when the source's exact length is known: the 30s Apple
  // preview, or a freshly picked MP3 file. Existing MP3 clips (already cut)
  // show a locked summary; YouTube songs keep the manual inputs.
  const sliderUsable = isApple || (isMp3 && !!mp3File);
  const windowStart = Math.min(formData.startTime || 0, Math.max(0, maxStart));
  const windowDuration = Math.max(MIN_WINDOW, Math.min(MAX_WINDOW, formData.duration || WINDOW_SECONDS));
  const windowEnd = Math.min(windowStart + windowDuration, totalSeconds);
  const windowStartPct = totalSeconds > 0 ? (windowStart / totalSeconds) * 100 : 0;
  const windowEndPct = totalSeconds > 0 ? (windowEnd / totalSeconds) * 100 : 0;

  return (
    <div className="player-form">
      <form onSubmit={handleSubmit}>

        {!songOnly && (
          <div className="form-group">
            <label>Player Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="input"
              placeholder="Enter player name"
              required
            />
          </div>
        )}


        {!songOnly && (
          <div className="form-group">
            <label>Jersey Number</label>
            <input
              type="text"
              value={formData.number}
              onChange={(e) => setFormData({ ...formData, number: e.target.value })}
              className="input"
              placeholder="Optional"
            />
          </div>
        )}

        <div className="form-group">
          <label>Pronounced</label>
          <input
            type="text"
            value={formData.pronounced || ''}
            onChange={(e) => setFormData({ ...formData, pronounced: e.target.value })}
            className="input"
            placeholder="How the announcer says the name"
          />
          <small className="form-hint">
            Used for "Now batting, …!" — defaults to the player name, edit only if the name needs phonetic help.
          </small>
          <button
            type="button"
            className={`announce-preview-btn${announcePreviewing ? ' is-playing' : ''}`}
            onClick={toggleAnnouncePreview}
            disabled={!(formData.pronounced || formData.name || '').trim()}
            aria-label={announcePreviewing ? 'Stop announcement preview' : 'Preview announcement'}
          >
            {announcePreviewing ? '⏹ Stop preview' : '🔊 Preview announcement'}
          </button>
        </div>

        <div className="form-group">
          <label>Song</label>
          <div className="song-source-box">
          <div className="apple-search-box">
            <input
              type="text"
              value={appleQuery}
              onChange={(e) => setAppleQuery(e.target.value)}
              className="input"
              placeholder="Search Apple Music for a song..."
            />
            {appleSearching && (
              <span className="apple-searching">🔍 Searching…</span>
            )}
          </div>
          {appleError && <small className="search-error-text">{appleError}</small>}

          {appleResults.length > 0 && (
            <div className="apple-results">
              {appleResults.map((result) => (
                <div
                  key={result.trackId}
                  className="apple-result-item"
                  onClick={() => selectAppleTrack(result)}
                >
                  {result.artworkUrl && (
                    <img src={result.artworkUrl} alt={result.trackName} />
                  )}
                  <div className="result-info">
                    <div className="result-title">{result.trackName}</div>
                    <div className="result-channel">
                      {result.artistName}
                      {result.collectionName ? ` · ${result.collectionName}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="form-divider"><span>OR</span></div>

          <div className="form-group youtube-url-group">
            <label>Paste a YouTube link</label>
            <div className="youtube-url-row">
              <input
                type="text"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                className="input"
                placeholder="https://www.youtube.com/watch?v=..."
                disabled={youtubeLoading}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleLoadYouTube}
                disabled={youtubeLoading || !youtubeUrl.trim()}
              >
                {youtubeLoading ? 'Loading…' : 'Load Song'}
              </button>
            </div>
            {youtubeError && <small className="search-error-text">{youtubeError}</small>}
            <small className="form-hint">
              Pick the exact part of any full song on YouTube — paste the link, then set the
              start and length below.
            </small>
          </div>

          <div className="form-divider"><span>OR</span></div>

          <div className="form-group mp3-upload-group">
            <label>Upload an MP3 file</label>
            <input
              type="file"
              accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg"
              onChange={handleMp3File}
              disabled={mp3Uploading}
            />
            {mp3File && (
              <small className="form-hint mp3-loaded-name">
                Loaded: {mp3File.name} · {formatTime(mp3Duration)} long — pick the walk-up
                window below, then Save.
              </small>
            )}
            {mp3Error && <small className="search-error-text">{mp3Error}</small>}
            <small className="form-hint">
              Only the 5–15 second walk-up clip is stored — the full file never leaves this device.
            </small>
          </div>

          {historyRows.length > 0 && (
            <div className="song-history">
              <button
                type="button"
                className="song-history-toggle"
                onClick={() => setShowHistory((v) => !v)}
                aria-expanded={showHistory}
              >
                <span className="song-history-toggle-label">
                  🕘 Previous songs ({historyRows.length})
                </span>
                <span className="song-history-caret">{showHistory ? '▴' : '▾'}</span>
              </button>
              {showHistory && (
                <ul className="song-history-list">
                  {historyRows.map((entry) => {
                    const active = isActiveHistoryEntry(entry);
                    const thumb = entry.songSource === 'apple' && entry.artworkUrl
                      ? mediaProxy(String(entry.artworkUrl).replace('100x100', '600x600'))
                      : (entry.songThumbnail || null);
                    return (
                      <li
                        key={songComboKey(entry) || `${entry.songTitle}-${entry.startTime}-${entry.duration}`}
                        className={`song-history-row${active ? ' is-active' : ''}`}
                        title={active
                          ? 'This is the section currently loaded below'
                          : 'Tap to load this exact song and section'}
                        onClick={() => { if (!active) applyHistoryEntry(entry); }}
                      >
                        {thumb && <img src={thumb} alt="" className="song-history-thumb" />}
                        <span className="song-history-info">
                          <span className="song-history-title">{entry.songTitle}</span>
                          <span className="song-history-meta">
                            ▶ {formatTime(Number(entry.startTime) || 0)} · {Number(entry.duration) || 0}s
                            {isActiveHistoryEntry(entry) ? ' · current' : ''}
                          </span>
                        </span>
                        <span
                          className="song-history-plays"
                          title="How many times the coach played this exact section"
                        >
                          {active ? '✓' : `${Number(entry.plays) || 0}×`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          </div>
        </div>

        {(isApple || isYouTube || isMp3) && formData.songTitle && (
          <div className="video-preview song-loaded-preview">
            {isYouTube && formData.songThumbnail ? (
              <img src={formData.songThumbnail} alt={formData.songTitle} />
            ) : null}
            <small>{isYouTube ? '▶️' : (isMp3 ? '📁' : '🎵')} {formData.songTitle}</small>
          </div>
        )}

        {(isApple || isYouTube || isMp3) && (
          <div className="form-group preview-window-group">
            <label>Pick the walk-up window (5–15s)</label>
            {sliderUsable ? (
              <>
                <div
                  className="preview-window-track"
                  ref={trackRef}
                  onPointerDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    stopPreview();
                    const rect = trackRef.current.getBoundingClientRect();
                    const pct = (e.clientX - rect.left) / rect.width;
                    const center = pct * totalSeconds;
                    const start = Math.max(0, Math.min(
                      totalSeconds - windowDuration,
                      Math.round(center - windowDuration / 2)
                    ));
                    setFormData((prev) => ({ ...prev, startTime: start, duration: windowDuration }));
                  }}
                >
                  <div
                    className="preview-window-fill"
                    style={{
                      left: `${windowStartPct}%`,
                      width: `${windowEndPct - windowStartPct}%`
                    }}
                    onPointerDown={startDrag((pct) => {
                      stopPreview();
                      const newStart = Math.max(0, Math.min(
                        totalSeconds - windowDuration,
                        Math.round(pct * totalSeconds - windowDuration / 2)
                      ));
                      setFormData((prev) => ({ ...prev, startTime: newStart }));
                    })}
                  />
                  <div
                    className="preview-window-thumb preview-window-thumb-start"
                    style={{ left: `${windowStartPct}%` }}
                    onPointerDown={startDrag((pct) => {
                      handleStartChange(String(Math.round(pct * totalSeconds)));
                    })}
                  />
                  <div
                    className="preview-window-thumb preview-window-thumb-end"
                    style={{ left: `${windowEndPct}%` }}
                    onPointerDown={startDrag((pct) => {
                      handleEndChange(String(Math.round(pct * totalSeconds)));
                    })}
                  />
                </div>
                <div className="preview-window-labels">
                  <span>▶ {formatTime(windowStart)}</span>
                  <span className="preview-window-length">{windowDuration}s</span>
                  <span>⏹ {formatTime(windowEnd)}</span>
                </div>
              </>
            ) : isMp3 ? (
              <div className="mp3-window-locked">
                <span>
                  ▶ {formatTime(Math.max(0, Number(formData.startTime) || 0))} · {windowDuration}s · ⏹ {formatTime(Math.max(0, Number(formData.startTime) || 0) + windowDuration)}
                </span>
                <small className="form-hint">
                  To change this section, select the MP3 file again above.
                </small>
              </div>
            ) : (
              <>
                <div className="youtube-window-row">
                  <div className="youtube-window-field">
                    <label htmlFor="yt-start">Start at</label>
                    <input
                      id="yt-start"
                      type="text"
                      value={ytStartText}
                      placeholder="e.g. 1:35 or 95"
                      onChange={(e) => {
                        stopPreview();
                        const text = e.target.value;
                        setYtStartText(text);
                        const parsed = parseStartText(text);
                        if (parsed !== null) {
                          setFormData({ ...formData, startTime: Math.max(0, parsed) });
                        }
                      }}
                      className="input"
                    />
                  </div>
                  <div className="youtube-window-field">
                    <label htmlFor="yt-length">Length (seconds)</label>
                    <input
                      id="yt-length"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max={MAX_WINDOW}
                      step="1"
                      value={formData.duration || WINDOW_SECONDS}
                      onChange={(e) => {
                        stopPreview();
                        const val = Math.max(1, Math.min(MAX_WINDOW, Number(e.target.value) || WINDOW_SECONDS));
                        setFormData({ ...formData, duration: val });
                      }}
                      className="input"
                    />
                  </div>
                </div>
                <small className="form-hint">
                  Enter when the walk-up starts — m:ss (1:35) or plain seconds (95) — and how
                  long it plays (up to {MAX_WINDOW}s). The full YouTube video is available.
                </small>
              </>
            )}

            {((isApple && formData.previewUrl) || (isYouTube && formData.songVideoId) || (isMp3 && (mp3File || formData.mp3Key))) && (
              <button
                type="button"
                className={`preview-play-btn${previewing ? ' is-playing' : ''}`}
                onClick={togglePreview}
                aria-label={previewing ? 'Stop preview' : 'Preview this section'}
              >
                {previewing ? '⏹' : '▶'} Preview section
              </button>
            )}
          </div>
        )}

        <div className="form-group">
          <label>Song Title (Optional)</label>
          <input
            type="text"
            value={formData.songTitle}
            onChange={(e) => setFormData({ ...formData, songTitle: e.target.value })}
            className="input"
            placeholder="e.g., Thunder - Imagine Dragons"
          />
          <small className="form-hint">Auto-fills from Apple Music search or YouTube</small>
        </div>


        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={mp3Uploading}>
            {mp3Uploading ? 'Uploading…' : (songOnly ? 'Save Song' : (player ? 'Update Player' : 'Add Player'))}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
