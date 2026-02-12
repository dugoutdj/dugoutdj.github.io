import { useState } from 'react';
import './PlayerList.css';

export default function PlayerList({
  players,
  currentPlayerIndex,
  youtubeEmbeds,
  onEdit,
  onDelete,
  onReorder,
  onPlayPlayer
}) {
  const [draggedIndex, setDraggedIndex] = useState(null);

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

      {players.map((player, index) => (
        <div
          key={player.id}
          className={`player-item ${currentPlayerIndex === index ? 'current' : ''}`}
          onClick={() => onPlayPlayer(index)}
          onDragOver={(e) => handleDragOver(e, index)}
        >
          <div className="col-order">
            <span className="order-number">{index + 1}</span>
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
              /* Always render YouTube player so it initializes, but hide when not selected */
              <div className={currentPlayerIndex === index ? '' : 'youtube-hidden'}>
                {youtubeEmbeds && youtubeEmbeds[index]}
              </div>
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
      ))}
    </div>
  );
}
