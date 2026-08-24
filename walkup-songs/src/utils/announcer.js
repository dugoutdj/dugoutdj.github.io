// Announcer client — plays "Now batting, <name>!" before a walk-up song.
//
// The audio is generated server-side (functions/api/announce.js) so the
// ElevenLabs API key never touches the browser. Each player name is
// generated once and cached in KV, so replays are instant and free.
//
// playAnnouncement(name):
//   - fetches the announcement MP3 (cached client-side in memory)
//   - plays it on a shared hidden <audio> element
//   - resolves true if it played to completion, false if it was skipped
//     (no key configured, quota hit, network error, or playback blocked)
//   - always resolves — callers play the song regardless

let audioEl = null;
const urlCache = new Map(); // normalized name -> object URL
const pending = new Map();  // normalized name -> in-flight fetch promise

function cacheKey(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function fetchAnnouncementUrl(name) {
  const key = cacheKey(name);
  if (urlCache.has(key)) return urlCache.get(key);
  if (pending.has(key)) return pending.get(key);

  const p = (async () => {
    const res = await fetch(`/api/announce?name=${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || blob.size === 0) return null;
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
export function getAnnouncementUrl(name) {
  const key = cacheKey(name);
  return urlCache.has(key) ? urlCache.get(key) : null;
}

// Play the announcement. Resolves true on completion, false on any skip.
export function playAnnouncement(name) {
  return new Promise((resolve) => {
    if (!name) return resolve(false);

    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    fetchAnnouncementUrl(name)
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
        audio.onended = () => done(true);
        audio.onerror = () => done(false);
        const playPromise = audio.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(() => done(false));
        }
        // Safety net: if the clip somehow never ends (or autoplay stalls),
        // don't hold up the song forever.
        setTimeout(() => done(false), 8000);
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
// tap in a game is instant. Returns a promise that resolves when all
// queued fetches settle (never rejects).
export function preloadAnnouncements(names) {
  const unique = [...new Set((names || []).filter(Boolean).map(cacheKey))];
  return Promise.allSettled(
    unique.map((n) => fetchAnnouncementUrl(n))
  );
}
