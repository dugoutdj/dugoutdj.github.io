// MP3 upload clips — Cloudflare R2-backed storage for the 5-15 second
// walk-up snippets parents/coaches upload from their own audio files.
//
//   POST   /api/audio            multipart/form-data { file } -> { key }
//   DELETE /api/audio?key=<key>  remove a stored clip
//
// The clip is already trimmed client-side before upload, so only the tiny
// walk-up window ever leaves the device. Requires an R2 bucket bound as
// `CLIPS` in the Pages project (Workers & Bindings -> R2 -> CLIPS).

const ALLOWED_ORIGIN = '*';
const MAX_CLIP_BYTES = 6 * 1024 * 1024; // generous: a 15s stereo WAV is ~2.6MB

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      ...extraHeaders
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}

function newKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let k = '';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  for (const b of bytes) k += chars[b % chars.length];
  return `clip_${k}.wav`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.CLIPS) {
      return json({ error: 'Audio storage is not configured yet (R2 bucket "CLIPS").' }, 503);
    }
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string' || !file.size) {
      return json({ error: 'Missing file' }, 400);
    }
    if (file.size > MAX_CLIP_BYTES) {
      return json({ error: 'Clip is too large (max 6 MB).' }, 413);
    }
    const type = String(file.type || '');
    if (type && !/^audio\//.test(type)) {
      return json({ error: 'Only audio clips can be uploaded.' }, 400);
    }
    const key = newKey();
    await env.CLIPS.put(key, file.stream(), {
      httpMetadata: { contentType: type || 'audio/wav' }
    });
    return json({ key });
  } catch (err) {
    console.error('POST /api/audio error:', err);
    return json({ error: 'Upload failed' }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    if (!env.CLIPS) return json({ error: 'Audio storage is not configured yet.' }, 503);
    const url = new URL(request.url);
    const key = String(url.searchParams.get('key') || '');
    if (!/^clip_[a-z0-9]+\.wav$/.test(key)) {
      return json({ error: 'Invalid clip key' }, 400);
    }
    await env.CLIPS.delete(key);
    return json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/audio error:', err);
    return json({ error: 'Delete failed' }, 500);
  }
}
