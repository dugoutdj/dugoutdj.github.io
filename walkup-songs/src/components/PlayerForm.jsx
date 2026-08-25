import { useState, useEffect, useRef } from 'react';
import { formatTime, extractVideoId, fetchVideoInfo, getVideoDuration, loadYouTubeAPI } from '../utils/youtube';
import { searchTracks } from '../utils/previewDownloader';
import { mediaProxy } from '../utils/media';
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
  const totalSeconds = isApple
    ? PREVIEW_SECONDS
    : ((ytDuration && ytDuration > 0) ? ytDuration : YT_FALLBACK_SECONDS);
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

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!songOnly && !formData.name.trim()) {
      alert('Please enter a player name');
      return;
    }

    // The walk-up window lives entirely in formData (startTime + duration),
    // set by the slider above.
    const startTime = Math.max(0, formData.startTime || 0);
    const duration = Math.max(1, formData.duration || WINDOW_SECONDS);

    onSave({
      ...formData,
      startTime,
      duration
    });
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
      startTime: 0,
      duration: WINDOW_SECONDS
    }));
    setAppleQuery('');
    setAppleResults([]);
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
        startTime: 0,
        duration: WINDOW_SECONDS
      }));
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
    if (!formData.previewUrl) return;
    const end = start + duration;

    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      audioRef.current = audio;
    }
    const audio = audioRef.current;

    audio.src = mediaProxy(formData.previewUrl);
    audio.currentTime = start;
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

  // Window geometry over the source's total length (30s Apple preview, or
  // the full YouTube video). The slider is used for Apple songs; YouTube
  // songs use manual start/length inputs instead (a multi-minute track makes
  // a slider too coarse to pick a 15s window).
  const sliderUsable = isApple;
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
          </div>
        </div>

        {(isApple || isYouTube) && formData.songTitle && (
          <div className="video-preview song-loaded-preview">
            {isYouTube && formData.songThumbnail && (
              <img src={formData.songThumbnail} alt={formData.songTitle} />
            )}
            <small>{isYouTube ? '▶️' : '🎵'} {formData.songTitle}</small>
          </div>
        )}

        {(isApple || isYouTube) && (
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

            {((isApple && formData.previewUrl) || (isYouTube && formData.songVideoId)) && (
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
          <button type="submit" className="btn btn-primary">
            {songOnly ? 'Save Song' : (player ? 'Update Player' : 'Add Player')}
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
