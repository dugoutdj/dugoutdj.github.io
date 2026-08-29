import { useRef, useState } from 'react';
import { formatTime } from '../utils/youtube';
import { songKey, playerHasSong, playerArtwork } from '../utils/song';
import './PlayerList.css';

export default function PlayerList({
  players,
  currentPlayerIndex,
  onEdit,
  onDelete,
  onReorder,
  onPlayPlayer,
  downloading = {},
  saveStatus = {},
  pendingUpdates = {},
}) {
  // Pointer-based drag reorder, driven from the drag handle (☰). Only the
  // handle claims touches (touch-action: none), so the rest of each row and
  // the page scroll natively with one or two fingers.
  const [touchDragIndex, setTouchDragIndex] = useState(null);
  const dragRef = useRef(null); // { pointerId, fromIndex }

  const handleDragStart = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { pointerId: event.pointerId, fromIndex: index };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setTouchDragIndex(index);
    if (navigator.vibrate) navigator.vibrate(20);
  };

  const handleDragMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('.player-item');
    if (!row) return;
    const toIndex = Number(row.dataset.index);
    if (!Number.isInteger(toIndex) || toIndex === drag.fromIndex) return;
    const reordered = [...players];
    const [moved] = reordered.splice(drag.fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    onReorder(reordered);
    drag.fromIndex = toIndex;
    setTouchDragIndex(toIndex);
    event.preventDefault();
  };

  const handleDragEnd = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setTouchDragIndex(null);
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
          className={`player-item ${currentPlayerIndex === index ? 'current' : ''} ${touchDragIndex === index ? 'touch-dragging' : ''}`}
          data-index={index}
          onClick={() => onPlayPlayer(index)}
          onDragOver={(e) => e.preventDefault()}
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
            {playerHasSong(player) ? (
              <div className="song-info">
                {playerArtwork(player) && (
                  <img
                    src={playerArtwork(player)}
                    alt={player.songTitle || songKey(player)}
                    className="song-thumbnail-small"
                  />
                )}
                <div className="song-details">
                  <span className="song-title" title={player.songUrl}>
                    {player.songTitle || songKey(player)}
                    {pendingUpdates[player.id] && (
                      <span className="pending-update-badge">Updated ✓</span>
                    )}
                  </span>
                  <span className="song-time-row">
                    <span className="song-time">
                      {formatTime(player.startTime)} ({player.duration}s)
                    </span>
                    {player.lastChangedBy === 'coach' && (
                      <span className="coach-update-badge">Coach updated</span>
                    )}
                  </span>
                  {downloading[songKey(player)] && (
                    <span className="offline-status">
                      {saveStatus[songKey(player)] || 'Downloading…'}
                    </span>
                  )}
                </div>
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
              title="Press and slide to reorder"
              onPointerDown={(e) => handleDragStart(e, index)}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
            >
              ☰
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
