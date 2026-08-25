// Announcer client — plays "Now batting, number <jersey>, <name>!"
// before a walk-up song.
//
// The audio is generated server-side (functions/api/announce.js) so the
// ElevenLabs API key never touches the browser. Each name+number combo is
// generated once and cached in KV, so replays are instant and free.
//
// playAnnouncement(name, number):
//   - fetches the announcement MP3 (cached client-side in memory)
//   - plays it on a shared hidden <audio> element
//   - resolves true if it played to completion, false if it was skipped
//     (no key configured, quota hit, network error, or playback blocked)
//   - always resolves — callers play the song regardless

import {
  getAnnouncement,
  saveAnnouncement
} from './offlineLibrary';

let audioEl = null;
const urlCache = new Map(); // normalized name -> object URL
const pending = new Map();  // normalized name -> in-flight fetch promise

function cacheKey(name, number) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const num = String(number || '').trim();
  // Include the jersey number so changing it generates a fresh clip.
  return num ? `${num}|${clean}` : clean;
}

// Get the announcement audio for a name, preferring (in order): the
// in-memory URL cache, the locally saved IndexedDB clip, then the server.
// When fetched from the server, the clip is saved locally so it never has
// to be regenerated or re-downloaded. Changing the pronounced name changes
// the key, which naturally produces (and saves) a fresh clip.
async function fetchAnnouncementUrl(name, number) {
  const key = cacheKey(name, number);
  if (!key) return null;
  if (urlCache.has(key)) return urlCache.get(key);
  if (pending.has(key)) return pending.get(key);

  const p = (async () => {
    // 1) Locally saved copy — the point of this feature: zero regeneration.
    try {
      const saved = await getAnnouncement(key);
      if (saved && saved.blob && saved.blob.size) {
        const url = URL.createObjectURL(saved.blob);
        urlCache.set(key, url);
        return url;
      }
    } catch { /* IndexedDB unavailable — fall through to server */ }

    // 2) Server (KV-cached server-side too). Save the result locally.
    const qs = new URLSearchParams({ name });
    if (number) qs.set('number', String(number).trim());
    const res = await fetch(`/api/announce?${qs.toString()}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || blob.size === 0) return null;
    try {
      await saveAnnouncement(key, blob);
    } catch { /* saving is best-effort */ }
    const url = URL.createObjectURL(blob);
    urlCache.set(key, url);
    return url;
  })().finally(() => pending.delete(key));

  pending.set(key, p);
  return p;
}

// Synchronous lookup of a cached announcement URL. Returns the object
// URL if this name was already fetched (or preloaded), else null. Used
// by the play flow so the audio element can start inside the user's tap
// gesture — required for reliable autoplay on iOS.
export function getAnnouncementUrl(name, number) {
  const key = cacheKey(name, number);
  return urlCache.has(key) ? urlCache.get(key) : null;
}

// Play the announcement. Resolves true when the clip has played through
// `overlap` of its tail (default 0 = full length), false on any skip.
// Passing overlap: 0.25 lets the walk-up song start while the last 25%
// of the announcement still plays. The announcement tail keeps playing
// in the background and ends naturally.
export function playAnnouncement(name, number, options = {}) {
  const overlap = Math.min(1, Math.max(0, Number(options.overlap) || 0));
  return new Promise((resolve) => {
    if (!name) return resolve(false);

    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    fetchAnnouncementUrl(name, number)
      .then((url) => {
        if (!url) return done(false);
        if (!audioEl) {
          audioEl = document.createElement('audio');
          audioEl.style.display = 'none';
          document.body.appendChild(audioEl);
        }
        const audio = audioEl;
        audio.src = url;
        audio.volume = 1;
        let finished = false;
        const finish = (ok) => {
          if (finished) return;
          finished = true;
          audio.ontimeupdate = null;
          done(ok);
        };
        audio.onended = () => finish(true);
        audio.onerror = () => finish(false);
        if (overlap > 0) {
          // Resolve once the clip is (1 - overlap) done so the song can
          // start while the announcement's tail still plays.
          audio.ontimeupdate = () => {
            const d = audio.duration;
            if (d && Number.isFinite(d) && d > 0 &&
                audio.currentTime >= d * (1 - overlap)) {
              finish(true);
            }
          };
        }
        const playPromise = audio.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(() => finish(false));
        }
        // Safety net: if the clip somehow never ends (or autoplay stalls),
        // don't hold up the song forever.
        setTimeout(() => finish(false), 8000);
      })
      .catch(() => done(false));
  });
}

// Stop any in-flight announcement playback (e.g. user hits stop/next).
export function stopAnnouncement() {
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute('src');
  }
}

// Preload the announcement for every player on the roster so the first
// tap in a game is instant. Accepts an array of player-like objects
// ({ name, number } — name should already be the pronounced name).
// Returns a promise that resolves when all queued fetches settle.
export function preloadAnnouncements(players) {
  const seen = new Set();
  const unique = [];
  for (const p of players || []) {
    const key = cacheKey(p.name, p.number);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push({ name: p.name, number: p.number });
  }
  return Promise.allSettled(
    unique.map((p) => fetchAnnouncementUrl(p.name, p.number))
  );
}
