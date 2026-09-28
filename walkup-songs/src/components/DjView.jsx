import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchTeam, setTeamOrder } from '../utils/api';
import { getDjSession, verifyDjToken } from '../utils/dj';
import { playerArtwork, playerHasSong, songKey } from '../utils/song';
import { useYouTubePlayer } from '../hooks/useYouTubePlayer';
import { playAnnouncement, stopAnnouncement, preloadAnnouncements } from '../utils/announcer';
import { downloadPreview } from '../utils/previewDownloader';
import { fetchClip } from '../utils/mp3';
import { getSong, saveSong } from '../utils/offlineLibrary';
import { orderPlayers, rosterOrderIds } from '../utils/rosterOrder';
import { formatTime } from '../utils/youtube';
import PlaybackControls from './PlaybackControls';
import YouTubePlayer from './YouTubePlayer';
import LogoMark from './LogoMark';
import './DjView.css';

// The shared batting order is the source of truth (coach and every guest DJ
// console read the same value). It is mirrored into localStorage so the
// console opens with the right order instantly, even before the roster fetch
// lands — or while offline.
const ORDER_KEY_PREFIX = 'dugoutdj-dj-order:';

function readCachedOrder(teamId) {
  if (!teamId) return [];
  try {
    const raw = localStorage.getItem(ORDER_KEY_PREFIX + teamId);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function cacheOrder(teamId, ids) {
  if (!teamId) return;
  try {
    localStorage.setItem(ORDER_KEY_PREFIX + teamId, JSON.stringify(ids));
  } catch { /* storage unavailable — the shared order still loads */ }
}

// How much of the 3-day window is left, in words.
function describeRemaining(expiresAt, now) {
  const ms = Number(expiresAt || 0) - now;
  if (!ms || ms <= 0) return 'expired';
  const hours = ms / 3600000;
  // Round to whole days so a window of, say, 47.9 hours still reads "2 days".
  if (hours >= 24) {
    const days = Math.max(1, Math.round(hours / 24));
    return days === 1 ? '1 day' : `${days} days`;
  }
  if (hours >= 1) return `${Math.floor(hours)} hr`;
  return `${Math.max(1, Math.floor(ms / 60000))} min`;
}

// Game-day console for a guest DJ (a parent the coach invited).
//
// Reached at /dj/<token> — the link the coach emailed. It plays the same
// walk-up sequence as the coach console (announcer intro, Apple/YouTube/MP3
// playback, next/previous) but is strictly play-only: there is no add, edit,
// delete, or reorder anywhere, and access ends when the invite expires.
export default function DjView({ token }) {
  const player = useYouTubePlayer();

  const [session, setSession] = useState(null);
  const [team, setTeam] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);
  const [announcerOn, setAnnouncerOn] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Shared batting order (player ids).
  const [order, setOrder] = useState([]);
  const [dragging, setDragging] = useState(null);

  const requestRef = useRef(0);
  const activeIdRef = useRef(null);
  const dragRef = useRef(null);
  // Order sync: the server stamp of the order this device last applied or
  // wrote, the order still waiting to be written, and the drag debounce.
  const orderAtRef = useRef(0);
  const pendingOrderRef = useRef(null);
  const orderTimerRef = useRef(null);

  // Adopt a freshly fetched shared roster. Its batting order wins only when it
  // is newer than the one this console last applied — every stamp comes from
  // the server clock, so two devices can never disagree about which is more
  // recent (last write wins, whoever made it).
  const adoptTeam = useCallback((data, teamId) => {
    setTeam(data);
    const remoteOrder = Array.isArray(data?.order) ? data.order.map(String) : [];
    const remoteAt = Number(data?.orderUpdatedAt) || 0;
    if (!remoteOrder.length || remoteAt <= orderAtRef.current) return;
    orderAtRef.current = remoteAt;
    setOrder(remoteOrder);
    cacheOrder(teamId, remoteOrder);
    // Keep the highlighted row on the same player after the order moves.
    const index = orderPlayers(data?.players || [], remoteOrder)
      .findIndex((p) => String(p.id) === String(activeIdRef.current));
    setCurrentIndex(index >= 0 ? index : null);
  }, []);

  // Write the batting order and remember the stamp the server gave it.
  const flushOrder = useCallback(async (teamId, ids) => {
    try {
      const result = await setTeamOrder(teamId, ids);
      if (Number(result?.orderUpdatedAt)) orderAtRef.current = Number(result.orderUpdatedAt);
      if (pendingOrderRef.current?.join('|') === ids.join('|')) pendingOrderRef.current = null;
      setStatus('');
      return true;
    } catch (error) {
      console.error('Batting order sync failed:', error);
      setStatus('Batting order saved on this phone — syncing when the signal returns.');
      return false;
    }
  }, []);

  // Redeem the link (or reuse the cookie from an earlier visit).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = token ? await verifyDjToken(token) : await getDjSession();
        if (cancelled) return;
        if (!result?.active || !result.teamId) {
          throw new Error('This guest DJ link is no longer active. Ask the coach to send a new one.');
        }
        setSession(result);
        const data = await fetchTeam(result.teamId);
        if (!cancelled) adoptTeam(data, result.teamId);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not open the guest DJ console.');
      }
    })();
    return () => { cancelled = true; };
  }, [token, adoptTeam]);

  // Keep the "time left" badge honest without a per-second timer.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => {
    stopAnnouncement();
    if (orderTimerRef.current) clearTimeout(orderTimerRef.current);
  }, []);

  // Show the last known order instantly; the shared one replaces it as soon as
  // the roster arrives (or stays put if we are offline).
  useEffect(() => {
    setOrder(readCachedOrder(session?.teamId));
  }, [session?.teamId]);

  const players = team?.players || [];

  // The roster in the shared batting order. Anyone missing from the order (a
  // player the coach just added) keeps roster position at the end.
  const roster = useMemo(
    () => orderPlayers(team?.players || [], order),
    [team, order]
  );

  // Change the batting order: apply it immediately, then publish it — a drag
  // emits one change per row crossed, so the write is debounced.
  const saveOrder = useCallback((list) => {
    const ids = rosterOrderIds(list);
    setOrder(ids);
    const teamId = session?.teamId;
    cacheOrder(teamId, ids);
    if (!teamId) return;
    pendingOrderRef.current = ids;
    if (orderTimerRef.current) clearTimeout(orderTimerRef.current);
    orderTimerRef.current = setTimeout(() => {
      orderTimerRef.current = null;
      flushOrder(teamId, ids);
    }, 900);
  }, [session?.teamId, flushOrder]);

  const moveBy = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= roster.length) return;
    const next = [...roster];
    [next[index], next[target]] = [next[target], next[index]];
    saveOrder(next);
  };

  // Press-and-slide reordering, driven from the ☰ handle. Only the handle
  // claims touches (touch-action: none) so the page still scrolls normally
  // everywhere else on the roster.
  const handleDragStart = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { pointerId: event.pointerId, fromIndex: index };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(index);
    if (navigator.vibrate) navigator.vibrate(20);
  };

  const handleDragMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('.dj-row');
    if (!row) return;
    const toIndex = Number(row.dataset.index);
    if (!Number.isInteger(toIndex) || toIndex === drag.fromIndex) return;
    const next = [...roster];
    const [moved] = next.splice(drag.fromIndex, 1);
    next.splice(toIndex, 0, moved);
    saveOrder(next);
    drag.fromIndex = toIndex;
    setDragging(toIndex);
    event.preventDefault();
  };

  const handleDragEnd = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(null);
  };

  // Keep the console in step with the coach mid-game: songs he adds or edits,
  // and any batting-order change made on another device.
  useEffect(() => {
    const teamId = session?.teamId;
    if (!teamId) return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const data = await fetchTeam(teamId);
        if (cancelled) return;
        // Our own reorder hasn't landed yet — push it before adopting anything
        // so the server's older order never bounces our change back.
        if (pendingOrderRef.current) {
          if (orderTimerRef.current) {
            clearTimeout(orderTimerRef.current);
            orderTimerRef.current = null;
          }
          const synced = await flushOrder(teamId, pendingOrderRef.current);
          if (!synced || cancelled) return;
          const fresh = await fetchTeam(teamId);
          if (!cancelled) adoptTeam(fresh, teamId);
          return;
        }
        adoptTeam(data, teamId);
      } catch {
        // Transient network error — try again next tick.
      }
    }, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [session?.teamId, adoptTeam, flushOrder]);

  // Warm the announcer clips so the first batter isn't delayed.
  useEffect(() => {
    if (players.length === 0 || !announcerOn) return;
    preloadAnnouncements(players.map((p) => ({
      name: p.pronounced || p.name,
      number: p.number || ''
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players.length, announcerOn]);

  const stopAll = useCallback(() => {
    requestRef.current += 1;
    activeIdRef.current = null;
    stopAnnouncement();
    player.stopSong();
    setCurrentIndex(null);
  }, [player]);

  // Tapping a row announces the player then plays their walk-up song; tapping
  // the row that is already playing stops it.
  const playIndex = (index) => {
    const target = roster[index];
    if (!target || !songKey(target)) return;

    if (String(activeIdRef.current) === String(target.id)) {
      stopAll();
      return;
    }

    requestRef.current += 1;
    const request = requestRef.current;
    activeIdRef.current = String(target.id);
    setCurrentIndex(index);

    const isYouTube = target.songSource !== 'apple' && !!target.songVideoId;

    // Start a muted pre-roll inside the tap so iOS allows the song to play
    // unmuted after the announcement finishes.
    if (isYouTube) {
      player.prepareYouTube(target.songVideoId, target.startTime || 0);
    }

    const startSong = () => {
      if (request !== requestRef.current) return;
      if (isYouTube) {
        player.commitYouTube(target.startTime || 0, target.duration || 30);
      } else {
        player.playSong(target, target.startTime, target.duration, null);
      }
    };

    if (announcerOn) {
      playAnnouncement(target.pronounced || target.name, target.number).then(startSong);
    } else {
      startSong();
    }
  };

  // Download the roster's playable songs into this phone's offline library so
  // the console keeps working when the ballpark signal drops. Explicit rather
  // than automatic — a guest DJ may be on cellular.
  const saveSongsToPhone = async () => {
    if (preparing) return;
    const playable = players.filter(
      (p) => (p.songSource === 'apple' || p.songSource === 'mp3') && songKey(p)
    );
    if (!playable.length) {
      setStatus('This roster has no downloadable songs yet.');
      return;
    }
    setPreparing(true);
    let saved = 0;
    let already = 0;
    let failed = 0;
    for (let i = 0; i < playable.length; i += 1) {
      const p = playable[i];
      const key = songKey(p);
      setStatus(`Saving ${i + 1}/${playable.length}: ${p.songTitle || p.name || 'song'}…`);
      try {
        const existing = await getSong(key);
        if (existing?.blob?.size) {
          already += 1;
          continue;
        }
        const isMp3Clip = p.songSource === 'mp3';
        const result = isMp3Clip
          ? await fetchClip(p.mp3Key)
          : await downloadPreview(
              key,
              p.songTitle || key,
              p.previewUrl || null,
              p.startTime || 0,
              p.duration || 0
            );
        await saveSong({
          videoId: key,
          title: p.songTitle || key,
          blob: result.blob,
          mimeType: result.mimeType,
          size: result.blob.size,
          savedAt: Date.now(),
          trimmed: isMp3Clip ? true : !!result.trimmed
        });
        saved += 1;
      } catch (err) {
        console.error('Guest DJ save failed:', err);
        failed += 1;
      }
    }
    const youtubeCount = players.filter(
      (p) => p.songSource !== 'apple' && p.songSource !== 'mp3' && p.songVideoId
    ).length;
    setStatus(
      `Saved ${saved} song${saved === 1 ? '' : 's'} to this phone`
      + (already ? `, ${already} already saved` : '')
      + (failed ? `, ${failed} failed` : '')
      + (youtubeCount ? ` · ${youtubeCount} YouTube song${youtubeCount === 1 ? '' : 's'} stream live` : '')
    );
    setPreparing(false);
  };

  if (error) {
    return (
      <div className="dj-view dj-gate">
        <div className="dj-gate-card">
          <LogoMark size={48} />
          <h1>Guest DJ access ended</h1>
          <p>{error}</p>
          {/* The API message already tells them to ask the coach — only add
              the hint when the failure was something else (e.g. offline). */}
          {!/ask the coach/i.test(error) && (
            <p className="dj-gate-hint">
              Ask the coach to invite you again from their Share menu.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="dj-view dj-gate">
        <div className="dj-gate-card">
          <LogoMark size={48} />
          <h1>Opening the console…</h1>
          <p>Loading {session?.teamId ? 'the roster' : 'your guest DJ link'}.</p>
        </div>
      </div>
    );
  }

  const currentPlayer = currentIndex !== null ? roster[currentIndex] : null;

  return (
    <div className="dj-view">
      <header className="dj-header">
        <div className="dj-title">
          <LogoMark size={30} />
          <div>
            <h1>Dugout DJ</h1>
            <p className="dj-team-name">
              {team.name} · Guest DJ
              {session?.email ? ` (${session.email})` : ''}
            </p>
          </div>
        </div>
        <div className="dj-header-actions">
          <span className="dj-expiry" title="Your guest DJ access ends automatically">
            ⏳ {describeRemaining(session?.expiresAt, now)} left
          </span>
          <button
            className={`btn btn-sm announcer-toggle${announcerOn ? '' : ' is-off'}`}
            onClick={() => setAnnouncerOn((value) => !value)}
            aria-pressed={announcerOn}
            title={announcerOn ? 'Announcer intro is ON — tap to turn off' : 'Announcer intro is OFF — tap to turn on'}
          >
            {announcerOn ? '🔊' : '🔇'}
            <span className="announcer-toggle-label">Announcer</span>
          </button>
        </div>
      </header>

      <div className="dj-playback">
        <PlaybackControls
          currentPlayer={currentPlayer}
          currentPlayerIndex={currentIndex !== null ? currentIndex : 0}
          totalPlayers={roster.length}
          isPlaying={player.isPlaying}
          isOffline={player.isOffline}
          currentTime={player.currentTime}
          onPlay={() => {
            if (currentIndex === null) playIndex(0);
            else player.resumeSong();
          }}
          onPause={() => player.pauseSong()}
          onStop={stopAll}
          onNext={() => {
            if (currentIndex === null || roster.length === 0) return;
            playIndex((currentIndex + 1) % roster.length);
          }}
          onPrevious={() => {
            if (currentIndex === null || roster.length === 0) return;
            playIndex(currentIndex - 1 >= 0 ? currentIndex - 1 : roster.length - 1);
          }}
          onReplay={() => {
            if (currentIndex !== null) playIndex(currentIndex);
          }}
        />
      </div>

      <p className="dj-intro">
        Tap a player to announce them and play their walk-up song. Tap again to stop.
        Press ☰ to slide players into the batting order — it syncs, so the coach sees the
        same order on their phone.
      </p>

      <div className="dj-roster">
        {roster.length === 0 && (
          <div className="dj-empty">This roster has no players yet.</div>
        )}
        {roster.map((p, index) => {
          const isActive = String(activeIdRef.current) === String(p.id);
          const playable = playerHasSong(p);
          return (
            <div
              key={p.id || index}
              className={`dj-row${isActive ? ' is-playing' : ''}${playable ? '' : ' is-disabled'}${dragging === index ? ' is-dragging' : ''}`}
              data-index={index}
              role="button"
              tabIndex={0}
              aria-disabled={!playable}
              aria-label={`${p.name}${p.songTitle ? `, ${p.songTitle}` : ', no song set'}`}
              onClick={() => playIndex(index)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  playIndex(index);
                }
              }}
            >
              <span className="dj-order">{index + 1}</span>
              {playerArtwork(p) ? (
                <img
                  src={playerArtwork(p)}
                  alt=""
                  className="dj-thumb"
                />
              ) : (
                <span className="dj-thumb dj-thumb-empty" aria-hidden="true">♪</span>
              )}
              <span className="dj-info">
                <span className="dj-name">
                  {p.name}
                  {p.number ? <span className="dj-number">#{p.number}</span> : null}
                </span>
                <span className="dj-song">
                  {playable
                    ? `${p.songTitle || songKey(p)} · ${formatTime(p.startTime)} (${p.duration || 0}s)`
                    : 'No song set'}
                </span>
              </span>
              <span className="dj-play-icon" aria-hidden="true">
                {playable ? (isActive ? '⏹' : '▶') : '—'}
              </span>
              <span className="dj-row-actions">
                <button
                  type="button"
                  className="btn-icon btn-xs dj-move"
                  onClick={(event) => { event.stopPropagation(); moveBy(index, -1); }}
                  disabled={index === 0}
                  title="Move up in the batting order"
                  aria-label={`Move ${p.name} up`}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="btn-icon btn-xs dj-move"
                  onClick={(event) => { event.stopPropagation(); moveBy(index, 1); }}
                  disabled={index === roster.length - 1}
                  title="Move down in the batting order"
                  aria-label={`Move ${p.name} down`}
                >
                  ▼
                </button>
                <span
                  className="dj-drag-handle"
                  role="button"
                  tabIndex={0}
                  title="Press and slide to change the batting order"
                  aria-label={`Reorder ${p.name}`}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.stopPropagation(); }}
                  onPointerDown={(event) => handleDragStart(event, index)}
                  onPointerMove={handleDragMove}
                  onPointerUp={handleDragEnd}
                  onPointerCancel={handleDragEnd}
                >
                  ☰
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <footer className="dj-footer">
        <button
          className="btn btn-secondary btn-sm"
          onClick={saveSongsToPhone}
          disabled={preparing || players.length === 0}
          title="Download this roster's songs to this phone so they play with no signal"
        >
          {preparing ? 'Saving…' : '⬇️ Save songs to this phone'}
        </button>
        {status && <span className="dj-status">{status}</span>}
      </footer>

      <YouTubePlayer />
    </div>
  );
}
