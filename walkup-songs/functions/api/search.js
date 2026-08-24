// Server-side proxy for song search.
//
// Why: iOS Safari/Chrome fail direct browser fetches to itunes.apple.com
// (Apple bot-checks mobile IPs + iOS WebKit quirks), so we proxy through
// Cloudflare Pages Functions instead. Apple also rate-limits the Cloudflare
// egress IPs aggressively (403 bot checks / 429 "rate limit exceeded"), so
// this function:
//
//   1. Serves cached results from KV when available (no Apple call at all).
//   2. Gates Apple calls to at most one per APPLE_GATE_MS so the shared
//      egress IP never gets throttled by search bursts.
//   3. Falls back to the Deezer public API when Apple is unavailable —
//      Deezer also exposes 30-second previews (MP3) with CORS `*`, so the
//      app keeps working even while Apple blocks the datacenter IP.
//
// Both sources return the same shape: { results: [...] } with
// trackId/trackName/artistName/collectionName/artworkUrl/previewUrl/
// trackViewUrl. Deezer track ids are prefixed with "dz" so they can never
// collide with real Apple track ids (used in songKey as `apple:<id>`).

const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const DEEZER_SEARCH = 'https://api.deezer.com/search';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const APPLE_GATE_MS = 6000; // min gap between Apple upstream calls
const CACHE_TTL = 24 * 3600; // seconds to keep results in KV
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=3600' };

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders
    }
  });
}

// Minimal KV wrapper so local dev (no bindings) still works.
function kv(env) {
  return {
    async get(key) {
      try { return await env.TEAMS.get(key); } catch { return null; }
    },
    async put(key, value, opts) {
      try { await env.TEAMS.put(key, value, opts); } catch { /* best effort */ }
    }
  };
}

// Cooldown gate: allow at most one Apple upstream call per window, shared
// across all users. Returns true when this request may call Apple.
async function appleGateOpen(store) {
  const now = Date.now();
  const last = Number(await store.get('search:applegate')) || 0;
  if (now - last < APPLE_GATE_MS) return false;
  await store.put('search:applegate', String(now), { expirationTtl: 300 });
  return true;
}

async function searchApple(term, limit) {
  const target = new URL(ITUNES_SEARCH);
  target.searchParams.set('term', term);
  target.searchParams.set('country', 'US');
  target.searchParams.set('media', 'music');
  target.searchParams.set('entity', 'song');
  target.searchParams.set('limit', limit);
  const upstream = await fetch(target.toString(), {
    headers: { 'User-Agent': BROWSER_UA }
  });
  if (!upstream.ok) {
    let detail = '';
    try { detail = (await upstream.text()).slice(0, 200); } catch { /* non-text */ }
    throw new Error(`Apple API ${upstream.status}: ${detail}`.trim());
  }
  return { body: await upstream.json(), source: 'apple' };
}

async function searchDeezer(term, limit) {
  const target = new URL(DEEZER_SEARCH);
  target.searchParams.set('q', term);
  target.searchParams.set('limit', limit);
  const upstream = await fetch(target.toString(), {
    headers: { 'User-Agent': BROWSER_UA }
  });
  if (!upstream.ok) {
    let detail = '';
    try { detail = (await upstream.text()).slice(0, 200); } catch { /* non-text */ }
    throw new Error(`Deezer API ${upstream.status}: ${detail}`.trim());
  }
  const data = await upstream.json();
  const results = (data.data || [])
    .filter((d) => d && d.preview)
    .map((d) => ({
      trackId: `dz${d.id}`,
      trackName: d.title,
      artistName: (d.artist && d.artist.name) || '',
      collectionName: (d.album && d.album.title) || '',
      artworkUrl: (d.album && d.album.cover_medium) || null,
      previewUrl: d.preview,
      trackViewUrl: d.link || null
    }));
  return { body: { resultCount: results.length, results }, source: 'deezer' };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const store = kv(env);
  const url = new URL(request.url);
  const term = (url.searchParams.get('term') || '').trim();
  const limit = url.searchParams.get('limit') || '8';

  if (!term) {
    return json({ error: 'Missing search term' }, 400);
  }

  const cacheKey = `search:${term.toLowerCase().replace(/\s+/g, ' ')}`;

  // 1. Serve from cache when possible — zero upstream calls.
  const cached = await store.get(cacheKey);
  if (cached) {
    try {
      const data = JSON.parse(cached);
      return json(data.body, 200, CACHE_HEADERS);
    } catch { /* corrupt entry — fall through and refetch */ }
  }

  // 2. Try Apple (gated so bursts can't throttle the shared IP).
  if (await appleGateOpen(store)) {
    try {
      const result = await searchApple(term, limit);
      await store.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL });
      return json(result.body, 200, CACHE_HEADERS);
    } catch (err) {
      console.warn(`[search] Apple unavailable for "${term}":`, err.message);
    }
  }

  // 3. Fall back to Deezer — always returns playable previews.
  try {
    const result = await searchDeezer(term, limit);
    if (result.body.results && result.body.results.length) {
      await store.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL });
      return json(result.body, 200, CACHE_HEADERS);
    }
    return json({ error: 'No results found', results: [] }, 200);
  } catch (err) {
    console.error(`[search] Deezer unavailable for "${term}":`, err.message);
    return json(
      { error: 'Search unavailable', detail: String(err?.message || err) },
      502
    );
  }
}
