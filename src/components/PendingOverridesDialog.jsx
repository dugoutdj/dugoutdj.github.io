import './PendingOverridesDialog.css';

export default function PendingOverridesDialog({ pending, players, onApprove, onDismiss, onClose }) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog pending-overrides-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>🔔 Pending Paid Overrides</h3>
          <button className="dialog-close" onClick={onClose}>×</button>
        </div>

        <div className="dialog-body">
          {pending.length === 0 ? (
            <p className="no-pending">No pending overrides.</p>
          ) : (
            pending.map((item) => {
              const player = players.find(p => String(p.id) === String(item.playerId));
              return item.queue.map((entry, i) => (
                <div key={`${item.playerId}-${i}`} className="pending-item">
                  <div className="pending-player">
                    {player ? player.name : `Player #${item.playerId}`}
                    {item.queue.length > 1 && (
                      <span className="pending-queue-pos"> (override {i + 1} of {item.queue.length})</span>
                    )}
                  </div>

                  <div className="pending-song">
                    {entry.songThumbnail && (
                      <img src={entry.songThumbnail} alt={entry.songTitle} className="pending-thumbnail" />
                    )}
                    <div className="pending-song-info">
                      <div className="pending-song-title">{entry.songTitle}</div>
                      <div className="pending-song-time">
                        Start: {entry.startTime}s · Duration: {entry.duration}s
                      </div>
                      <div className="pending-paid-at">
                        Paid {new Date(entry.paidAt).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>

                  <div className="pending-actions">
                    <button
                      className="btn btn-secondary"
                      onClick={() => onDismiss(item.playerId)}
                    >
                      Dismiss
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => onApprove(item.playerId, item.queue)}
                    >
                      ✓ Approve All
                    </button>
                  </div>
                </div>
              ));
            })
          )}
        </div>
      </div>
    </div>
  );
}
