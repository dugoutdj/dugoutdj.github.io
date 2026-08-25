import { useState, useEffect, useRef } from 'react';
import { formatTime, extractVideoId, fetchVideoInfo } from '../utils/youtube';
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

export default function PlayerForm({ player, onSave, onCancel, songOnly = false }) {
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
    }
  }, [player]);

  // Close on Escape; lock page scroll while the modal is open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onCancel]);

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
        duration: 20
      }));
      setYoutubeUrl('');
    } catch {
      setYoutubeError("Couldn't load that video \u2014 check the link and try again.");
    } finally {
      setYoutubeLoading(false);
    }
  };

  // Slide/resize the walk-up window within the 30-second preview.
  const handleStartChange = (value) => {
    // Stop any live preview so it doesn't keep playing the old window.
    stopPreview();
    // Moving the left edge keeps the right edge fixed (resizes the window);
    // only when a min/max clamp kicks in does the right edge move along.
    let start = Math.max(0, Math.min(MAX_START, Number(value) || 0));
    const currentEnd = Math.min(
      (formData.startTime || 0) + Math.max(MIN_WINDOW, Math.min(MAX_WINDOW, formData.duration || WINDOW_SECONDS)),
      PREVIEW_SECONDS
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
    let end = Math.max(MIN_WINDOW, Math.min(PREVIEW_SECONDS, Number(value) || WINDOW_SECONDS));
    let start = Math.max(0, Math.min(MAX_START, formData.startTime || 0));
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

  // Stop any running preview when the form unmounts.
  useEffect(() => {
    return () => {
      stopAnnouncement();
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
    const audio = audioRef.current;
    if (audio) audio.pause();
    setPreviewing(false);
  };

  const togglePreview = () => {
    if (!formData.previewUrl) return;
    if (previewing) {
      stopPreview();
      return;
    }
    // Don't let the song and announcement play at the same time.
    stopAnnouncePreview();
    const start = Math.max(0, Number(formData.startTime) || 0);
    const duration = Math.max(1, Number(formData.duration) || WINDOW_SECONDS);
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

  const isApple = formData.songSource === 'apple';
  const isYouTube = !isApple && !!formData.songVideoId;
  const windowStart = isApple ? Math.min(formData.startTime || 0, MAX_START) : 0;
  const windowDuration = isApple
    ? Math.max(MIN_WINDOW, Math.min(MAX_WINDOW, formData.duration || WINDOW_SECONDS))
    : WINDOW_SECONDS;
  const windowEnd = Math.min(windowStart + windowDuration, PREVIEW_SECONDS);
  const windowStartPct = (windowStart / PREVIEW_SECONDS) * 100;
  const windowEndPct = (windowEnd / PREVIEW_SECONDS) * 100;

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

          {isApple && (
            <div className="video-preview">
              <small>🎵 {formData.songTitle}</small>
            </div>
          )}

          {isYouTube && (
            <div className="video-preview youtube-video-preview">
              {formData.songThumbnail && (
                <img src={formData.songThumbnail} alt={formData.songTitle} />
              )}
              <small>▶️ {formData.songTitle || 'YouTube video'}</small>
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

        {isApple && (
          <div className="form-group preview-window-group">
            <label>Pick the walk-up window (5–15s)</label>
            <div
              className="preview-window-track"
              ref={trackRef}
              onPointerDown={(e) => {
                if (e.target !== e.currentTarget) return;
                stopPreview();
                const rect = trackRef.current.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                const center = pct * PREVIEW_SECONDS;
                const start = Math.max(0, Math.min(
                  PREVIEW_SECONDS - windowDuration,
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
                    PREVIEW_SECONDS - windowDuration,
                    Math.round(pct * PREVIEW_SECONDS - windowDuration / 2)
                  ));
                  setFormData((prev) => ({ ...prev, startTime: newStart }));
                })}
              />
              <div
                className="preview-window-thumb preview-window-thumb-start"
                style={{ left: `${windowStartPct}%` }}
                onPointerDown={startDrag((pct) => {
                  handleStartChange(String(Math.round(pct * PREVIEW_SECONDS)));
                })}
              />
              <div
                className="preview-window-thumb preview-window-thumb-end"
                style={{ left: `${windowEndPct}%` }}
                onPointerDown={startDrag((pct) => {
                  handleEndChange(String(Math.round(pct * PREVIEW_SECONDS)));
                })}
              />
            </div>
            <div className="preview-window-labels">
              <span>▶ {formatTime(windowStart)}</span>
              <span className="preview-window-length">{windowDuration}s</span>
              <span>⏹ {formatTime(windowEnd)}</span>
            </div>
            {formData.previewUrl && (
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

        {isYouTube && (
          <div className="form-group preview-window-group">
            <label>Walk-up window (start &amp; length)</label>
            <div className="youtube-window-row">
              <div className="youtube-window-field">
                <label htmlFor="yt-start">Start at (seconds)</label>
                <input
                  id="yt-start"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={formData.startTime || 0}
                  onChange={(e) => {
                    stopPreview();
                    setFormData({ ...formData, startTime: Math.max(0, Number(e.target.value) || 0) });
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
                  step="1"
                  value={formData.duration || 20}
                  onChange={(e) => {
                    stopPreview();
                    setFormData({ ...formData, duration: Math.max(1, Number(e.target.value) || 20) });
                  }}
                  className="input"
                />
              </div>
            </div>
            <small className="form-hint">
              The exact second the song starts and how long it plays. The full YouTube video
              is available, so any part of the song can be the walk-up.
            </small>
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
