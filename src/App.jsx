import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLocalStorage } from './hooks/useLocalStorage';
import TeamSelector from './components/TeamSelector';
import PlayerList from './components/PlayerList';
import PlayerForm from './components/PlayerForm';
import PlaybackControls from './components/PlaybackControls';
import PlayerYouTubeEmbed from './components/PlayerYouTubeEmbed';
import ShareDialog from './components/ShareDialog';
import PlayerShareDialog from './components/PlayerShareDialog';
import ImportUpdateDialog from './components/ImportUpdateDialog';
import PendingOverridesDialog from './components/PendingOverridesDialog';
import GameChangerImport from './components/GameChangerImport';
import { importFromGameChanger } from './utils/gamechanger';
import { WORKER_URL } from './constants/worker';
import './App.css';

function App() {
  const storage = useLocalStorage();
  const [searchParams, setSearchParams] = useSearchParams();

  const [showPlayerForm, setShowPlayerForm] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showPlayerShareDialog, setShowPlayerShareDialog] = useState(false);
  const [sharingPlayer, setSharingPlayer] = useState(null);
  const [showImportUpdateDialog, setShowImportUpdateDialog] = useState(false);
  const [importUpdateCode, setImportUpdateCode] = useState('');
  const [showImportOverrideDialog, setShowImportOverrideDialog] = useState(false);
  const [pendingCloudOverrides, setPendingCloudOverrides] = useState([]);
  const [showPendingDialog, setShowPendingDialog] = useState(false);
  const [showGCImport, setShowGCImport] = useState(false);
  const [gcImportLoading, setGcImportLoading] = useState(false);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [premiumBannerDismissed, setPremiumBannerDismissed] = useState(
    localStorage.getItem('premiumBannerDismissed') === 'true'
  );
  const [isPlaying, setIsPlaying] = useState(false);

  // Track YouTube player instances - one per roster player
  const playerInstancesRef = useRef({});
  // Track currently loaded video ID per player (to detect when reload is needed after override)
  const loadedVideoIdsRef = useRef({});

  const currentTeam = storage.currentTeam;
  const rawPlayers = currentTeam?.players || [];

  // Sort players: enabled first (by order), disabled last (by order)
  const players = useMemo(() => {
    return [...rawPlayers].sort((a, b) => {
      if (a.disabled === b.disabled) {
        return (a.order || 0) - (b.order || 0);
      }
      return a.disabled ? 1 : -1;
    });
  }, [rawPlayers]);

  // Initialize first team if none exists
  useEffect(() => {
    if (storage.teams.length === 0) {
      storage.addTeam('My Team');
    } else if (!storage.currentTeam && storage.teams.length > 0) {
      storage.setCurrentTeam(storage.teams[0].id);
    }
  }, []);

  // Check for GameChanger import redirect on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const gcData = urlParams.get('gc_data');

    if (gcData) {
      // Remove params from URL
      window.history.replaceState({}, '', window.location.pathname);

      try {
        const data = JSON.parse(decodeURIComponent(gcData));
        handleGameChangerDataImport(data);
      } catch (error) {
        console.error('Failed to parse GameChanger data:', error);
        alert('Failed to import: Invalid data format');
      }
    }
  }, []);

  // Check for update code from QR scan on mount
  useEffect(() => {
    const code = searchParams.get('code');
    if (code) {
      // Remove code param from URL
      setSearchParams({});

      // Open import dialog with the code
      setImportUpdateCode(code);
      setShowImportUpdateDialog(true);
    }
  }, [searchParams, setSearchParams]);

  // Poll for paid cloud overrides every 30 seconds
  useEffect(() => {
    if (!currentTeam) return;

    const poll = async () => {
      try {
        const res = await fetch(`${WORKER_URL}/api/pending/${currentTeam.id}`);
        if (res.ok) {
          const data = await res.json();
          setPendingCloudOverrides(data);
        }
      } catch {
        // Network errors are silent — operator may be offline
      }
    };

    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
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

    if (editingPlayer) {
      storage.updatePlayer(currentTeam.id, editingPlayer.id, playerData);
    } else {
      storage.addPlayer(currentTeam.id, playerData);
    }

    setShowPlayerForm(false);
    setEditingPlayer(null);
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

  const handleToggleDisabled = (playerId) => {
    if (!currentTeam) return;
    const player = players.find(p => p.id === playerId);
    if (!player) return;

    storage.updatePlayer(currentTeam.id, playerId, {
      disabled: !player.disabled
    });

    // Reset current player if disabling the active one
    if (currentPlayerIndex !== null) {
      const activePlayer = players[currentPlayerIndex];
      if (activePlayer && activePlayer.id === playerId && !player.disabled) {
        setCurrentPlayerIndex(null);
        setIsPlaying(false);
      }
    }
  };

  const handleReorderPlayers = (reorderedPlayers) => {
    if (!currentTeam) return;

    // Update each player's order property individually
    reorderedPlayers.forEach((player, index) => {
      if (player.order !== index) {
        storage.updatePlayer(currentTeam.id, player.id, {
          order: index
        });
      }
    });
  };

  const handlePlayPlayer = (index) => {
    console.log('handlePlayPlayer called with index:', index);
    console.log('Total players:', players.length);
    console.log('Player instances:', Object.keys(playerInstancesRef.current));

    if (!players[index] || !players[index].songVideoId) {
      console.warn('No player at index or no songVideoId');
      return;
    }

    const targetPlayer = players[index];
    console.log('Target player:', targetPlayer.name, targetPlayer.id);

    const ytPlayer = playerInstancesRef.current[targetPlayer.id];

    if (!ytPlayer) {
      console.warn('Player not ready yet for:', targetPlayer.name);
      console.warn('Available players:', Object.keys(playerInstancesRef.current));
      return;
    }

    console.log('Playing:', targetPlayer.name);

    // Stop any currently playing player
    Object.values(playerInstancesRef.current).forEach(p => {
      if (p && p.pauseVideo) p.pauseVideo();
    });

    // If moving to a different player, their at-bat is over — consume their override
    if (currentPlayerIndex !== null && currentPlayerIndex !== index) {
      consumeOverride(currentPlayerIndex);
    }

    setCurrentPlayerIndex(index);
    setIsPlaying(true);

    // Determine target video and start time (first queued override takes precedence)
    const override = targetPlayer.songOverrideQueue?.[0] ?? null;
    const targetVideoId = override ? override.videoId : targetPlayer.songVideoId;
    const targetStartTime = override ? (override.startTime ?? 0) : (targetPlayer.startTime || 0);

    ytPlayer.setVolume(100);

    // Only call loadVideoById if the loaded video differs from what we want to play
    if (loadedVideoIdsRef.current[targetPlayer.id] !== targetVideoId) {
      ytPlayer.loadVideoById({ videoId: targetVideoId, startSeconds: targetStartTime });
      loadedVideoIdsRef.current[targetPlayer.id] = targetVideoId;
    } else {
      ytPlayer.seekTo(targetStartTime, true);
      ytPlayer.playVideo();
    }
  };

  const handlePlay = () => {
    if (currentPlayerIndex === null) {
      handlePlayPlayer(0);
    } else {
      handlePlayPlayer(currentPlayerIndex);
    }
  };

  const handlePause = () => {
    if (currentPlayerIndex !== null && players[currentPlayerIndex]) {
      const ytPlayer = playerInstancesRef.current[players[currentPlayerIndex].id];
      if (ytPlayer && ytPlayer.pauseVideo) {
        ytPlayer.pauseVideo();
        setIsPlaying(false);
      }
    }
  };

  const handleStop = () => {
    // At-bat is abandoned — consume the current player's override
    consumeOverride(currentPlayerIndex);
    Object.values(playerInstancesRef.current).forEach(p => {
      if (p && p.pauseVideo) p.pauseVideo();
    });
    setCurrentPlayerIndex(null);
    setIsPlaying(false);
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

  // Shift the first override off a player's queue (their at-bat is over)
  const consumeOverride = (playerIndex) => {
    if (playerIndex === null || !currentTeam) return;
    const p = players[playerIndex];
    if (!p?.songOverrideQueue?.length) return;
    const remaining = p.songOverrideQueue.slice(1);
    storage.updatePlayer(currentTeam.id, p.id, {
      songOverrideQueue: remaining.length > 0 ? remaining : null
    });
  };

  // Handle when a player instance is ready
  const handlePlayerReady = (playerId, ytPlayer) => {
    playerInstancesRef.current[playerId] = ytPlayer;
    // Record the initially loaded video so we can detect when reloading is needed
    const player = players.find(p => p.id === playerId);
    loadedVideoIdsRef.current[playerId] = player?.songVideoId;
    console.log(`Player ${playerId} ready`);
  };

  // Handle when a song ends — shift the first queued override off so the next one is ready
  const handleSongEnded = (playerId) => {
    if (currentTeam) {
      const player = players.find(p => p.id === playerId);
      if (player?.songOverrideQueue?.length > 0) {
        const remaining = player.songOverrideQueue.slice(1);
        storage.updatePlayer(currentTeam.id, playerId, {
          songOverrideQueue: remaining.length > 0 ? remaining : null
        });
      }
    }
    setIsPlaying(false);
    setCurrentPlayerIndex(null);
  };

  // Cancel all queued overrides without playing
  const handleCancelOverride = (playerId) => {
    if (!currentTeam) return;
    storage.updatePlayer(currentTeam.id, playerId, { songOverrideQueue: null });
  };

  const handleRenameTeam = (teamId, newName) => {
    storage.updateTeam(teamId, { name: newName });
  };

  const handleImport = (importedData) => {
    storage.importTeamData(importedData);
    setCurrentPlayerIndex(null);
    player.stopSong();
  };

  const handleGameChangerDataImport = (data) => {
    setGcImportLoading(true);

    try {
      console.log('Import data received:', data);
      const { team, players } = data;
      const teamName = team.name || 'Imported Team';
      console.log('Team name:', teamName);
      console.log('Players count:', players?.length);

      let targetTeamId;

      // If current team exists and has 0 players, populate it instead of creating new team
      if (currentTeam && currentTeam.players.length === 0) {
        targetTeamId = currentTeam.id;
        // Update the team name
        storage.updateTeam(targetTeamId, { name: teamName });
        console.log('Using existing empty team ID:', targetTeamId);
      } else {
        // Create new team if no team or existing team has players
        targetTeamId = storage.addTeam(teamName);
        console.log('Created new team ID:', targetTeamId);
        // Switch to the new team
        storage.setCurrentTeam(targetTeamId);
      }

      // Transform and add players
      if (players && players.length > 0) {
        console.log('Adding players...');
        players.forEach((player, index) => {
          console.log(`Player ${index}:`, player);
          const playerData = {
            name: `${player.first_name || ''} ${player.last_name || ''}`.trim() ||
                  `${player.firstName || ''} ${player.lastName || ''}`.trim() ||
                  'Unknown Player',
            number: String(player.number || player.jersey_number || ''),
            songUrl: '',
            songVideoId: '',
            songTitle: '',
            songThumbnail: '',
            startTime: 0,
            duration: 20,
            order: index
          };
          console.log(`Adding player: ${playerData.name}`);
          storage.addPlayer(targetTeamId, playerData);
        });
      } else {
        console.warn('No players to add!');
      }

      // Reset playback
      setCurrentPlayerIndex(null);
      player.stopSong();

      alert(`Successfully imported ${teamName} with ${players?.length || 0} players!`);
    } catch (error) {
      console.error('GameChanger import failed:', error);
      alert(`Import failed: ${error.message}\n\nPlease try again or contact support.`);
    } finally {
      setGcImportLoading(false);
      setShowGCImport(false);
    }
  };

  const handleSharePlayer = (player) => {
    setSharingPlayer(player);
    setShowPlayerShareDialog(true);
  };

  const handleSongUpdate = (updateData) => {
    const { playerId, songVideoId, songTitle, songThumbnail, songUrl, startTime, duration, isOverride } = updateData;

    // Find the player and update their song
    const player = players.find(p => p.id === playerId);
    if (!player) {
      alert('Player not found!');
      return;
    }

    if (isOverride) {
      const currentQueue = player.songOverrideQueue || [];
      const newEntry = { videoId: songVideoId, startTime, duration, songTitle, songThumbnail };
      storage.updatePlayer(currentTeam.id, playerId, {
        songOverrideQueue: [...currentQueue, newEntry]
      });
      const position = currentQueue.length + 1;
      alert(`✓ Queued override #${position} for ${player.name}: "${songTitle}"`);
    } else {
      storage.updatePlayer(currentTeam.id, playerId, {
        songUrl,
        songVideoId,
        songTitle,
        songThumbnail,
        startTime,
        duration
      });
      alert(`✓ Updated ${player.name}'s song to "${songTitle}"`);
    }
  };

  // Memoize YouTube embeds to prevent unnecessary recreation
  const youtubeEmbeds = useMemo(() => {
    return players.map((rosterPlayer, index) => (
      <PlayerYouTubeEmbed
        key={rosterPlayer.id}
        player={rosterPlayer}
        isActive={currentPlayerIndex === index}
        activeOverride={currentPlayerIndex === index ? (rosterPlayer.songOverrideQueue?.[0] ?? null) : null}
        onReady={handlePlayerReady}
        onEnded={handleSongEnded}
      />
    ));
  }, [players, currentPlayerIndex]);

  const handleGameChangerImport = async (teamId, token) => {
    setGcImportLoading(true);

    try {
      const importedTeam = await importFromGameChanger(teamId, token);

      // Add the imported team
      const newTeamId = storage.addTeam(importedTeam.name);

      // Add all players to the team
      importedTeam.players.forEach(playerData => {
        storage.addPlayer(newTeamId, playerData);
      });

      // Switch to the new team
      storage.setCurrentTeam(newTeamId);

      // Reset playback
      setCurrentPlayerIndex(null);
      player.stopSong();

      alert(`Successfully imported ${importedTeam.name} with ${importedTeam.players.length} players!`);
    } catch (error) {
      console.error('GameChanger import failed:', error);
      alert(`Import failed: ${error.message}\n\nPlease try again or contact support.`);
    } finally {
      setGcImportLoading(false);
      setShowGCImport(false);
    }
  };

  const handleApproveCloudOverride = async (playerId, queue) => {
    if (!currentTeam) return;
    const player = players.find(p => String(p.id) === String(playerId));
    if (!player) return;

    const existing = player.songOverrideQueue || [];
    storage.updatePlayer(currentTeam.id, player.id, {
      songOverrideQueue: [...existing, ...queue]
    });

    // Clear from KV
    try {
      await fetch(`${WORKER_URL}/api/pending/${currentTeam.id}/${playerId}`, { method: 'DELETE' });
    } catch { /* ignore */ }

    setPendingCloudOverrides(prev => prev.filter(p => String(p.playerId) !== String(playerId)));
  };

  const handleDismissCloudOverride = async (playerId) => {
    try {
      await fetch(`${WORKER_URL}/api/pending/${currentTeam.id}/${playerId}`, { method: 'DELETE' });
    } catch { /* ignore */ }
    setPendingCloudOverrides(prev => prev.filter(p => String(p.playerId) !== String(playerId)));
  };

  const handleDismissPremiumBanner = () => {
    localStorage.setItem('premiumBannerDismissed', 'true');
    setPremiumBannerDismissed(true);
  };

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


        <div className="app-actions">
          {pendingCloudOverrides.length > 0 && (
            <button
              className="btn btn-secondary btn-sm notification-btn"
              onClick={() => setShowPendingDialog(true)}
              title="Pending paid overrides"
            >
              🔔
              <span className="notification-badge">{pendingCloudOverrides.length}</span>
            </button>
          )}
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
              {!premiumBannerDismissed && (
                <div className="youtube-premium-banner">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <p>
                    YouTube Premium Required - This service requires a YouTube Premium subscription for ad-free, uninterrupted playback during games.
                  </p>
                  <button
                    className="banner-close-btn"
                    onClick={handleDismissPremiumBanner}
                    aria-label="Dismiss banner"
                    title="Dismiss this message"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              )}

              <div className="team-header">
                <div className="team-info">
                  <h2>{currentTeam.name}</h2>
                  <p className="team-subtitle">
                    {players.length} {players.length === 1 ? 'player' : 'players'}
                  </p>
                </div>
              </div>

              <div className="team-header-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowGCImport(true)}
                  title="Import roster from GameChanger"
                >
                  📥 Import Team
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowImportUpdateDialog(true)}
                  title="Import permanent song update from parent"
                >
                  📲 Import Update
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowImportOverrideDialog(true)}
                  title="Import one at-bat override from parent"
                >
                  🎵 Import Override
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleAddPlayer}
                >
                  + Player
                </button>
              </div>

              <PlayerList
                players={players}
                currentPlayerIndex={currentPlayerIndex}
                youtubeEmbeds={youtubeEmbeds}
                onEdit={handleEditPlayer}
                onDelete={handleDeletePlayer}
                onToggleDisabled={handleToggleDisabled}
                onReorder={handleReorderPlayers}
                onPlayPlayer={handlePlayPlayer}
                onShare={handleSharePlayer}
                onCancelOverride={handleCancelOverride}
                pendingCloudOverrides={pendingCloudOverrides}
                onApproveCloudOverride={handleApproveCloudOverride}
                onDismissCloudOverride={handleDismissCloudOverride}
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


      {showShareDialog && (
        <ShareDialog
          data={storage.data}
          onImport={handleImport}
          onClose={() => setShowShareDialog(false)}
        />
      )}

      {showPlayerShareDialog && sharingPlayer && (
        <PlayerShareDialog
          player={sharingPlayer}
          teamId={currentTeam?.id}
          onClose={() => {
            setShowPlayerShareDialog(false);
            setSharingPlayer(null);
          }}
        />
      )}

      {showImportUpdateDialog && (
        <ImportUpdateDialog
          players={players}
          onImport={handleSongUpdate}
          onClose={() => {
            setShowImportUpdateDialog(false);
            setImportUpdateCode('');
          }}
          initialCode={importUpdateCode}
        />
      )}

      {showImportOverrideDialog && (
        <ImportUpdateDialog
          players={players}
          onImport={handleSongUpdate}
          onClose={() => setShowImportOverrideDialog(false)}
          mode="override"
        />
      )}

      {showPendingDialog && (
        <PendingOverridesDialog
          pending={pendingCloudOverrides}
          players={players}
          onApprove={handleApproveCloudOverride}
          onDismiss={handleDismissCloudOverride}
          onClose={() => setShowPendingDialog(false)}
        />
      )}

      {showPlayerForm && (
        <PlayerForm
          player={editingPlayer}
          onSave={handleSavePlayer}
          onCancel={() => {
            setShowPlayerForm(false);
            setEditingPlayer(null);
          }}
        />
      )}

      {showGCImport && (
        <GameChangerImport
          onImport={handleGameChangerDataImport}
          onCancel={() => setShowGCImport(false)}
        />
      )}

      {gcImportLoading && (
        <div className="loading-overlay">
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Importing from GameChanger...</p>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <p>
          <strong>YouTube Premium Required:</strong> This app requires a YouTube Premium subscription for uninterrupted playback without ads.
        </p>
        <p className="footer-secondary">
          Connect your device to a Bluetooth speaker for best experience
        </p>
      </footer>
    </div>
  );
}

export default App;
