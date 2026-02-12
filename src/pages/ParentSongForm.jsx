import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { extractVideoId, fetchVideoInfo } from '../utils/youtube';
import { generateUpdateCode } from '../utils/updateCode';
import { SUGGESTED_SONGS } from '../constants/suggestedSongs';
import './ParentSongForm.css';

export default function ParentSongForm() {
  const [searchParams] = useSearchParams();
  const playerId = searchParams.get('pid');
  const playerName = searchParams.get('pn');
  const teamId = searchParams.get('tid');

  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [selectedSuggestion, setSelectedSuggestion] = useState('');
  const [selectedSong, setSelectedSong] = useState(null);
  const [startTime, setStartTime] = useState(0);
  const [duration, setDuration] = useState(20);
  const [updateCode, setUpdateCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Validate required parameters
  if (!playerId || !playerName) {
    return (
      <div className="parent-form-container">
        <div className="parent-form-error">
          <h2>Invalid Link</h2>
          <p>This link is missing required information. Please ask your team manager for a new link.</p>
        </div>
      </div>
    );
  }

  const handleSuggestionSelect = (e) => {
    const videoId = e.target.value;
    setSelectedSuggestion(videoId);

    if (!videoId) {
      setSelectedSong(null);
      setStartTime(0);
      setDuration(20);
      return;
    }

    const song = SUGGESTED_SONGS.find(s => s.videoId === videoId);
    if (song) {
      setSelectedSong({
        videoId: song.videoId,
        title: song.title,
        thumbnail: song.thumbnail
      });
      setStartTime(song.defaultStartTime);
      setDuration(song.defaultDuration);
      setYoutubeUrl(''); // Clear URL input when suggestion selected
      setError('');
    }
  };

  const handleUrlSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSelectedSong(null);
    setSelectedSuggestion(''); // Clear suggestion when URL submitted

    if (!youtubeUrl.trim()) {
      setError('Please enter a YouTube URL');
      return;
    }

    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      setError('Invalid YouTube URL. Please copy the URL from YouTube and paste it here.');
      return;
    }

    setLoading(true);
    try {
      const info = await fetchVideoInfo(videoId);
      if (!info) {
        setError('Could not load video information. Please check the URL and try again.');
        return;
      }

      setSelectedSong({
        videoId,
        title: info.title,
        thumbnail: info.thumbnail
      });
      setError('');
    } catch (err) {
      setError('Failed to load video. Please try again.');
      console.error('Error fetching video info:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateCode = () => {
    if (!selectedSong) return;

    const code = generateUpdateCode(
      playerId,
      selectedSong.videoId,
      startTime,
      duration
    );

    setUpdateCode(code);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(updateCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleReset = () => {
    setUpdateCode('');
    setSelectedSong(null);
    setYoutubeUrl('');
    setSelectedSuggestion('');
    setStartTime(0);
    setDuration(20);
    setError('');
  };

  return (
    <div className="parent-form-container">
      <div className="parent-form-header">
        <h1>Dugout DJ</h1>
        <h2>Choose Walk-up Song</h2>
        <p className="player-name-display">for {playerName}</p>
      </div>

      <div className="parent-form-content">
        {!updateCode ? (
          <>
            <div className="form-section">
              <label htmlFor="suggested-songs">Choose from Popular Songs</label>
              <select
                id="suggested-songs"
                value={selectedSuggestion}
                onChange={handleSuggestionSelect}
                className="form-control"
              >
                <option value="">-- Select a popular walk-up song --</option>
                {SUGGESTED_SONGS.map(song => (
                  <option key={song.videoId} value={song.videoId}>
                    {song.title}
                  </option>
                ))}
              </select>
              <p className="field-help">
                Choose from our list of popular walk-up songs
              </p>
            </div>

            <div className="form-divider">
              <span>OR</span>
            </div>

            <div className="form-section">
              <label htmlFor="youtube-url">Paste YouTube URL</label>
              <form onSubmit={handleUrlSubmit} className="url-form">
                <input
                  id="youtube-url"
                  type="text"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="form-control"
                  disabled={loading}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading || !youtubeUrl.trim()}
                >
                  {loading ? 'Loading...' : 'Load Song'}
                </button>
              </form>
              <p className="field-help">
                Go to YouTube, find the song you want, and paste the URL here
              </p>
            </div>

            {error && (
              <div className="error-box">
                ⚠️ {error}
              </div>
            )}

            {selectedSong && (
              <>
                <div className="song-preview">
                  <img
                    src={selectedSong.thumbnail}
                    alt={selectedSong.title}
                    className="song-preview-thumbnail"
                  />
                  <div className="song-preview-info">
                    <strong>{selectedSong.title}</strong>
                  </div>
                </div>

                <div className="form-section">
                  <label htmlFor="start-time">
                    Start at (seconds)
                    <span className="field-help">What second should the song start at?</span>
                  </label>
                  <input
                    id="start-time"
                    type="number"
                    min="0"
                    value={startTime}
                    onChange={(e) => setStartTime(parseInt(e.target.value) || 0)}
                    className="form-control"
                  />
                </div>

                <div className="form-section">
                  <label htmlFor="duration">
                    Duration (seconds)
                    <span className="field-help">How long should it play?</span>
                  </label>
                  <input
                    id="duration"
                    type="number"
                    min="1"
                    max="60"
                    value={duration}
                    onChange={(e) => setDuration(parseInt(e.target.value) || 20)}
                    className="form-control"
                  />
                </div>

                <button
                  className="btn btn-primary btn-lg"
                  onClick={handleGenerateCode}
                >
                  Generate Update Code
                </button>
              </>
            )}
          </>
        ) : (
          <div className="code-generated">
            <div className="success-icon">✓</div>
            <h3>Update Code Generated!</h3>

            <div className="update-code-display">
              <code>{updateCode}</code>
            </div>

            <button
              className="btn btn-primary btn-lg"
              onClick={handleCopyCode}
            >
              {copied ? '✓ Copied!' : 'Copy Code'}
            </button>

            <div className="instructions">
              <p>Copy this code and send it to your team manager via text or email.</p>
              <p className="note">They will use it to update {playerName}'s song.</p>
            </div>

            <button
              className="btn btn-secondary"
              onClick={handleReset}
            >
              ← Choose Different Song
            </button>
          </div>
        )}
      </div>

      <div className="parent-form-footer">
        <p>Powered by Dugout DJ</p>
      </div>
    </div>
  );
}
