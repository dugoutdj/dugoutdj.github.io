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

// Deezer's search ranks by GLOBAL popularity, which skews toward its
// European user base (club remixes, European covers and edits often outrank
// the mainstream US recording of the same song). To make fallback results
// feel like a US music-store search, we re-rank Deezer hits server-side:
// exact-title matches win, remix/cover/live/version spam is penalized hard,
// non-Latin titles are demoted, and well-known mainstream artists get a
// boost so the canonical recording surfaces (e.g. Imagine Dragons'
// "Thunder" over Gabry Ponte's club mix).
const MAINSTREAM_ARTIST_NAMES = [
  // Rock / classic rock
  'ac/dc', 'aerosmith', 'bon jovi', 'guns n roses', 'metallica', 'nirvana',
  'pearl jam', 'red hot chili peppers', 'foo fighters', 'green day',
  'linkin park', 'queen', 'journey', 'survivor', 'whitesnake', 'def leppard',
  'van halen', 'kiss', 'led zeppelin', 'the rolling stones', 'the white stripes',
  'the killers', 'u2', 'coldplay', 'imagine dragons', 'muse', 'radiohead',
  'system of a down', 'rage against the machine', 'blink-182', 'blink 182',
  'fall out boy', 'my chemical romance', 'disturbed', 'godsmack', 'shinedown',
  'breaking benjamin', 'three days grace', 'skillet', 'the offspring', 'weezer',
  'pantera', 'slipknot', 'europe', 'boston', 'foreigner', 'billy joel',
  'bruce springsteen', 'tom petty', 'the eagles', 'eagles', 'fleetwood mac',
  'a-ha', 'the killers', 'sweet', 'the animals', 'the doors', 'creedence clearwater revival',
  // Pop / pop rock
  'taylor swift', 'katy perry', 'justin timberlake', 'bruno mars', 'maroon 5',
  'lady gaga', 'beyonce', 'beyonc\u00e9', 'rihanna', 'ed sheeran', 'adele',
  'shawn mendes', 'justin bieber', 'ariana grande', 'the weeknd', 'post malone',
  'olivia rodrigo', 'billie eilish', 'harry styles', 'dua lipa', 'doja cat',
  'nicki minaj', 'cardi b', 'megan thee stallion', 'lizzo', 'halsey',
  'demi lovato', 'selena gomez', 'miley cyrus', 'pitbull', 'flo rida', 'kesha',
  'onerepublic', 'the black eyed peas', 'owl city', 'walk the moon',
  'fitz and the tantrums', 'lana del rey', 'twenty one pilots', 'bastille',
  'sia', 'kelly clarkson', 'pink', 'christina aguilera', 'gwen stefani',
  'micheal jackson', 'michael jackson', 'prince', 'stevie wonder', 'aretha franklin',
  'james brown', 'earth wind & fire', 'kc and the sunshine band', 'village people',
  // Hip-hop / rap
  '50 cent', 'eminem', 'kanye west', 'jay-z', 'jay z', 'kendrick lamar', 'drake',
  'lil wayne', 'future', 'travis scott', 'snoop dogg', 'dr. dre', 'dr dre',
  'ice cube', 'outkast', 'wiz khalifa', 'mac miller', 'the notorious b.i.g.',
  'tupac', '2pac', 'kid cudi', 'tyler, the creator', 'j. cole', 'chance the rapper',
  'lil nas x', 'juice wrld', 'polo g', 'rod wave', 'lil baby', 'dababy',
  'megan thee stallion', 'jack harlow', 'lil uzi vert', 'playboi carti',
  // Country
  'luke bryan', 'florida georgia line', 'zac brown band', 'kenny chesney',
  'jason aldean', 'blake shelton', 'thomas rhett', 'dierks bentley', 'eric church',
  'luke combs', 'chris stapleton', 'carrie underwood', 'morgan wallen',
  'kane brown', 'sam hunt', 'old dominion', 'dan + shay', 'brothers osborne',
  'tim mcgraw', 'keith urban', 'toby keith', 'alan jackson', 'garth brooks',
  'shania twain', 'the chicks', 'darius rucker', 'lady antebellum', 'rascal flatts',
  // EDM / dance
  'the chainsmokers', 'marshmello', 'calvin harris', 'david guetta', 'avicii',
  'tie sto', 'tiesto', 'zedd', 'kygo', 'skrillex', 'diplo', 'major lazer',
  'galantis', 'alan walker', 'martin garrix', 'the fat rat', 'dj khaled',
  'swedish house mafia', 'darude', 'la bouche', 'snap!', '2 unlimited', 'cascada',
  // Walk-up staples
  'vanilla ice', 'mc hammer', 'tone loc', 'house of pain', 'sir mix-a-lot',
  'survivor', 'santana', 'gonna make you sweat', 'rage against the machine',
  'rick astley', 'spice girls', 'backstreet boys', 'nsync', 'britney spears',
  'usher', 'ciara', 'missy elliott', 'ludacris', 'nelly', 'ja rule', 'fugees',
  'coolio', 'warren g', 'nate dogg', 'eminem', 'will smith', 'run-dmc', 'beastie boys'
];

// Normalize the list the same way artist names are normalized (lowercase,
// punctuation -> space), so "AC/DC", "J. Cole" and "Dan + Shay" all match.
const MAINSTREAM_ARTISTS = new Set(MAINSTREAM_ARTIST_NAMES.map(normalize));

