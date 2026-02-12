import { useState } from 'react';
import './PlayerList.css';

export default function PlayerList({
  players,
  currentPlayerIndex,
  youtubeEmbeds,
  onEdit,
  onDelete,
  onToggleDisabled,
  onReorder,
  onPlayPlayer,
  onShare
}) {
  const [draggedIndex, setDraggedIndex] = useState(null);

  // Sort players: enabled first (by order), disabled last (by order)
  const sortedPlayers = [...players].sort((a, b) => {
    if (a.disabled === b.disabled) {
      return (a.order || 0) - (b.order || 0);
    }
    return a.disabled ? 1 : -1;
  });

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newPlayers = [...players];
    const draggedPlayer = newPlayers[draggedIndex];
    newPlayers.splice(draggedIndex, 1);
    newPlayers.splice(index, 0, draggedPlayer);

    onReorder(newPlayers);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const movePlayer = (index, direction) => {
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === players.length - 1)
    ) {
      return;
    }

    const newPlayers = [...players];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    [newPlayers[index], newPlayers[newIndex]] = [newPlayers[newIndex], newPlayers[index]];
    onReorder(newPlayers);
  };

  if (!players || players.length === 0) {
    return (
      <div className="player-list-empty">
        <p>No players added yet.</p>
        <p>Click "Add Player" to get started!</p>
      </div>
    );
  }

  return (
    <div className="player-list">
      <div className="player-list-header">
        <span className="col-order">Order</span>
        <span className="col-player">Player</span>
        <span className="col-song">Song</span>
        <span className="col-actions">Actions</span>
      </div>

      {sortedPlayers.map((player, index) => {
        // Find original index for playback
        const originalIndex = players.findIndex(p => p.id === player.id);
        const isDisabled = player.disabled;
        // Count only enabled players before this one for order number
        const enabledIndex = sortedPlayers.slice(0, index).filter(p => !p.disabled).length;

        return (
        <div
          key={player.id}
          className={`player-item ${currentPlayerIndex === originalIndex ? 'current' : ''} ${isDisabled ? 'disabled' : ''}`}
          onClick={() => !isDisabled && onPlayPlayer(originalIndex)}
          onDragOver={(e) => handleDragOver(e, index)}
          style={{ cursor: isDisabled ? 'not-allowed' : 'pointer' }}
        >
          <div className="col-order">
            {!isDisabled && <span className="order-number">{enabledIndex + 1}</span>}
          </div>

          <div className="col-player">
            <div className="player-info">
              <span className="player-name">{player.name}</span>
              {player.number && (
                <span className="player-number">#{player.number}</span>
              )}
            </div>
          </div>

          <div className="col-song">
            {player.songVideoId ? (
              <>
                {/* Always render YouTube player so it initializes, but hide when not selected */}
                <div className={currentPlayerIndex === index ? '' : 'youtube-hidden'}>
                  {youtubeEmbeds && youtubeEmbeds[index]}
                </div>
                {/* Show song info when not selected */}
                {currentPlayerIndex !== index && (
                  <div className="song-info">
                    {player.songThumbnail && (
                      <img
                        src={player.songThumbnail}
                        alt={player.songTitle}
                        className="song-thumbnail-small"
                      />
                    )}
                    <div className="song-details">
                      <div className="song-title">{player.songTitle || 'Unknown Song'}</div>
                      {player.startTime !== undefined && player.duration && (
                        <div className="song-time">
                          {Math.floor(player.startTime)}s - {Math.floor(player.startTime + player.duration)}s
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <span className="no-song">No song</span>
            )}
          </div>

          <div className="col-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(player);
              }}
              title="Edit player"
            >
              ✏️
            </button>
            {onShare && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onShare(player);
                }}
                title="Share song form with parent"
              >
                📤
              </button>
            )}
            {onToggleDisabled && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleDisabled(player.id);
                }}
                title={isDisabled ? "Enable player" : "Disable player (didn't show up)"}
              >
                🚫
              </button>
            )}
            <button
              className="btn btn-danger btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete player "${player.name}"?`)) {
                  onDelete(player.id);
                }
              }}
              title="Delete player"
            >
              🗑️
            </button>
            <button
              className="btn-icon btn-xs"
              onClick={(e) => {
                e.stopPropagation();
                movePlayer(index, 'up');
              }}
              disabled={index === 0}
              title="Move up"
            >
              ▲
            </button>
            <button
              className="btn-icon btn-xs"
              onClick={(e) => {
                e.stopPropagation();
                movePlayer(index, 'down');
              }}
              disabled={index === players.length - 1}
              title="Move down"
            >
              ▼
            </button>
            <span
              className="drag-handle"
              draggable="true"
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              title="Drag to reorder"
            >
              ☰
            </span>
          </div>
        </div>
        );
      })}
    </div>
  );
}
