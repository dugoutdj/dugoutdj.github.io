// GET /api/audio/<key> — stream a stored walk-up clip from R2.
// Keys are unguessable (16 random chars), matching the team-link access
// model: anyone with the link can play, nobody can enumerate the bucket.

// Parse a Range header into the R2 get() range option ({ offset, end } or
// { suffix }). Returns undefined when the header is absent or malformed.
function parseRange(header) {
  const m = String(header || '').trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return undefined;
  const start = m[1] === '' ? undefined : Number(m[1]);
  const end = m[2] === '' ? undefined : Number(m[2]);
  if (start === undefined && end === undefined) return undefined;
  if (start === undefined) return { suffix: end };       // bytes=-N
  return end === undefined ? { offset: start } : { offset: start, end };
}

const ALLOWED_ORIGIN = '*';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400'
    }
  });
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  try {
    if (!env.CLIPS) {
      return json({ error: 'Audio storage is not configured yet.' }, 503);
    }
    const key = String(params.key || '');
    if (!/^clip_[a-z0-9]+\.wav$/.test(key)) {
      return json({ error: 'Invalid clip key' }, 400);
    }
    const range = parseRange(request.headers.get('Range'));
    const object = await env.CLIPS.get(key, range ? { range } : undefined);
    if (!object) {
      return json({ error: 'Clip not found' }, 404);
    }
    const headers = {
      'Content-Type': object.httpMetadata?.contentType || 'audio/wav',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Accept-Ranges': 'bytes'
    };
    const status = object.range ? 206 : 200;
    if (object.range) {
      headers['Content-Range'] = `bytes ${object.range.offset}-${object.range.end}/${object.range.size}`;
    }
    return new Response(object.body, { status, headers });
  } catch (err) {
    console.error('GET /api/audio/<key> error:', err);
    return json({ error: 'Server error' }, 500);
  }
}
