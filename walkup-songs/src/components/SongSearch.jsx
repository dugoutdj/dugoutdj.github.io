import { useState } from 'react';
import { searchYouTube } from '../utils/youtube';
import './SongSearch.css';

export default function SongSearch({ onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent event from bubbling to parent form
    if (!query.trim()) return;

    setIsSearching(true);
    setError(null);

    try {
      const searchResult = await searchYouTube(query.trim());

      if (searchResult.type === 'url') {
        // No API key, open YouTube search in new tab
        window.open(searchResult.url, '_blank');
        setError('No YouTube API key configured. Opening YouTube search in new tab. Copy the video URL from YouTube and paste it in the song field.');
      } else {
        setResults(searchResult.items);
      }
    } catch (err) {
      setError('Failed to search. Please try again or paste a YouTube URL directly.');
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="song-search">
      <div className="song-search-header">
        <h4>Search YouTube</h4>
        <button className="btn-icon" onClick={onClose}>✕</button>
      </div>

      <form onSubmit={handleSearch} className="search-form">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a song..."
          className="input"
          autoFocus
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={isSearching || !query.trim()}
        >
          {isSearching ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && (
        <div className="search-error">
          <p>{error}</p>
          <p className="search-hint">
            💡 Tip: You can paste a YouTube URL directly in the song field above, or search on YouTube and copy the URL.
          </p>
        </div>
      )}

      {results.length > 0 && (
        <div className="search-results">
          {results.map((result) => (
            <div
              key={result.id}
              className="search-result-item"
              onClick={() => onSelect(result.id, result.title, result.thumbnail)}
            >
              <img src={result.thumbnail} alt={result.title} />
              <div className="result-info">
                <div className="result-title">{result.title}</div>
                <div className="result-channel">{result.channel}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {results.length === 0 && !isSearching && !error && (
        <div className="search-placeholder">
          <p>Search for songs on YouTube</p>
          <p className="search-hint">
            Or paste a YouTube URL directly in the song field
          </p>
        </div>
      )}
    </div>
  );
}
