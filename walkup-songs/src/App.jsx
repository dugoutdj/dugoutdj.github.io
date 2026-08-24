import { useState, useEffect, useCallback } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useYouTubePlayer } from './hooks/useYouTubePlayer';
import TeamSelector from './components/TeamSelector';
import PlayerList from './components/PlayerList';
import PlayerForm from './components/PlayerForm';
import PlaybackControls from './components/PlaybackControls';
import YouTubePlayer from './components/YouTubePlayer';
import ShareDialog from './components/ShareDialog';
import ParentView from './components/ParentView';
import {
  createTeam,
  fetchTeam,
  shareUrlForTeam,
  teamIdFromLocation
} from './utils/api';
import {
  listSongs,
  saveSong,
  removeSong,
  clearLibrary
} from './utils/offlineLibrary';
import { downloadPreview } from './utils/previewDownloader';
import { songKey } from './utils/song';
import './App.css';

// Keep the save-error banner human-friendly; map network failures to a
// plain-language message and pass the rest (already readable) through.
function friendlySaveError(message) {
  const text = String(message || '');
  if (/Failed to fetch|NetworkError|load failed|ERR_|TypeError/i.test(text)) {
    return "Couldn't reach Apple's servers. Check your internet connection and try again.";
  }
  const trimmed = text.length > 260 ? `${text.slice(0, 257)}…` : text;
  return trimmed || 'download failed';
}

