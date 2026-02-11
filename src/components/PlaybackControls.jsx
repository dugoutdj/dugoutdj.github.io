import { formatTime } from '../utils/youtube';
import './PlaybackControls.css';

export default function PlaybackControls({
  currentPlayer,
  currentPlayerIndex,
  totalPlayers,
  isPlaying,
  onPlay,
  onPause,
  onStop,
  onNext,
  onPrevious,
  onReplay
}) {
  return (
    <div className="playback-controls">
      <div className="now-playing">
        {currentPlayer ? (
          <div className="now-playing-info-simple">
            <span className="now-playing-label">Now Playing:</span>
            <span className="now-playing-player">
              {currentPlayer.name}
              {currentPlayer.number && ` #${currentPlayer.number}`}
            </span>
            <span className="now-playing-order">
              ({currentPlayerIndex + 1} of {totalPlayers})
            </span>
          </div>
        ) : (
          <div className="now-playing-empty">
            <span>No song playing</span>
          </div>
        )}
      </div>

      <div className="control-buttons">
        <button
          className="btn btn-control"
          onClick={onPrevious}
          disabled={!currentPlayer}
          title="Previous player"
        >
          ⏮
        </button>

        <button
          className="btn btn-control"
          onClick={onReplay}
          disabled={!currentPlayer}
          title="Replay song"
        >
          🔄
        </button>

        {isPlaying ? (
          <button
            className="btn btn-control btn-play"
            onClick={onPause}
            title="Pause"
          >
            ⏸
          </button>
        ) : (
          <button
            className="btn btn-control btn-play"
            onClick={onPlay}
            disabled={!currentPlayer}
            title="Play"
          >
            ▶
          </button>
        )}

        <button
          className="btn btn-control"
          onClick={onStop}
          disabled={!currentPlayer}
          title="Stop"
        >
          ⏹
        </button>

        <button
          className="btn btn-control"
          onClick={onNext}
          disabled={!currentPlayer}
          title="Next player"
        >
          ⏭
        </button>
      </div>

      {currentPlayer && !currentPlayer.songVideoId && (
        <div className="playback-warning">
          ⚠️ No song configured for this player
        </div>
      )}
    </div>
  );
}
