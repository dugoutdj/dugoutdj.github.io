import { useState, useEffect } from 'react';
import { extractVideoId, formatTime, fetchVideoInfo } from '../utils/youtube';
import SongSearch from './SongSearch';
import { SUGGESTED_SONGS } from '../constants/suggestedSongs';
import './PlayerForm.css';

export default function PlayerForm({ player, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    name: '',
    number: '',
    songUrl: '',
    songVideoId: '',
    songTitle: '',
    songThumbnail: '',
    startTime: 0,
    duration: 30
  });
  const [showSearch, setShowSearch] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState('');
  const [startTimeInput, setStartTimeInput] = useState('0:00');
  const [durationInput, setDurationInput] = useState('30');
  const [isFetchingTitle, setIsFetchingTitle] = useState(false);

  useEffect(() => {
    if (player) {
      setFormData(player);
      setStartTimeInput(formatTime(player.startTime || 0));
      setDurationInput(String(player.duration || 30));
    }
  }, [player]);

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      alert('Please enter a player name');
      return;
    }

    // Parse time inputs
    const startTimeParts = startTimeInput.split(':').map(p => parseInt(p) || 0);
    const startTime = startTimeParts.length === 2
      ? startTimeParts[0] * 60 + startTimeParts[1]
      : startTimeParts[0] || 0;

    const duration = parseInt(durationInput) || 30;

    onSave({
      ...formData,
      startTime,
      duration
    });
  };

  const handleUrlChange = async (url) => {
    const videoId = extractVideoId(url);
    setFormData({
      ...formData,
      songUrl: url,
      songVideoId: videoId || '',
      songTitle: '', // Clear title while fetching
      songThumbnail: '' // Clear thumbnail while fetching
    });

    // Auto-fetch title and thumbnail if we have a valid video ID
    if (videoId) {
      setIsFetchingTitle(true);
      const info = await fetchVideoInfo(videoId);
      if (info) {
        setFormData(prev => ({
          ...prev,
          songTitle: info.title || '',
          songThumbnail: info.thumbnail || ''
        }));
      }
      setIsFetchingTitle(false);
    }
  };

  const handleSongSelect = (videoId, title, thumbnail) => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    setFormData({
      ...formData,
      songUrl: url,
      songVideoId: videoId,
      songTitle: title || '',
      songThumbnail: thumbnail || ''
    });
    setShowSearch(false);
  };

  const handleSuggestionSelect = (e) => {
    const videoId = e.target.value;
    if (!videoId) return;

    const song = SUGGESTED_SONGS.find(s => s.videoId === videoId);
    if (song) {
      // Reuse existing handleSongSelect pattern
      handleSongSelect(song.videoId, song.title, song.thumbnail);

      // Also populate default start/duration if not editing existing player
      if (!player) {
        setFormData(prev => ({
          ...prev,
          songUrl: `https://www.youtube.com/watch?v=${song.videoId}`,
          songVideoId: song.videoId,
          songTitle: song.title,
          songThumbnail: song.thumbnail
        }));
        setStartTimeInput(formatTime(song.defaultStartTime));
        setDurationInput(String(song.defaultDuration));
      }

      setSelectedSuggestion('');
    }
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog player-form-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>{player ? 'Edit Player' : 'Add Player'}</h3>
          <button type="button" className="dialog-close" onClick={onCancel}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="player-form">

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

        <div className="youtube-premium-tip">
          <strong>💡 Tip:</strong> YouTube videos may show ads before playing.
          Consider <a href="https://www.youtube.com/premium" target="_blank" rel="noopener noreferrer">YouTube Premium</a> for ad-free playback during games.
        </div>

        <div className="form-group">
          <label>Suggested Songs</label>
          <select
            id="suggested-songs"
            value={selectedSuggestion}
            onChange={handleSuggestionSelect}
            className="input"
          >
            <option value="">-- Choose a suggested song --</option>
            {SUGGESTED_SONGS.map(song => (
              <option key={song.videoId} value={song.videoId}>
                {song.title}
              </option>
            ))}
          </select>
          <small className="form-hint">
            Quick access to popular walk-up songs
          </small>
        </div>

        <div className="form-group">
          <label>Song (YouTube URL or Video ID)</label>
          <div className="song-input-group">
            <input
              type="text"
              value={formData.songUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              className="input"
              placeholder="Paste YouTube URL or video ID"
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowSearch(!showSearch)}
            >
              🔍 Search
            </button>
          </div>
          {formData.songVideoId && (
            <div className="video-preview">
              <small>Video ID: {formData.songVideoId}</small>
            </div>
          )}
        </div>

        <div className="form-group">
          <label>Song Title (Optional)</label>
          <input
            type="text"
            value={formData.songTitle}
            onChange={(e) => setFormData({ ...formData, songTitle: e.target.value })}
            className="input"
            placeholder={isFetchingTitle ? "Fetching title..." : "e.g., Welcome to the Jungle - Guns N' Roses"}
            disabled={isFetchingTitle}
          />
          <small className="form-hint">
            {isFetchingTitle ? "🔄 Auto-fetching title from YouTube..." : "Auto-fills when you paste a URL or use search"}
          </small>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Start Time (mm:ss)</label>
            <input
              type="text"
              value={startTimeInput}
              onChange={(e) => setStartTimeInput(e.target.value)}
              className="input"
              placeholder="0:00"
            />
          </div>

          <div className="form-group">
            <label>Duration (seconds)</label>
            <input
              type="number"
              value={durationInput}
              onChange={(e) => setDurationInput(e.target.value)}
              className="input"
              placeholder="30"
              min="5"
              max="120"
            />
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            {player ? 'Update Player' : 'Add Player'}
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

        {showSearch && (
          <SongSearch
            onSelect={handleSongSelect}
            onClose={() => setShowSearch(false)}
          />
        )}
      </div>
    </div>
  );
}
