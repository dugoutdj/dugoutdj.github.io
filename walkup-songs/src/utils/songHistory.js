// Per-player history of every distinct song + walk-up window the player has
// used, with a count of how many times the coach started that exact
// combination from the roster. One history row per (song, start, duration)
// so an earlier fine-tuned window stays exactly recoverable.
import { songKey } from './song';

const MAX_HISTORY = 40;

// Stable identity of one history row: song key + start + duration.
export function songComboKey(player) {
  const track = songKey(player);
  if (!track) return null;
  const start = Math.max(0, Math.floor(Number(player?.startTime) || 0));
  const duration = Math.max(1, Math.floor(Number(player?.duration) || 0));
  return `${track}|${start}|${duration}`;
}

function baseEntry(player, now) {
  const p = player || {};
  return {
    songSource: p.songSource === 'apple' ? 'apple' : (p.songVideoId ? 'youtube' : (p.songSource === 'youtube' ? 'youtube' : '')),
    songVideoId: p.songVideoId || '',
    appleTrackId: p.appleTrackId || '',
    songUrl: p.songUrl || '',
    previewUrl: p.previewUrl || '',
    artworkUrl: p.artworkUrl || '',
    songThumbnail: p.songThumbnail || '',
    songTitle: p.songTitle || '',
    startTime: Math.max(0, Math.floor(Number(p.startTime) || 0)),
    duration: Math.max(1, Math.floor(Number(p.duration) || 0)),
    plays: 0,
    firstUsedAt: now,
    lastUsedAt: now
  };
}

function freshFields(existing, player) {
  const p = player || {};
  return {
    songTitle: p.songTitle || existing.songTitle,
    previewUrl: p.previewUrl || existing.previewUrl,
    artworkUrl: p.artworkUrl || existing.artworkUrl,
    appleTrackId: p.appleTrackId || existing.appleTrackId,
    songVideoId: p.songVideoId || existing.songVideoId,
    songThumbnail: p.songThumbnail || existing.songThumbnail,
    songUrl: p.songUrl || existing.songUrl
  };
}

// Record the song+window the coach just saved/selected (keeps any plays the
// combo already accumulated).
export function rememberSong(history, player, now = Date.now()) {
  const base = Array.isArray(history) ? history : [];
  const combo = songComboKey(player);
  if (!combo || !player?.songTitle) return base;
  const existing = base.find((h) => songComboKey(h) === combo);
  if (existing) {
    return base.map((h) =>
      songComboKey(h) === combo
        ? { ...h, ...freshFields(h, player), lastUsedAt: now }
        : h
    );
  }
  const next = [baseEntry(player, now), ...base];
  return next.slice(0, MAX_HISTORY);
}

// Count one walk-up play of the current song+window (roster-row taps only).
// Lazily adds the combo when the player has never been saved through the
// form after this combo was set.
export function recordPlay(history, player, now = Date.now()) {
  const base = Array.isArray(history) ? history : [];
  const combo = songComboKey(player);
  if (!combo) return base;
  const existing = base.find((h) => songComboKey(h) === combo);
  if (existing) {
    return base.map((h) =>
      songComboKey(h) === combo
        ? { ...h, plays: (Number(h.plays) || 0) + 1, lastPlayedAt: now }
        : h
    );
  }
  const entry = { ...baseEntry(player, now), plays: 1, lastPlayedAt: now };
  return [entry, ...base].slice(0, MAX_HISTORY);
}

// Sort a player's history for display: most-played first, then most recently
// used. Songs never played sink below played ones.
export function sortHistory(history) {
  const rows = Array.isArray(history) ? history : [];
  return [...rows].sort((a, b) => {
    const byPlays = (Number(b.plays) || 0) - (Number(a.plays) || 0);
    if (byPlays !== 0) return byPlays;
    return (Number(b.lastUsedAt) || 0) - (Number(a.lastUsedAt) || 0);
  });
}
