import { useEffect, useRef, useState } from 'react';
import { fetchTeam, updatePlayerSong } from '../utils/api';
import { playerArtwork } from '../utils/song';
import { mediaProxy } from '../utils/media';
import { formatTime, loadYouTubeAPI } from '../utils/youtube';
import PlayerForm from './PlayerForm';
import './ParentView.css';

// Simplified view for parents opening a shared /team/<id> link. Shows the
// roster read-only; tapping a player opens the song editor. Saving a song
// writes straight to the Cloudflare API — no export/import round-trip.
// Each row also has a ▶ preview button that plays the exact walk-up window
// (startTime → startTime+duration) of the saved song.
export default function ParentView({ teamId }) {
  const [team, setTeam] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveConfirm, setSaveConfirm] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Which player id is currently playing a preview (null = none).
  const [previewingId, setPreviewingId] = useState(null);
  const audioRef = useRef(null);
  // Hidden YouTube player for previewing YouTube walk-up windows.
  const ytPlayerRef = useRef(null);
  const ytTimerRef = useRef(null);

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

  // Tear down the shared audio element and hidden YouTube player on unmount.
  useEffect(() => {
    return () => {
      if (ytTimerRef.current) {
        clearInterval(ytTimerRef.current);
        ytTimerRef.current = null;
      }
      const yt = ytPlayerRef.current;
      if (yt && typeof yt.destroy === 'function') yt.destroy();
      ytPlayerRef.current = null;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
    };
  }, []);

  const retry = () => setReloadKey((k) => k + 1);

  const stopPreview = () => {
    // Stop a YouTube preview if one is running.
    if (ytTimerRef.current) {
      clearInterval(ytTimerRef.current);
      ytTimerRef.current = null;
    }
    const yt = ytPlayerRef.current;
    if (yt && typeof yt.pauseVideo === 'function') yt.pauseVideo();
    // Stop an Apple <audio> preview if one is running.
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
    }
    setPreviewingId(null);
  };

  // Play the exact walk-up window of a player's saved song. Apple songs
  // stream the 30s preview via the media proxy (mobile-safe); YouTube songs
  // play through a hidden YouTube player. Both stop at startTime + duration.
  const previewPlayer = (player) => {
    if (!player) return;
    const isApple = player.songSource === 'apple';
    const isYouTube = !isApple && !!player.songVideoId;
    if (!isApple && !isYouTube) return;

    // Tapping the same row again stops playback.
    if (previewingId !== null && String(previewingId) === String(player.id)) {
      stopPreview();
      return;
    }

    stopPreview();

    const start = Math.max(0, Number(player.startTime) || 0);
    const duration = Math.max(1, Number(player.duration) || 10);

    // YouTube: play through the hidden YT player, stop at start + duration.
    if (isYouTube) {
      playYtPreview(player, start, duration);
      return;
    }

    const end = start + duration;

    // Create the audio element lazily on first use.
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      audioRef.current = audio;
    }
    const audio = audioRef.current;

    // Set the source inside the tap so iOS keeps the user gesture.
    audio.src = mediaProxy(player.previewUrl);
    audio.currentTime = start;
    audio.volume = 1;

    const onTime = () => {
      if (audio.currentTime >= end) {
        audio.pause();
        setPreviewingId(null);
      }
    };
    const onEnd = () => setPreviewingId(null);
    const onError = () => {
      setPreviewingId(null);
      setSaveError('Preview unavailable — try again in a moment.');
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('error', onError, { once: true });

    // Clean up listeners when playback of this window stops (either the
    // timeupdate stop above or the user tapping stop).
    const cleanup = () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('error', onError);
    };
    audio.onpause = () => {
      if (audio.currentTime >= end || audio.ended) cleanup();
    };

    const playPromise = audio.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(() => {
        setPreviewingId(null);
        setSaveError('Preview blocked — tap again to play.');
      });
    }
    setPreviewingId(String(player.id));
  };

  // Lazily create the hidden YouTube player used to preview a YouTube
  // walk-up window (Apple previews use the <audio> element instead).
  const getYtPreviewPlayer = () => {
    if (ytPlayerRef.current) return Promise.resolve(ytPlayerRef.current);
    return loadYouTubeAPI().then((YT) => {
      if (ytPlayerRef.current) return ytPlayerRef.current;
      return new Promise((resolve) => {
        let host = document.getElementById('parent-yt-preview');
        if (!host) {
          host = document.createElement('div');
          host.id = 'parent-yt-preview';
          host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
          document.body.appendChild(host);
        }
        let player = null;
        try {
          player = new YT.Player(host, {
            height: '1',
            width: '1',
            playerVars: {
              controls: 0,
              disablekb: 1,
              modestbranding: 1,
              playsinline: 1
            },
            events: {
              onReady: () => {
                ytPlayerRef.current = player;
                resolve(player);
              },
              onError: () => resolve(null)
            }
          });
        } catch {
          resolve(null);
        }
        // Safety net: don't hang callers if the API never fires onReady.
        setTimeout(() => resolve(ytPlayerRef.current || null), 15000);
      });
    }).catch(() => null);
  };

  // Play the exact walk-up window of a YouTube song via the hidden player.
  const playYtPreview = async (player, start, duration) => {
    const yt = await getYtPreviewPlayer();
    if (!yt || !player.songVideoId) {
      setPreviewingId(null);
      return;
    }
    const end = start + duration;
    try {
      yt.loadVideoById({ videoId: player.songVideoId, startSeconds: start });
      yt.playVideo();
      setPreviewingId(String(player.id));
      // Poll the playback position and stop exactly at start + duration.
      if (ytTimerRef.current) clearInterval(ytTimerRef.current);
      ytTimerRef.current = setInterval(() => {
        let t = 0;
        try { t = yt.getCurrentTime(); } catch { /* player busy */ }
        if (t >= end) {
          if (ytTimerRef.current) {
            clearInterval(ytTimerRef.current);
            ytTimerRef.current = null;
          }
          if (typeof yt.pauseVideo === 'function') yt.pauseVideo();
          setPreviewingId(null);
        }
      }, 100);
    } catch {
      setPreviewingId(null);
      setSaveError('Preview unavailable — try again in a moment.');
    }
  };

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

  const previewable = (player) =>
    (player.songSource === 'apple' && !!player.previewUrl) ||
    (player.songSource !== 'apple' && !!player.songVideoId);

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
            <button className="btn btn-secondary btn-sm" onClick={() => { stopPreview(); setEditingPlayer(null); }}>
              ← Back to roster
            </button>
          </div>
          <PlayerForm
            player={editingPlayer}
            songOnly
            lockScroll={false}
            onSave={handleSave}
            onCancel={() => { stopPreview(); setEditingPlayer(null); }}
          />
          {saving && <div className="parent-saving">Saving…</div>}
        </div>
      ) : (
        <>
          <p className="parent-intro">
            Tap ▶ to hear the exact walk-up section, or tap a player to update their song. Changes save instantly — no need to send anything back.
          </p>
          <div className="parent-roster">
            {team.players.length === 0 && (
              <div className="parent-empty">No players in this roster yet.</div>
            )}
            {/* Sort alphabetically by name so parents can find their kid easily. */}
            {[...team.players].sort((a, b) =>
              String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
            ).map((player, index) => {
              const isPreviewing = previewingId !== null && String(previewingId) === String(player.id);
              return (
                <div
                  key={player.id || index}
                  className="parent-player-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => setEditingPlayer(player)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setEditingPlayer(player);
                    }
                  }}
                >
                  {/* Show the jersey number instead of the roster slot number. */}
                  {player.number ? (
                    <span className="parent-order">#{player.number}</span>
                  ) : null}
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
                    </span>
                    <span className="parent-song">
                      {player.songTitle || 'No song selected'}
                    </span>
                    {player.lastChangedBy === 'coach' && (
                      <span className="parent-coach-update">Coach updated</span>
                    )}
                    {(player.songSource || player.songVideoId || player.songTitle) && (
                      <span className="parent-window">
                        Starts at {formatTime(player.startTime)} · {player.duration || 0}s
                      </span>
                    )}
                  </span>
                  {previewable(player) ? (
                    <button
                      type="button"
                      className={`parent-preview-btn${isPreviewing ? ' is-playing' : ''}`}
                      aria-label={isPreviewing ? 'Stop preview' : 'Preview walk-up section'}
                      onClick={(e) => {
                        e.stopPropagation();
                        previewPlayer(player);
                      }}
                    >
                      {isPreviewing ? '⏹' : '▶'}
                    </button>
                  ) : (
                    <span className="parent-edit-hint">✏️</span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
