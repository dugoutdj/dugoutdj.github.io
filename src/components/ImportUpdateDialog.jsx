import { useState, useEffect } from 'react';
import { parseUpdateCode, parseOverrideCode } from '../utils/updateCode';
import { fetchVideoInfo } from '../utils/youtube';
import './ImportUpdateDialog.css';

export default function ImportUpdateDialog({ players, onImport, onClose, initialCode = '', mode = 'update' }) {
  const [code, setCode] = useState(initialCode);
  const [parsedData, setParsedData] = useState(null);
  const [isOverride, setIsOverride] = useState(false);
  const [songMetadata, setSongMetadata] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!code) {
      setParsedData(null);
      setSongMetadata(null);
      setIsOverride(false);
      setError('');
      return;
    }

    // Try permanent update code first, then override code
    let parsed = parseUpdateCode(code);
    let detectedOverride = false;

    if (!parsed) {
      parsed = parseOverrideCode(code);
      if (parsed) {
        detectedOverride = true;
      }
    }

    if (!parsed) {
      setError('Invalid update code format');
      setParsedData(null);
      setSongMetadata(null);
      setIsOverride(false);
      return;
    }

    // Find the player
    const player = players.find(p => p.id === parsed.playerId);
    if (!player) {
      setError('Player not found. This code may be for a different team.');
      setParsedData(null);
      setSongMetadata(null);
      setIsOverride(false);
      return;
    }

    setParsedData({ ...parsed, playerName: player.name });
    setIsOverride(detectedOverride);
    setError('');

    // Fetch song metadata
    setLoading(true);
    fetchVideoInfo(parsed.videoId)
      .then(metadata => {
        setSongMetadata(metadata);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch song metadata:', err);
        setSongMetadata({ title: 'Unknown Song', thumbnail: '' });
        setLoading(false);
      });
  }, [code, players]);

  const handleImport = () => {
    if (!parsedData || error) return;

    const updateData = {
      playerId: parsedData.playerId,
      songVideoId: parsedData.videoId,
      songTitle: songMetadata?.title || 'Unknown Song',
      songThumbnail: songMetadata?.thumbnail || '',
      songUrl: `https://www.youtube.com/watch?v=${parsedData.videoId}`,
      startTime: parsedData.startTime,
      duration: parsedData.duration,
      isOverride
    };

    onImport(updateData);
    onClose();
  };

  const isOverrideMode = mode === 'override';
  const placeholder = isOverrideMode
    ? 'DJUOA:123456:dQw4w9WgXcQ:15:20'
    : 'DJU:123456:dQw4w9WgXcQ:15:20';
  const hintText = isOverrideMode
    ? 'Get this override code from the parent via text or email'
    : 'Get this code from the parent via text or email';

  const dialogTitle = isOverride
    ? 'Import One At-Bat Override'
    : isOverrideMode
      ? 'Import Override Code'
      : 'Import Song Update';

  const confirmLabel = isOverride ? '✓ Apply Override' : '✓ Confirm Update';

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog import-update-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>{dialogTitle}</h3>
          <button className="dialog-close" onClick={onClose}>×</button>
        </div>

        <div className="dialog-body">
          <div className="form-group">
            <label htmlFor="update-code">Paste Update Code</label>
            <input
              id="update-code"
              type="text"
              className="form-control"
              placeholder={placeholder}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
            <p className="field-hint">{hintText}</p>
          </div>

          {error && (
            <div className="error-message">
              ⚠️ {error}
            </div>
          )}

          {loading && (
            <div className="loading-preview">
              Loading song information...
            </div>
          )}

          {parsedData && !error && songMetadata && (
            <div className="update-preview">
              <div className="preview-header">
                <h4>Preview Update</h4>
                <span className={`update-type-badge ${isOverride ? 'badge-override' : 'badge-permanent'}`}>
                  {isOverride ? '🎵 One At-Bat Override' : '🔄 Permanent Update'}
                </span>
              </div>

              <div className="preview-player">
                <strong>Player:</strong> {parsedData.playerName}
              </div>

              <div className="preview-song">
                {songMetadata.thumbnail && (
                  <img
                    src={songMetadata.thumbnail}
                    alt={songMetadata.title}
                    className="preview-thumbnail"
                  />
                )}
                <div className="preview-song-info">
                  <div className="preview-song-title">{songMetadata.title}</div>
                  <div className="preview-song-time">
                    Start: {parsedData.startTime}s, Duration: {parsedData.duration}s
                  </div>
                  {isOverride && (
                    <div className="preview-override-note">
                      Plays once, then reverts to permanent song
                    </div>
                  )}
                </div>
              </div>

              <div className="preview-actions">
                <button className="btn btn-secondary" onClick={onClose}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleImport}>
                  {confirmLabel}
                </button>
              </div>
            </div>
          )}

          {!code && !error && (
            <div className="import-help">
              <p><strong>How to use:</strong></p>
              <ol>
                <li>Ask the parent to send you the {isOverrideMode ? 'override' : 'update'} code</li>
                <li>Copy the code from their text/email</li>
                <li>Paste it in the field above</li>
                <li>Preview the {isOverrideMode ? 'override' : 'update'} and confirm</li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
