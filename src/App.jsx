import { useState, useEffect, useRef } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useYouTubePlayer } from './hooks/useYouTubePlayer';
import TeamSelector from './components/TeamSelector';
import PlayerList from './components/PlayerList';
import PlayerForm from './components/PlayerForm';
import PlaybackControls from './components/PlaybackControls';
import YouTubePlayer from './components/YouTubePlayer';
import ShareDialog from './components/ShareDialog';
import GameChangerImport from './components/GameChangerImport';
import { importFromGameChanger } from './utils/gamechanger';
import './App.css';

function App() {
  const storage = useLocalStorage();
  const player = useYouTubePlayer();

  const [showPlayerForm, setShowPlayerForm] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showGCImport, setShowGCImport] = useState(false);
  const [gcImportLoading, setGcImportLoading] = useState(false);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true); // Start collapsed
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false);
  const [premiumBannerDismissed, setPremiumBannerDismissed] = useState(
    localStorage.getItem('premiumBannerDismissed') === 'true'
  );
  const [bufferStatus, setBufferStatus] = useState({}); // { playerId: 'ready' | 'buffering' | 'error' | 'not-loaded' }

  const preloadQueueRef = useRef([]);
  const isPreloadingRef = useRef(false);

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

  const handleReorderPlayers = (reorderedPlayers) => {
    if (!currentTeam) return;
    storage.reorderPlayers(currentTeam.id, reorderedPlayers);
  };

  const handlePlayPlayer = (index) => {
    if (!players[index] || !players[index].songVideoId) return;

    const targetPlayer = players[index];
    setCurrentPlayerIndex(index);

    // Play song without auto-advance callback
    player.playSong(
      targetPlayer.songVideoId,
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
      // If player is already playing, just resume
      // If not playing (e.g., loading or failed on mobile), replay the current song
      if (player.isPlaying) {
        player.resumeSong();
      } else {
        // Replay current player (handles mobile autoplay issues and loading delays)
        handlePlayPlayer(currentPlayerIndex);
      }
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

  // Preload songs sequentially to show buffer status
  const preloadNextSong = () => {
    if (isPreloadingRef.current || preloadQueueRef.current.length === 0 || !player.isReady) {
      return;
    }

    isPreloadingRef.current = true;
    const nextPlayer = preloadQueueRef.current.shift();

    if (!nextPlayer || !nextPlayer.songVideoId) {
      isPreloadingRef.current = false;
      // Continue with next in queue
      if (preloadQueueRef.current.length > 0) {
        setTimeout(preloadNextSong, 100);
      }
      return;
    }

    // Set buffering status
    setBufferStatus(prev => ({ ...prev, [nextPlayer.id]: 'buffering' }));

    // Preload the song
    player.preloadSong(nextPlayer.songVideoId, nextPlayer.startTime, (success) => {
      setBufferStatus(prev => ({
        ...prev,
        [nextPlayer.id]: success ? 'ready' : 'error'
      }));

      isPreloadingRef.current = false;

      // Continue with next song after a short delay
      if (preloadQueueRef.current.length > 0) {
        setTimeout(preloadNextSong, 500); // 500ms delay between preloads
      }
    });
  };

  // Preload all songs when roster changes
  useEffect(() => {
    if (!currentTeam || !players || players.length === 0 || !player.isReady) {
      return;
    }

    // Reset buffer status for new roster
    const newBufferStatus = {};
    players.forEach(p => {
      if (p.songVideoId) {
        newBufferStatus[p.id] = 'not-loaded';
      }
    });
    setBufferStatus(newBufferStatus);

    // Queue all players with songs for preloading
    preloadQueueRef.current = players.filter(p => p.songVideoId);
    isPreloadingRef.current = false;

    // Start preloading after a short delay
    setTimeout(preloadNextSong, 1000);
  }, [currentTeam?.id, players, player.isReady]);

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

        {currentTeam && (
          <div className="header-playback">
            <PlaybackControls
              currentPlayer={currentPlayerIndex !== null ? players[currentPlayerIndex] : null}
              currentPlayerIndex={currentPlayerIndex}
              totalPlayers={players.length}
              isPlaying={player.isPlaying}
              isLoading={player.isLoading}
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
                <div>
                  <h2>{currentTeam.name}</h2>
                  <p className="team-subtitle">
                    {players.length} {players.length === 1 ? 'player' : 'players'}
                  </p>
                </div>
                <div className="team-header-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => setShowGCImport(true)}
                    title="Import roster from GameChanger"
                  >
                    📥 Import
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleAddPlayer}
                  >
                    + Add Player
                  </button>
                </div>
              </div>

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

              <PlayerList
                players={players}
                currentPlayerIndex={currentPlayerIndex}
                bufferStatus={bufferStatus}
                onEdit={handleEditPlayer}
                onDelete={handleDeletePlayer}
                onReorder={handleReorderPlayers}
                onPlayPlayer={handlePlayPlayer}
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
