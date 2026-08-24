import { useState, useEffect, useRef } from 'react';
import { formatTime } from '../utils/youtube';
import { searchTracks } from '../utils/previewDownloader';
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
  // Set while a handle is being dragged, so the wrapper's click-to-move
  // doesn't fire from the click that ends a drag.
  const draggingRef = useRef(false);

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
      setFormData({ ...player, startTime: start, duration });
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

  // Debounced live search against Apple's catalog.
  useEffect(() => {
    if (!appleQuery.trim()) {
      setAppleResults([]);
      setAppleError(null);
      return;
    }

    const timer = setTimeout(async () => {
      setAppleSearching(true);
      setAppleError(null);
      try {
        const results = await searchTracks(appleQuery);
        setAppleResults(results);
      } catch (err) {
        console.error('Apple search error:', err);
        setAppleError('Search failed. Please try again.');
      } finally {
        setAppleSearching(false);
      }
    }, 350);

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

  // Slide/resize the walk-up window within the 30-second preview.
  const handleStartChange = (value) => {
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

  // Invisible overlay handles at the window edges. They carry the resize drag
  // themselves (pointer capture on window), so no native thumb hit-testing is
  // involved — the bars are gone but dragging works everywhere.
  const handleDragStart = (which) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wrapEl = e.currentTarget.parentElement;
    const rect = wrapEl.getBoundingClientRect();
    draggingRef.current = true;
    const move = (ev) => {
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const secs = Math.round(pct * PREVIEW_SECONDS);
      if (which === 'start') {
        handleStartChange(String(secs));
      } else {
        handleEndChange(String(secs));
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // Clear after the trailing click so click-to-move stays suppressed.
      setTimeout(() => { draggingRef.current = false; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const isApple = formData.songSource === 'apple';
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

          {!isApple && formData.songVideoId && (
            <div className="video-preview">
              <small>⚠️ This player uses a YouTube video — re-pick the song below from Apple Music.</small>
            </div>
          )}
        </div>

        {isApple && (
          <div className="form-group preview-window-group">
            <label>Pick the walk-up window (5–15s)</label>
            <div
              className="preview-window-slider-wrap"
              onClick={(e) => {
                // Clicking the track moves the window; dragging a handle resizes it.
                if (draggingRef.current) return;
                if (e.target !== e.currentTarget) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const center = pct * PREVIEW_SECONDS;
                const start = Math.max(0, Math.min(
                  PREVIEW_SECONDS - windowDuration,
                  Math.round(center - windowDuration / 2)
                ));
                setFormData((prev) => ({ ...prev, startTime: start, duration: windowDuration }));
              }}
            >
              <input
                type="range"
                min="0"
                max={MAX_START}
                step="1"
                value={windowStart}
                onChange={(e) => handleStartChange(e.target.value)}
                onPointerDown={() => { draggingRef.current = true; }}
                onPointerUp={() => { setTimeout(() => { draggingRef.current = false; }, 0); }}
                className="preview-window-slider preview-window-slider-start"
                aria-label="Walk-up window start"
                style={{
                  background: `linear-gradient(to right,
                    var(--border-color) 0%,
                    var(--border-color) ${windowStartPct}%,
                    var(--success-color) ${windowStartPct}%,
                    var(--success-color) ${windowEndPct}%,
                    var(--border-color) ${windowEndPct}%,
                    var(--border-color) 100%)`
                }}
              />
              <input
                type="range"
                min={MIN_WINDOW}
                max={PREVIEW_SECONDS}
                step="1"
                value={windowEnd}
                onChange={(e) => handleEndChange(e.target.value)}
                className="preview-window-slider preview-window-slider-end"
                aria-label="Walk-up window end"
              />
              <div
                className="preview-window-handle preview-window-handle-start"
                style={{ left: `${windowStartPct}%` }}
                onPointerDown={handleDragStart('start')}
                aria-hidden="true"
              />
              <div
                className="preview-window-handle preview-window-handle-end"
                style={{ left: `${windowEndPct}%` }}
                onPointerDown={handleDragStart('end')}
                aria-hidden="true"
              />
            </div>
            <div className="preview-window-labels">
              <span>▶ {formatTime(windowStart)}</span>
              <span className="preview-window-length">{windowDuration}s</span>
              <span>⏹ {formatTime(windowEnd)}</span>
            </div>
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
          <small className="form-hint">Auto-fills from Apple Music search</small>
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
