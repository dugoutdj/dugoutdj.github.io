import { formatTime } from '../utils/youtube';
import { playerArtwork, playerHasSong } from '../utils/song';
import './PlaybackControls.css';

export default function PlaybackControls({
  currentPlayer,
  currentPlayerIndex,
  totalPlayers,
  isPlaying,
  isOffline = false,
  currentTime,
  onPlay,
  onPause,
  onStop,
  onNext,
  onPrevious,
  onReplay
}) {
  const progress = currentPlayer
    ? ((currentTime - currentPlayer.startTime) / currentPlayer.duration) * 100
    : 0;

  return (
    <div className="playback-controls">
      <div className="now-playing">
        {currentPlayer ? (
          <>
            <div className="now-playing-header">
              {playerArtwork(currentPlayer) && (
                <img
                  src={playerArtwork(currentPlayer)}
                  alt={currentPlayer.songTitle || currentPlayer.name}
                  className="song-thumbnail-large"
                />
              )}
              <div className="now-playing-info">
                <span className="now-playing-label">Now Playing:</span>
                <span className="now-playing-player">
                  {currentPlayer.name}
                  {currentPlayer.number && ` #${currentPlayer.number}`}
                </span>
                {currentPlayer.songTitle && (
                  <span className="now-playing-song">{currentPlayer.songTitle}</span>
                )}
                <span className="now-playing-order">
                  ({currentPlayerIndex + 1} of {totalPlayers})
                </span>
                {isOffline && (
                  <span
                    className="offline-pill"
                    title="Playing from this device — no internet needed"
                  >
                    ▶ Ready
                  </span>
                )}
              </div>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
            <div className="time-info">
              <span>{formatTime(Math.max(0, currentTime - currentPlayer.startTime))}</span>
              <span>/</span>
              <span>{formatTime(currentPlayer.duration)}</span>
            </div>
          </>
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

      {currentPlayer && !playerHasSong(currentPlayer) && (
        <div className="playback-warning">
          ⚠️ No song configured for this player
        </div>
      )}
    </div>
  );
}
