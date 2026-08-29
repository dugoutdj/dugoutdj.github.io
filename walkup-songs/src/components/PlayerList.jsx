import { useEffect, useRef, useState } from 'react';
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
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [touchDragIndex, setTouchDragIndex] = useState(null);
  const touchStateRef = useRef(null);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const state = touchStateRef.current;
      if (!state || !state.dragging || event.pointerId !== state.pointerId) return;
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('.player-item');
      if (!row) return;
      const index = Number(row.dataset.index);
      if (!Number.isInteger(index) || index === state.index) return;
      const rect = row.getBoundingClientRect();
      const targetIndex = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
      const nextIndex = Math.max(0, Math.min(players.length - 1, targetIndex));
      if (nextIndex === state.index) return;
      const reordered = [...players];
      const [moved] = reordered.splice(state.index, 1);
      reordered.splice(nextIndex, 0, moved);
      onReorder(reordered);
      state.index = nextIndex;
      setTouchDragIndex(nextIndex);
      event.preventDefault();
    };
    const handlePointerUp = (event) => {
      const state = touchStateRef.current;
      if (state?.pointerId === event.pointerId) {
        clearTimeout(state.timer);
        touchStateRef.current = null;
        setTouchDragIndex(null);
      }
    };
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [players, onReorder]);

  const handlePointerDown = (event, index) => {
    if (event.pointerType !== 'touch') return;
    const target = event.target.closest('button, a, input, select, textarea');
    if (target) return;
    const row = event.currentTarget;
    const pointerId = event.pointerId;
    const timer = setTimeout(() => {
      touchStateRef.current = { pointerId, index, dragging: true };
      setTouchDragIndex(index);
      row.setPointerCapture?.(pointerId);
      if (navigator.vibrate) navigator.vibrate(30);
    }, 450);
    touchStateRef.current = { pointerId, index, timer, dragging: false };
  };

  const handlePointerCancel = (event) => {
    const state = touchStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    clearTimeout(state.timer);
    touchStateRef.current = null;
    setTouchDragIndex(null);
  };

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
          className={`player-item ${currentPlayerIndex === index ? 'current' : ''} ${touchDragIndex === index ? 'touch-dragging' : ''}`}
          data-index={index}
          onClick={(event) => {
            const state = touchStateRef.current;
            if (touchDragIndex !== null || state?.timer || state?.dragging) {
              event.preventDefault();
              return;
            }
            onPlayPlayer(index);
          }}
          onPointerDown={(event) => handlePointerDown(event, index)}
          onPointerCancel={handlePointerCancel}
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