function App() {
  const storage = useLocalStorage();
  const player = useYouTubePlayer();

  const [showPlayerForm, setShowPlayerForm] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true); // Start collapsed
  const [offlineSongs, setOfflineSongs] = useState({}); // videoId -> { size, savedAt, title }
  const [downloading, setDownloading] = useState({}); // videoId -> true
  const [libraryStats, setLibraryStats] = useState({ count: 0, bytes: 0 });
  const [offlineError, setOfflineError] = useState(null);
  const [saveStatus, setSaveStatus] = useState({});
  // Shared-with-parents state (coach side).
  const [sharedTeamId, setSharedTeamId] = useState(null); // coach's own shared id
  const [shareLink, setShareLink] = useState(null);       // generated URL for the coach
  const [shareStatus, setShareStatus] = useState('');     // coach-facing status text
  const [shareDismissed, setShareDismissed] = useState(false); // hide the status box (link stays live)
  const [pendingUpdates, setPendingUpdates] = useState({}); // playerId -> remote player data

  // Parent mode: URL is /team/<id> — render the simple parent view instead.
  const parentTeamId = teamIdFromLocation();

  const currentTeam = storage.currentTeam;
  const players = currentTeam?.players || [];

  // Initialize first team if none exists
  useEffect(() => {
    if (storage.teams.length === 0) {
      storage.addTeam('My Team');
    } else if (!storage.currentTeam && storage.teams.length > 0) {
      storage.setCurrentTeam(storage.teams[0].id);
    }
  }, []);

  // Restore a previously created share link so the parent URL is stable
  // across refreshes and re-clicks. The id is persisted on the team record.
  useEffect(() => {
    if (!currentTeam) return;
    const storedId = currentTeam.sharedTeamId || null;
    setSharedTeamId(storedId);
    setShareLink(storedId ? shareUrlForTeam(storedId) : null);
    if (storedId && !shareStatus) {
      setShareStatus('Your team link is ready — send it to parents:');
      setShareDismissed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTeam?.id]);

  // Preload disabled to prevent playback interference
  // TODO: Re-enable preloading after fixing playback issues

  // useEffect(() => {
  //   if (player.isReady && !player.isPlaying && players.length > 0 && currentPlayerIndex === null) {
  //     const firstPlayer = players[0];
  //     if (firstPlayer?.songVideoId) {
  //       setTimeout(() => {
  //         player.preloadSong(firstPlayer.songVideoId, firstPlayer.startTime);
  //       }, 500);
  //     }
  //   }
  // }, [player.isReady, player.isPlaying, players, currentPlayerIndex, player]);

  // useEffect(() => {
  //   if (!player.isPlaying && currentPlayerIndex !== null && players.length > 1 && hasPlayedOnce) {
  //     const nextIndex = (currentPlayerIndex + 1) % players.length;
  //     const nextPlayer = players[nextIndex];
  //     if (nextPlayer?.songVideoId) {
  //       player.preloadSong(nextPlayer.songVideoId, nextPlayer.startTime);
  //     }
  //   }
  // }, [player.isPlaying, currentPlayerIndex, players, player, hasPlayedOnce]);

  const refreshLibraryStats = useCallback(async () => {
    const songs = await listSongs();
    const bytes = songs.reduce((sum, song) => sum + (song.size || 0), 0);
    setLibraryStats({ count: songs.length, bytes });
    return songs;
  }, []);

  // Load the offline library once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const songs = await refreshLibraryStats();
      if (cancelled) return;
      const map = {};
      songs.forEach((song) => {
        map[song.videoId] = {
          size: song.size || 0,
          savedAt: song.savedAt || 0,
          title: song.title || ''
        };
      });
      setOfflineSongs(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshLibraryStats]);

  const formatBytes = (bytes) => {
    if (!bytes) return '0 MB';
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSaveOffline = async (player) => {
    const key = songKey(player);
    if (!key || offlineSongs[key] || downloading[key]) return;

    setOfflineError(null);
    setDownloading((prev) => ({ ...prev, [key]: true }));
    setSaveStatus((prev) => ({ ...prev, [key]: 'Finding song…' }));

    try {
      const result = await downloadPreview(
        key,
        player.songTitle || key,
        player.songSource === 'apple' ? player.previewUrl : null,
        player.startTime || 0,
        player.duration || 0,
        (progress) => {
          setSaveStatus((prev) => {
            let text = 'Downloading…';
            if (progress.stage === 'searching') text = 'Finding song…';
            else if (progress.stage === 'downloading' && progress.total) {
              const pct = Math.round((progress.downloaded / progress.total) * 100);
              text = `Downloading… ${pct}%`;
            }
            return { ...prev, [key]: text };
          });
        }
      );

      const record = {
        videoId: key,
        title: result.title || player.songTitle || key,
        blob: result.blob,
        mimeType: result.mimeType,
        size: result.blob.size,
        savedAt: Date.now(),
        // True when the blob is the exact walk-up window (already trimmed);
        // legacy/full-preview blobs are untrimmed and play offset by startTime.
        trimmed: !!result.trimmed
      };
      await saveSong(record);
      setOfflineSongs((prev) => ({
        ...prev,
        [key]: { size: record.size, savedAt: record.savedAt, title: record.title }
      }));
      await refreshLibraryStats();
    } catch (error) {
      console.error('Offline save failed:', error);
      setOfflineError(
        `Couldn't save "${player.songTitle || key}": ${friendlySaveError(error?.message)}`
      );
    } finally {
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setSaveStatus((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleRemoveOffline = async (key) => {
    if (!key) return;
    await removeSong(key);
    setOfflineSongs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    await refreshLibraryStats();
  };

  const handleClearOfflineLibrary = async () => {
    if (!confirm('Remove all saved offline songs from this device?')) return;
    await clearLibrary();
    setOfflineSongs({});
    await refreshLibraryStats();
  };

  const closePlayerForm = () => {
    setShowPlayerForm(false);
    setEditingPlayer(null);
  };

  const handleAddPlayer = () => {
    setEditingPlayer(null);
    setShowPlayerForm(true);
  };

  const handleEditPlayer = (player) => {
    setEditingPlayer(player);
    setShowPlayerForm(true);
  };

  const handleSavePlayer = (playerData) => {
    if (!currentTeam) return;

    const oldKey = editingPlayer ? songKey(editingPlayer) : null;

    if (editingPlayer) {
      storage.updatePlayer(currentTeam.id, editingPlayer.id, playerData);
    } else {
      storage.addPlayer(currentTeam.id, playerData);
    }

    setShowPlayerForm(false);
    setEditingPlayer(null);

    // Auto-save the song locally as soon as a playable song is set, so it's
    // ready for offline playback without tapping anything. On edit, re-save
    // when the song changed OR the walk-up window moved (the saved clip is
    // trimmed to the window, so it must be cut again).
    const newKey = songKey(playerData);
    const windowChanged =
      editingPlayer &&
      (Number(playerData.startTime) !== Number(editingPlayer.startTime) ||
        Number(playerData.duration) !== Number(editingPlayer.duration));
    if (newKey && (!oldKey || oldKey !== newKey || windowChanged)) {
      // Drop the stale copy first so the re-save isn't skipped as "already saved".
      if (oldKey && oldKey === newKey && windowChanged && offlineSongs[newKey]) {
        handleRemoveOffline(newKey);
      }
      handleSaveOffline(playerData);
    }

    // If the song changed on edit, drop the old saved copy unless another
    // player still uses it.
    if (oldKey && oldKey !== newKey && offlineSongs[oldKey]) {
      const stillUsed = (currentTeam.players || []).some(
        (p) => p.id !== editingPlayer?.id && songKey(p) === oldKey
      );
      if (!stillUsed) {
        handleRemoveOffline(oldKey);
      }
    }
  };

  const handleDeletePlayer = (playerId) => {
    if (!currentTeam) return;
    storage.deletePlayer(currentTeam.id, playerId);

    // Reset current player if deleted
    if (currentPlayerIndex !== null) {
      const deletedPlayer = players.find(p => p.id === playerId);
      const deletedIndex = players.indexOf(deletedPlayer);
      if (deletedIndex === currentPlayerIndex) {
        setCurrentPlayerIndex(null);
        player.stopSong();
      } else if (deletedIndex < currentPlayerIndex) {
        setCurrentPlayerIndex(currentPlayerIndex - 1);
      }
    }
  };

  const handleReorderPlayers = (reorderedPlayers) => {
    if (!currentTeam) return;
    storage.reorderPlayers(currentTeam.id, reorderedPlayers);
  };

  // Post the current team to the Cloudflare API and give the coach a link to
  // share with parents.
  const handleShareWithParents = async () => {
    if (!currentTeam || !players.length) return;
    // Re-clicking the button brings the status box back.
    setShareDismissed(false);
    setShareStatus('Creating link…');
    try {
      const payload = {
        name: currentTeam.name,
        players: players.map((p) => ({
          id: p.id,
          name: p.name,
          number: p.number || '',
          songTitle: p.songTitle || '',
          previewUrl: p.previewUrl || '',
          artworkUrl: p.artworkUrl || '',
          appleTrackId: p.appleTrackId || '',
          startTime: p.startTime || 0,
          duration: p.duration || 10,
          songSource: p.songSource || ''
        })),
        // Reuse the existing shared id so the URL never changes.
        ...(currentTeam.sharedTeamId ? { teamId: currentTeam.sharedTeamId } : {})
      };
      const { teamId } = await createTeam(payload);
      const url = shareUrlForTeam(teamId);
      setSharedTeamId(teamId);
      setShareLink(url);
      // Persist the id on the team so refreshes keep the same link.
      storage.updateTeam(currentTeam.id, { sharedTeamId: teamId });
      try {
        await navigator.clipboard.writeText(url);
        setShareStatus('Link copied to clipboard! Share it with your team parents.');
      } catch {
        setShareStatus('Link created — copy it below.');
      }
    } catch (err) {
      console.error('Share failed:', err);
      setShareStatus(`Share failed: ${err.message}`);
    }
  };

  // Poll the shared roster every 30s so the coach sees parent song updates.
  // `players` is a fresh array each render, so key the effect on a stable
  // signature string instead to avoid re-running the fetch every render.
  const playerSig = players.map((p) => `${p.id}:${p.songTitle}:${p.startTime}:${p.duration}:${p.previewUrl}`).join('|');
  useEffect(() => {
    if (!sharedTeamId) return undefined;
    let cancelled = false;
    const check = async () => {
      try {
        const remote = await fetchTeam(sharedTeamId);
        if (cancelled || !remote?.players) return;
        const updates = {};
        remote.players.forEach((rp) => {
          const local = players.find((p) => String(p.id) === String(rp.id));
          const sig = (p) => [p.songTitle, p.startTime, p.duration, p.previewUrl].join('|');
          if (local && sig(local) !== sig(rp)) updates[rp.id] = rp;
        });
        if (!cancelled) setPendingUpdates(updates);
      } catch {
        // Transient network error — try again next tick.
      }
    };
    check();
    const timer = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [sharedTeamId, playerSig]);

  const handlePlayPlayer = (index) => {
    if (!players[index] || !songKey(players[index])) return;

    const targetPlayer = players[index];
    setCurrentPlayerIndex(index);

    // Play song without auto-advance callback
    player.playSong(
      targetPlayer,
      targetPlayer.startTime,
      targetPlayer.duration,
      null // No auto-advance
    );
  };

  const handlePlay = () => {
    if (currentPlayerIndex === null) {
      // Start from first player
      handlePlayPlayer(0);
    } else {
      player.resumeSong();
    }
  };

  const handlePause = () => {
    player.pauseSong();
  };

  const handleStop = () => {
    player.stopSong();
    setCurrentPlayerIndex(null);
  };

  const handleNext = () => {
    if (currentPlayerIndex === null || players.length === 0) return;

    // Loop back to first player when reaching the end
    const nextIndex = (currentPlayerIndex + 1) % players.length;
    handlePlayPlayer(nextIndex);
  };

  const handlePrevious = () => {
    if (currentPlayerIndex === null || players.length === 0) return;

    // Loop to last player when going back from first
    const prevIndex = currentPlayerIndex - 1 >= 0
      ? currentPlayerIndex - 1
      : players.length - 1;
    handlePlayPlayer(prevIndex);
  };

  const handleReplay = () => {
    if (currentPlayerIndex !== null) {
      handlePlayPlayer(currentPlayerIndex);
    }
  };

  const handleRenameTeam = (teamId, newName) => {
    storage.updateTeam(teamId, { name: newName });
  };

  const handleImport = (importedData) => {
    storage.importTeamData(importedData);
    setCurrentPlayerIndex(null);
    player.stopSong();
  };

  // If the URL is a shared parent link (/team/<id>), show the parent view
  // exclusively — no roster editing, no playback, no offline library.
  if (parentTeamId) {
    return <ParentView teamId={parentTeamId} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <button
            className="header-menu-toggle"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Open menu' : 'Close menu'}
            aria-label={sidebarCollapsed ? 'Open menu' : 'Close menu'}
          >
            ☰
          </button>

          <div className="app-title">
            <h1 title="Walk-Up Song Manager">Dugout DJ</h1>
          </div>
        </div>

        {currentTeam && (
          <div className="header-playback">
            <PlaybackControls
              currentPlayer={currentPlayerIndex !== null ? players[currentPlayerIndex] : null}
              currentPlayerIndex={currentPlayerIndex}
              totalPlayers={players.length}
              isPlaying={player.isPlaying}
              isOffline={player.isOffline}
              currentTime={player.currentTime}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={handleStop}
              onNext={handleNext}
              onPrevious={handlePrevious}
              onReplay={handleReplay}
            />
          </div>
        )}

        <div className="app-actions">
          <button
            className="btn btn-secondary btn-sm share-btn"
            onClick={() => setShowShareDialog(true)}
            title="Share team data"
            aria-label="Share team data"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
              <polyline points="16 6 12 2 8 6"></polyline>
              <line x1="12" y1="2" x2="12" y2="15"></line>
            </svg>
          </button>
        </div>
      </header>

      <div className={`app-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className={`app-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          {!sidebarCollapsed && (
            <TeamSelector
              teams={storage.teams}
              currentTeam={currentTeam}
              onSelectTeam={storage.setCurrentTeam}
              onAddTeam={storage.addTeam}
              onDeleteTeam={storage.deleteTeam}
              onRenameTeam={handleRenameTeam}
            />
          )}
        </aside>

        <main className="app-main">
          {currentTeam && (
            <>
              <div className="team-header">
                <div>
                  <h2>{currentTeam.name}</h2>
                  <p className="team-subtitle">
                    {players.length} {players.length === 1 ? 'player' : 'players'}
                  </p>
                </div>
                <div className="team-header-actions">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleShareWithParents}
                    disabled={players.length === 0}
                    title="Create a link parents can open to update songs"
                  >
                    🔗 Share with Parents
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleAddPlayer}
                  >
                    + Add Player
                  </button>
                </div>

              {shareStatus && !shareDismissed && (
                <div className="share-status">
                  <span>{shareStatus}</span>
                  {shareLink && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        navigator.clipboard.writeText(shareLink)
                          .then(() => setShareStatus('Link copied to clipboard!'))
                          .catch(() => setShareStatus('Could not copy — select the link below.'));
                      }}
                    >
                      Copy again
                    </button>
                  )}
                  {shareLink && (
                    <code className="share-link">{shareLink}</code>
                  )}
                  <button
                    className="share-dismiss-btn"
                    onClick={() => setShareDismissed(true)}
                    title="Hide this box — your link stays active for parents"
                    aria-label="Dismiss share link box"
                  >
                    ✕
                  </button>
                </div>
              )}

              {Object.keys(pendingUpdates).length > 0 && (
                <div className="pending-updates">
                  <span>
                    🆕 {Object.keys(pendingUpdates).length} player{Object.keys(pendingUpdates).length === 1 ? '' : 's'} updated their song!
                  </span>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      Object.values(pendingUpdates).forEach((rp) => {
                        if (!currentTeam) return;
                        // Remote ids are strings (JSON round-trip); match the
                        // local player by string comparison to get its real id.
                        const local = players.find(
                          (p) => String(p.id) === String(rp.id)
                        );
                        if (!local) return;
                        storage.updatePlayer(currentTeam.id, local.id, {
                          songTitle: rp.songTitle,
                          previewUrl: rp.previewUrl,
                          artworkUrl: rp.artworkUrl,
                          appleTrackId: rp.appleTrackId,
                          startTime: rp.startTime,
                          duration: rp.duration,
                          songSource: rp.songSource || 'apple'
                        });
                      });
                      setPendingUpdates({});
                      setShareStatus('Applied parent updates. Re-share the link so everyone has the latest roster.');
                    }}
                  >
                    Apply updates
                  </button>
                </div>
              )}
              </div>

              {showPlayerForm && (
                <div
                  className="player-form-overlay"
                  role="dialog"
                  aria-modal="true"
                  aria-label={editingPlayer ? 'Edit Player' : 'Add Player'}
                >
                  <div
                    className="player-form-backdrop"
                    onClick={closePlayerForm}
                  />
                  <div className="player-form-dialog">
                    <div className="dialog-header">
                      <h3>{editingPlayer ? 'Edit Player' : 'Add Player'}</h3>
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={closePlayerForm}
                        aria-label="Close"
                      >
                        ✕
                      </button>
                    </div>
                    <PlayerForm
                      player={editingPlayer}
                      onSave={handleSavePlayer}
                      onCancel={closePlayerForm}
                    />
                  </div>
                </div>
              )}

              {offlineError && (
                <div className="offline-error" onClick={() => setOfflineError(null)}>
                  ⚠️ {offlineError}
                </div>
              )}

              <PlayerList
                players={players}
                currentPlayerIndex={currentPlayerIndex}
                onEdit={handleEditPlayer}
                onDelete={handleDeletePlayer}
                onReorder={handleReorderPlayers}
                onPlayPlayer={handlePlayPlayer}
                downloading={downloading}
                saveStatus={saveStatus}
                pendingUpdates={pendingUpdates}
              />
            </>
          )}

          {!currentTeam && (
            <div className="no-team">
              <p>Create a team to get started!</p>
            </div>
          )}
        </main>
      </div>

      <YouTubePlayer />

      {showShareDialog && (
        <ShareDialog
          data={storage.data}
          onImport={handleImport}
          onClose={() => setShowShareDialog(false)}
          onShare={handleShareWithParents}
          shareLink={shareLink}
          shareStatus={shareStatus}
        />
      )}

      <footer className="app-footer">
        <span
          className="offline-library-info"
          title="Songs saved to this device play without internet"
        >
          Offline library: {libraryStats.count} {libraryStats.count === 1 ? 'song' : 'songs'} · {formatBytes(libraryStats.bytes)}
          {libraryStats.count > 0 && (
            <button
              className="offline-clear-btn"
              onClick={handleClearOfflineLibrary}
              title="Remove all saved offline songs"
            >
              Clear
            </button>
          )}
        </span>
      </footer>
    </div>
  );
}

export default App;
