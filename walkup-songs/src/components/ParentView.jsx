import { useEffect, useState } from 'react';
import { fetchTeam, updatePlayerSong } from '../utils/api';
import { playerArtwork } from '../utils/song';
import PlayerForm from './PlayerForm';
import './ParentView.css';

// Simplified view for parents opening a shared /team/<id> link. Shows the
// roster read-only; tapping a player opens the song editor. Saving a song
// writes straight to the Cloudflare API — no export/import round-trip.
export default function ParentView({ teamId }) {
  const [team, setTeam] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveConfirm, setSaveConfirm] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetchTeam(teamId)
      .then((data) => {
        if (!cancelled) setTeam(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message || 'Could not load team');
      });
    return () => { cancelled = true; };
  }, [teamId, reloadKey]);

  const retry = () => setReloadKey((k) => k + 1);

  if (!team) {
    return (
      <div className="parent-view">
        <div className="parent-loading">
          {loadError ? (
            <>
              ⚠️ {loadError}
              <button className="btn btn-secondary btn-sm" onClick={retry}>Retry</button>
            </>
          ) : (
            'Loading team…'
          )}
        </div>
      </div>
    );
  }

  const handleSave = async (playerData) => {
    if (!editingPlayer) return;
    setSaving(true);
    setSaveError(null);
    setSaveConfirm(null);
    try {
      const result = await updatePlayerSong(teamId, editingPlayer.id, playerData);
      // Reflect the saved song locally so the roster shows the update.
      setTeam((prev) => ({
        ...prev,
        updatedAt: result.updatedAt,
        players: prev.players.map((p) =>
          String(p.id) === String(editingPlayer.id) ? { ...p, ...result.player } : p
        )
      }));
      setEditingPlayer(null);
      setSaveConfirm(`✅ ${editingPlayer.name}'s song saved!`);
      setTimeout(() => setSaveConfirm(null), 4000);
    } catch (err) {
      setSaveError(err.message || 'Save failed — try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="parent-view">
      <header className="parent-header">
        <div className="parent-title">
          <h1>Dugout DJ</h1>
          <p className="parent-team-name">{team.name} — song updates</p>
        </div>
      </header>

      {saveConfirm && <div className="parent-confirm">{saveConfirm}</div>}
      {saveError && <div className="parent-error">⚠️ {saveError}</div>}

      {editingPlayer ? (
        <div className="parent-edit">
          <div className="parent-edit-heading">
            <h3>Update song for {editingPlayer.name}</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditingPlayer(null)}>
              ← Back to roster
            </button>
          </div>
          <PlayerForm
            player={editingPlayer}
            songOnly
            onSave={handleSave}
            onCancel={() => setEditingPlayer(null)}
          />
          {saving && <div className="parent-saving">Saving…</div>}
        </div>
      ) : (
        <>
          <p className="parent-intro">
            Tap a player to update their walk-up song. Changes save instantly — no need to send anything back.
          </p>
          <div className="parent-roster">
            {team.players.length === 0 && (
              <div className="parent-empty">No players in this roster yet.</div>
            )}
            {team.players.map((player, index) => (
              <button
                key={player.id || index}
                className="parent-player-row"
                onClick={() => setEditingPlayer(player)}
              >
                <span className="parent-order">{index + 1}</span>
                {playerArtwork(player) && (
                  <img
                    src={playerArtwork(player)}
                    alt={player.songTitle || player.name}
                    className="parent-thumb"
                  />
                )}
                <span className="parent-player-info">
                  <span className="parent-name">
                    {player.name}
                    {player.number ? <span className="parent-number">#{player.number}</span> : null}
                  </span>
                  <span className="parent-song">
                    {player.songTitle || 'No song selected'}
                  </span>
                </span>
                <span className="parent-edit-hint">✏️</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