// Substrings that mark a non-canonical version (remix, live, cover, edit,
// workout, slowed, etc.). Penalized hard so the original recording wins.
const REMIX_MARKERS =
  /(remix|festival mix|radio mix|extended mix|club mix|dance mix|instrumental|karaoke|cover|tribute|tabata|workout|slowed|sped\s?up|reimagined|orchestral|piano|lo-fi|lofi|acoustic|live|edit|version|feat\.?|ft\.?|vs\.?|sped-up)/i;

// Characters that suggest a non-English (non-Latin) title: Cyrillic, Greek,
// Arabic, Hebrew, CJK, Hangul, Thai, Devanagari, etc.
const NON_LATIN = /[\u0400-\u04FF\u0370-\u03FF\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\u0E00-\u0E7F\u10A0-\u10FF]/;

// Deezer returns a lot of remix/cover spam in its global ranking, so fetch
// extra results and re-rank locally, returning only the best few.
const DEEZER_FETCH_LIMIT = 25;
const RESULT_LIMIT = 8;

// Normalize a string for loose title matching.
function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Score a Deezer result for how likely it is the "canonical" recording of
// the user's query. Higher = better.
export function deezerScore(query, d) {
  const title = String(d.title || '');
  const artist = (d.artist && d.artist.name) || '';
  const album = (d.album && d.album.title) || '';
  const nq = normalize(query);
  const nt = normalize(title);
  const tokens = nq.split(' ').filter(Boolean);

  let score = 0;

  // Title match quality dominates.
  if (nt === nq) score += 100;
  else if (nt.startsWith(nq)) score += 85;
  else if (tokens.length && tokens.every((t) => nt.includes(t))) score += 70;
  else if (tokens.some((t) => nt.includes(t))) score += 40;
  else score += 10;

  const na = normalize(artist);
  // Copycat artists that mirror the song title (e.g. artist "Seven Nation
  // Army." or "The Eye of the Tiger") are derivative — demote them.
  if (na && nt && (na === nt || na.includes(nt) || nt.includes(na))) score -= 25;
  // Artist mentioned in the query (e.g. "imagine dragons thunder") — strong
  // signal. Requires the FULL artist name (every significant word) to appear
  // in the query: substring checks wrongly matched "in" inside "Apollinare"
  // and "of" inside "Profitt", boosting cover artists.
  const artistWords = na.split(' ').filter((w) => w.length >= 2);
  if (artistWords.length && artistWords.every((w) => nq.includes(w))) score += 30;

  // Penalize non-canonical versions. Parentheses only cost points when they
  // hold a remix-style qualifier — "(Remastered)" is the canonical version.
  if (REMIX_MARKERS.test(title)) score -= 45;
  if (/\([^)]*(live|remix|acoustic|instrumental|edit|version|karaoke|cover|tabata|workout|slowed|extended|radio|club|piano|lo-?fi)[^)]*\)/i.test(title)) {
    score -= 12;
  }
  if (/various|compilation|best of|hits/i.test(album)) score -= 10;
  if (NON_LATIN.test(title)) score -= 60;

  // Boost well-known mainstream artists so the US hit surfaces.
  if (MAINSTREAM_ARTISTS.has(na)) score += 15;

  // Deezer global rank breaks near-ties (max ~7 points).
  score += Math.min(7, (Number(d.rank) || 0) / 100000);

  return score;
}

// Re-rank Deezer results so the canonical US/mainstream recording is first
// and remix/cover spam is pushed down or out. Duplicate recordings (same
// title + artist) are collapsed to the highest-scoring version.
export function rankDeezerResults(query, tracks) {
  const seen = new Set();
  const deduped = [];
  for (const d of tracks) {
    const key = `${normalize(d.title)}|${normalize((d.artist && d.artist.name) || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(d);
  }
  return deduped
    .map((d) => ({ d, score: deezerScore(query, d) }))
    .sort((a, b) => b.score - a.score || (Number(b.d.rank) || 0) - (Number(a.d.rank) || 0))
    .map((x) => x.d)
    .slice(0, RESULT_LIMIT);
}

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
  target.searchParams.set('limit', String(Math.max(limit, DEEZER_FETCH_LIMIT)));
  const upstream = await fetch(target.toString(), {
    headers: { 'User-Agent': BROWSER_UA }
  });
  if (!upstream.ok) {
    let detail = '';
    try { detail = (await upstream.text()).slice(0, 200); } catch { /* non-text */ }
    throw new Error(`Deezer API ${upstream.status}: ${detail}`.trim());
  }
  const data = await upstream.json();
  const ranked = rankDeezerResults(term, (data.data || []).filter((d) => d && d.preview));
  const results = ranked.map((d) => ({
    trackId: `dz${d.id}`,
    trackName: d.title,
    artistName: (d.artist && d.artist.name) || '',
    collectionName: (d.album && d.album.title) || '',
    // Provide BOTH field names: the client reads artworkUrl100 (Apple's
    // name) — without it, Deezer-sourced results rendered with no art.
    artworkUrl: (d.album && d.album.cover_medium) || null,
    artworkUrl100: (d.album && d.album.cover_medium) || null,
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

  // v3 key: bumps the cache namespace so entries cached before the Deezer
  // re-ranking (and artworkUrl100) fixes don't keep serving stale results.
  const cacheKey = `search:v3:${term.toLowerCase().replace(/\s+/g, ' ')}`;

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
