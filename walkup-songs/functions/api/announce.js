// Announcer — "Now batting, <name>!" via the ElevenLabs TTS API.
//
// Why a server function: the ElevenLabs API key must never ship to the
// browser. This endpoint is the only thing that talks to ElevenLabs; the
// client just fetches /api/announce?name=... and plays the returned MP3.
//
// Free-plan economics: the free tier is 10,000 credits/month, and each
// character costs ~0.5-1 credit. "Now batting, Xavier Reyes!" is ~25
// characters, so a fresh name costs ~12-25 credits. To make that cheap:
//   - eleven_flash_v2_5 model (0.5 credits/char, fast, low latency)
//   - mp3_22050_32 output (small, ~32kbps — plenty for a voice line)
//   - Result cached in KV keyed by the normalized name, so each name is
//     generated ONCE and every replay for the rest of the season is free.
//   - Cloudflare edge caching (s-maxage) on top of KV.
//
// Free-plan failure modes handled: 401 (bad/expired key), 422 (voice id
// not usable on this plan), 429 (quota or rate limit), and a missing
// key. In every case we return a non-200 so the client skips the
// announcement and plays the song directly — the walk-up never breaks.

const VOICE_ID = 'mYTliPiFsycwxhxWzfA0';
const MODEL_ID = 'eleven_flash_v2_5';
const OUTPUT_FORMAT = 'mp3_22050_32';
const CACHE_TTL = 90 * 24 * 3600; // 90 days, same as teams

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

// Normalize a player name into a safe, stable cache key and the spoken
// line. Keeps the name short so it costs few credits.
function makeLine(name) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return {
    line: `Now batting, ${clean}!`,
    key: clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown'
  };
}

function audioResponse(buffer, extraHeaders = {}) {
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Cache-Control': `public, max-age=86400, s-maxage=604800`,
      ...extraHeaders
    }
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const name = (url.searchParams.get('name') || '').trim();

  if (!name) {
    return json({ error: 'Missing name parameter' }, 400);
  }
  const { line, key } = makeLine(name);
  const cacheKey = `announce:${key}`;

  // 1) KV cache — the big free-plan saver. Generated once per name.
  if (env.TEAMS) {
    try {
      const cached = await env.TEAMS.get(cacheKey, 'arrayBuffer');
      if (cached) {
        return audioResponse(cached);
      }
    } catch (err) {
      console.error('KV get error:', err);
    }
  }

  // 2) No API key configured — tell the client to skip quietly.
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return json({ error: 'Announcer not configured' }, 503);
  }

  // 3) Generate with ElevenLabs.
  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg'
        },
        body: JSON.stringify({
          text: line,
          model_id: MODEL_ID,
          output_format: OUTPUT_FORMAT,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0
          }
        })
      }
    );

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('ElevenLabs error', upstream.status, detail.slice(0, 300));
      // 401 bad key, 422 voice unusable, 429 quota/rate — all mean
      // "skip the announcement, play the song".
      return json({ error: 'TTS failed', status: upstream.status }, 502);
    }

    const buffer = await upstream.arrayBuffer();

    // 4) Cache for the season, then return. Even if the KV write fails,
    //    the edge cache (s-maxage) still helps.
    if (env.TEAMS) {
      try {
        await env.TEAMS.put(cacheKey, buffer, { expirationTtl: CACHE_TTL });
      } catch (err) {
        console.error('KV put error:', err);
      }
    }

    return audioResponse(buffer);
  } catch (err) {
    console.error('Announcer fetch error:', err);
    return json({ error: 'TTS request failed' }, 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400'
    }
  });
}
