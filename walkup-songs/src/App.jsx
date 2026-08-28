import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useYouTubePlayer } from './hooks/useYouTubePlayer';
import TeamSelector from './components/TeamSelector';
import PlayerList from './components/PlayerList';
import PlayerForm from './components/PlayerForm';
import PlaybackControls from './components/PlaybackControls';
import YouTubePlayer from './components/YouTubePlayer';
import ShareDialog from './components/ShareDialog';
import ParentView from './components/ParentView';
import CoachAccountDialog from './components/CoachAccountDialog';
import {
  createTeam,
  fetchTeam,
  shareUrlForTeam,
  teamIdFromLocation,
  getCurrentCoach,
  syncAccountTeam
} from './utils/api';
import {
  listSongs,
  saveSong,
  removeSong,
  clearLibrary
} from './utils/offlineLibrary';
import { downloadPreview } from './utils/previewDownloader';
import { songKey } from './utils/song';
import { playAnnouncement, stopAnnouncement, preloadAnnouncements } from './utils/announcer';
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
  const playbackRequestRef = useRef(0);
  const activePlayerIdRef = useRef(null);
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
  const [publishingCoachChange, setPublishingCoachChange] = useState(false);
  const [showCoachAccount, setShowCoachAccount] = useState(false);
  const [coachAccount, setCoachAccount] = useState(null);

  // Parent mode: URL is /team/<id> — render the simple parent view instead.
  const parentTeamId = teamIdFromLocation();

  useEffect(() => {
    getCurrentCoach().then((result) => {
      if (result.authenticated) setCoachAccount(result);
    }).catch(() => {});
  }, []);

  const currentTeam = storage.currentTeam;
  const players = currentTeam?.players || [];
  // Per-team toggle for the "Now batting..." announcer intro (default on).
  const announcerEnabled = currentTeam?.announcerEnabled !== false;

  // Preload the announcer clips for the whole roster so the first tap
  // on game day is instant. Each name is generated once server-side
  // and cached in KV, so replays are free.
  useEffect(() => {
    if (players.length === 0 || !announcerEnabled) return;
    preloadAnnouncements(players.map((p) => ({
      name: p.pronounced || p.name,
      number: p.number || ''
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players.length, announcerEnabled]);

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

  // Download and store a player's Apple song locally. Returns true when the
  // song was saved. YouTube songs are streamed and intentionally not saved.
  const savePlayerSong = async (player) => {
    const key = songKey(player);
    if (!key || offlineSongs[key] || downloading[key]) return false;

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
      return true;
    } catch (error) {
      console.error('Offline save failed:', error);
      setOfflineError(
        `Couldn't save "${player.songTitle || key}": ${friendlySaveError(error?.message)}`
      );
      return false;
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

  const handleSaveOffline = (player) => savePlayerSong(player);

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

  // One-tap catch-up: download every Apple song that isn't saved offline yet.
  // YouTube songs can't be saved (YouTube streams encrypted segments and its
  // ToS forbid downloads), so they are counted and reported, not attempted.
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const handleSyncOffline = async () => {
    if (!currentTeam || syncing) return;
    const roster = currentTeam.players || [];
    const pending = roster.filter(
      (p) => p.songSource === 'apple' && !!songKey(p) &&
        !offlineSongs[songKey(p)] && !downloading[songKey(p)]
    );
    const ytCount = roster.filter(
      (p) => p.songSource !== 'apple' && !!p.songVideoId
    ).length;
    const ytNote = ytCount
      ? ` \u00b7 ${ytCount} YouTube song${ytCount === 1 ? '' : 's'} unable to save offline`
      : '';
    if (pending.length === 0) {
      setSyncStatus(`All songs are already saved offline${ytNote}`);
      return;
    }
    setSyncing(true);
    let saved = 0;
    let failed = 0;
    for (let i = 0; i < pending.length; i += 1) {
      const p = pending[i];
      setSyncStatus(`Syncing ${i + 1}/${pending.length}: ${p.songTitle || p.name || 'song'}…`);
      const ok = await savePlayerSong(p);
      if (ok) saved += 1;
      else failed += 1;
    }
    const summary = `Synced ${saved} song${saved === 1 ? '' : 's'} offline`
      + (failed ? `, ${failed} failed` : '')
      + ytNote;
    setSyncStatus(summary);
    setSyncing(false);
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

    // The coach just touched this player's song, so their version is now the
    // authoritative one. Record the edit time so a parent's OLDER submission
    // (already in the shared roster) is no longer offered as an update to
    // apply back over the coach's newer edit.
    playerData = { ...playerData, updatedAt: Date.now(), lastChangedBy: 'coach' };

    const oldKey = editingPlayer ? songKey(editingPlayer) : null;

    if (editingPlayer) {
      storage.updatePlayer(currentTeam.id, editingPlayer.id, playerData);
    } else {
      storage.addPlayer(currentTeam.id, playerData);
    }

    setShowPlayerForm(false);
    setEditingPlayer(null);

    // Auto-save the song locally as soon as a playable Apple song is set, so
    // it's ready for offline playback without tapping anything. YouTube songs
    // are streamed from YouTube and are intentionally NOT saved locally. On
    // edit, re-save when the song changed OR the walk-up window moved (the
    // saved clip is trimmed to the window, so it must be cut again).
    const newKey = songKey(playerData);
    const isAppleSong = playerData.songSource === 'apple';
    const windowChanged =
      editingPlayer &&
      (Number(playerData.startTime) !== Number(editingPlayer.startTime) ||
        Number(playerData.duration) !== Number(editingPlayer.duration));
    if (isAppleSong && newKey && (!oldKey || oldKey !== newKey || windowChanged)) {
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

    if (coachAccount?.email && currentTeam.sharedTeamId) {
      syncAccountTeam({ sharedTeamId: currentTeam.sharedTeamId, name: currentTeam.name, players: (currentTeam.players || []).map((p) => String(p.id) === String(playerData.id || editingPlayer?.id) ? { ...p, ...playerData } : p) }).catch((error) => console.error('Account sync failed:', error));
    }

    // Publish coach song edits automatically when this team already has a
    // parent link. The local save remains immediate; publishing is best-effort
    // and does not block the coach from continuing to use the roster.
    if (currentTeam.sharedTeamId && playerData.songTitle) {
      setPublishingCoachChange(true);
      const publishedTeam = {
        ...currentTeam,
        players: (currentTeam.players || []).map((p) =>
          String(p.id) === String(playerData.id || editingPlayer?.id)
            ? { ...p, ...playerData }
            : p
        )
      };
      publishTeamToParents(publishedTeam)
        .catch((err) => console.error('Automatic coach sync failed:', err))
        .finally(() => setPublishingCoachChange(false));
    }
  };

  const publishTeamToParents = async (team) => {
    if (!team?.sharedTeamId || !team.players?.length) return;
    const payload = {
      name: team.name,
      players: team.players.map((p) => ({
        id: p.id,
        name: p.name,
        pronounced: p.pronounced || p.name || '',
        number: p.number || '',
        songTitle: p.songTitle || '',
        previewUrl: p.previewUrl || '',
        artworkUrl: p.artworkUrl || '',
        appleTrackId: p.appleTrackId || '',
        songVideoId: p.songVideoId || '',
        songThumbnail: p.songThumbnail || '',
        startTime: p.startTime || 0,
        duration: p.duration || 10,
        songSource: p.songSource || '',
        updatedAt: p.updatedAt || Date.now(),
        lastChangedBy: p.lastChangedBy || 'coach'
      })),
      teamId: team.sharedTeamId
    };
    await createTeam(payload);
    setPendingUpdates((prev) => {
      const next = { ...prev };
      team.players.forEach((p) => { delete next[p.id]; });
      return next;
    });
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
        activePlayerIdRef.current = null;
        stopAnnouncement();
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
          pronounced: p.pronounced || p.name || '',
          number: p.number || '',
          songTitle: p.songTitle || '',
          previewUrl: p.previewUrl || '',
          artworkUrl: p.artworkUrl || '',
          appleTrackId: p.appleTrackId || '',
          songVideoId: p.songVideoId || '',
          songThumbnail: p.songThumbnail || '',
          startTime: p.startTime || 0,
          duration: p.duration || 10,
          songSource: p.songSource || '',
          updatedAt: p.updatedAt || Date.now(),
          lastChangedBy: p.lastChangedBy || 'coach'
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

  // A remote player is a pending update when its song differs from the local
  // copy AND it is not older than the coach's local edit. The coach's own
  // edits are authoritative, so a parent's EARLIER submission must never be
  // offered as an update that would revert the coach's newer change. Only a
  // parent update strictly NEWER than the coach's last local touch wins.
  // When either side lacks a timestamp (legacy data), fall back to the plain
  // content diff so existing detection keeps working.
  const songSig = useCallback(
    (p) => [p.songTitle, p.pronounced, p.startTime, p.duration, p.previewUrl, p.songVideoId].join('|'),
    []
  );
  const isPending = useCallback((local, rp) => {
    if (songSig(local) === songSig(rp)) return false;
    const lT = Number(local.updatedAt || 0);
    const rT = Number(rp.updatedAt || 0);
    return !(lT && rT && lT >= rT);
  }, [songSig]);

  // Poll the shared roster every 30s so the coach sees parent song updates.
  // `players` is a fresh array each render, so key the effect on a stable
  // signature string instead to avoid re-running the fetch every render.
  const playerSig = players.map((p) => `${p.id}:${p.updatedAt}:${p.songTitle}:${p.startTime}:${p.duration}:${p.previewUrl}`).join('|');
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
          if (local && isPending(local, rp)) updates[rp.id] = rp;
          // A parent can add a song to an otherwise empty local player. Keep
          // that update visible even when legacy timestamps make comparison
          // ambiguous; the explicit Apply action will reconcile the record.
        });
        if (!cancelled) setPendingUpdates(updates);
      } catch {
        // Transient network error — try again next tick.
      }
    };
    check();
    const timer = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [sharedTeamId, playerSig, isPending]);

  // Apply parent song updates to the local roster. Parents often fine-tune a
  // song several times, so we re-fetch the shared roster at click time and
  // apply each player's most recent version — one click always lands the
  // latest update, never a stale polled snapshot. Falls back to the last
  // polled snapshot if the network hiccups.
  const handleApplyUpdates = async () => {
    if (!currentTeam) return;
    let toApply = pendingUpdates;
    if (sharedTeamId) {
      try {
        const remote = await fetchTeam(sharedTeamId);
        if (remote?.players) {
          const fresh = {};
          remote.players.forEach((rp) => {
            const local = players.find((p) => String(p.id) === String(rp.id));
            if (local && isPending(local, rp)) fresh[rp.id] = rp;
          });
          // A successful fetch is authoritative. An empty result means the
          // previously polled update is stale and must not be applied.
          toApply = fresh;
        }
      } catch {
        // Transient network error — fall back to the last polled snapshot.
      }
    }
    let applied = 0;
    Object.values(toApply).forEach((rp) => {
      // Remote ids are strings (JSON round-trip); match the local player by
      // string comparison to get its real id.
      const local = players.find((p) => String(p.id) === String(rp.id));
      if (!local) return;
      storage.updatePlayer(currentTeam.id, local.id, {
        songTitle: rp.songTitle,
        pronounced: rp.pronounced || rp.name || '',
        previewUrl: rp.previewUrl,
        artworkUrl: rp.artworkUrl,
        appleTrackId: rp.appleTrackId,
        songVideoId: rp.songVideoId,
        songThumbnail: rp.songThumbnail,
        startTime: rp.startTime,
        duration: rp.duration,
        songSource: rp.songSource || (rp.songVideoId ? 'youtube' : 'apple'),
        updatedAt: Date.now(),
        lastChangedBy: 'parent'
      });
      applied += 1;
    });
    setPendingUpdates({});
    if (applied > 0) {
      setShareStatus(`Applied ${applied} parent update${applied === 1 ? '' : 's'}. Re-share the link so everyone has the latest roster.`);
    }
  };

  const handlePlayPlayer = (index) => {
    const targetPlayer = players[index];
    if (!targetPlayer || !songKey(targetPlayer)) return;

    // A row is a strict play/stop toggle. Use a stable string id and the
    // synchronous ref so a second tap cannot observe stale React state.
    if (String(activePlayerIdRef.current) === String(targetPlayer.id)) {
      playbackRequestRef.current += 1;
      activePlayerIdRef.current = null;
      stopAnnouncement();
      player.stopSong();
      setCurrentPlayerIndex(null);
      return;
    }

    playbackRequestRef.current += 1;
    activePlayerIdRef.current = String(targetPlayer.id);
    const request = playbackRequestRef.current;
    setCurrentPlayerIndex(index);

    const isYouTube = targetPlayer.songSource !== 'apple' && !!targetPlayer.songVideoId;

    // YouTube songs: start a muted pre-roll right here inside the tap so
    // the video is already buffering (and playing silently) while the
    // announcement runs. iOS blocks unmuted autoplay outside a gesture —
    // that is why the song sometimes needed a manual play tap. Muted
    // playback is always allowed; commitYouTube() seeks to the exact start
    // second and unmutes when the announcement finishes.
    if (isYouTube) {
      player.prepareYouTube(targetPlayer.songVideoId, targetPlayer.startTime || 0);
    }

    const startSong = () => {
      if (request !== playbackRequestRef.current) return;
      if (isYouTube) {
        // Seek to the exact start second and unmute the pre-rolled video.
        player.commitYouTube(targetPlayer.startTime || 0, targetPlayer.duration || 30);
      } else {
        // Apple songs: play through the audio element (no pre-roll needed).
        player.playSong(
          targetPlayer,
          targetPlayer.startTime,
          targetPlayer.duration,
          null // No auto-advance
        );
      }
    };

    // Announce the player's name first, then play the walk-up song.
    // If the announcement is unavailable (no key, quota, network), the
    // song plays immediately.
    if (announcerEnabled) {
      playAnnouncement(
        targetPlayer.pronounced || targetPlayer.name,
        targetPlayer.number
      ).then(() => startSong());
    } else {
      // Announcer toggled off - skip straight to the walk-up song.
      startSong();
    }
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
    playbackRequestRef.current += 1;
    activePlayerIdRef.current = null;
    stopAnnouncement();
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

  const handleToggleAnnouncer = () => {
    if (!currentTeam) return;
    storage.updateTeam(currentTeam.id, { announcerEnabled: !announcerEnabled });
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
          {currentTeam && (
            <button
              className={`btn btn-sm announcer-toggle${announcerEnabled ? '' : ' is-off'}`}
              onClick={handleToggleAnnouncer}
              title={announcerEnabled ? 'Announcer intro is ON - tap to turn off' : 'Announcer intro is OFF - tap to turn on'}
              aria-pressed={announcerEnabled}
              aria-label="Toggle announcer intro"
            >
              {announcerEnabled ? '🔊' : '🔇'}
              <span className="announcer-toggle-label">Announcer</span>
            </button>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowCoachAccount(true)}
            title="Coach account"
          >
            {coachAccount ? 'Account' : 'Sign in'}
          </button>
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
                  {publishingCoachChange && <span className="syncing-coach-status">Saving coach change…</span>}
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
                    onClick={handleApplyUpdates}
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

      {showCoachAccount && (
        <CoachAccountDialog
          team={currentTeam}
          onClose={() => setShowCoachAccount(false)}
          onConnected={(connectedId, restored) => {
            setCoachAccount((current) => current || { email: 'signed-in coach' });
            if (restored) {
              storage.updateTeam(currentTeam.id, {
                name: restored.name,
                players: restored.players,
                sharedTeamId: connectedId
              });
            } else if (connectedId) {
              storage.updateTeam(currentTeam.id, { sharedTeamId: connectedId });
            }
          }}
        />
      )}

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
        <span className="offline-sync-area">
          <button
            className="offline-sync-btn"
            onClick={handleSyncOffline}
            disabled={syncing || players.length === 0}
            title="Download any songs not yet saved to this device"
          >
            {syncing ? 'Syncing…' : '🔄 Sync offline'}
          </button>
          {syncStatus && (
            <span className="offline-sync-status">{syncStatus}</span>
          )}
        </span>
      </footer>
    </div>
  );
}

export default App;
