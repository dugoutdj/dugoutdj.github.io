const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', ...CORS, ...headers }
});
const encoder = new TextEncoder();
async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS }); }
export async function onRequestPost({ request, env }) {
  try {
    const rawToken = String((await request.json())?.token || '');
    if (!rawToken || !env.DB) return json({ error: 'Invalid sign-in link.' }, 400);
    const now = Date.now();
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS coaches (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)').run();
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,coach_id TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL)').run();
    const tokenHash = await sha256(rawToken);
    const token = await env.DB.prepare('SELECT email, expires_at, used_at FROM login_tokens WHERE token_hash = ?').bind(tokenHash).first();
    if (!token || token.used_at || Number(token.expires_at) <= now) return json({ error: 'This sign-in link is expired or has already been used.' }, 400);
    await env.DB.prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ?').bind(now, tokenHash).run();
    const coachId = crypto.randomUUID();
    const existing = await env.DB.prepare('SELECT id FROM coaches WHERE email = ?').bind(token.email).first();
    const id = existing?.id || coachId;
    if (existing) await env.DB.prepare('UPDATE coaches SET updated_at = ? WHERE id = ?').bind(now, id).run();
    else await env.DB.prepare('INSERT INTO coaches (id,email,created_at,updated_at) VALUES (?,?,?,?)').bind(id, token.email, now, now).run();
    const sessionRaw = randomToken();
    const sessionHash = await sha256(sessionRaw);
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000;
    await env.DB.prepare('INSERT INTO sessions (token_hash,coach_id,expires_at,created_at) VALUES (?,?,?,?)').bind(sessionHash, id, expiresAt, now).run();
    return json({ ok: true, email: token.email }, 200, {
      'Set-Cookie': `ddj_session=${sessionRaw}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
    });
  } catch (error) {
    console.error('POST /api/auth/verify error:', error);
    return json({ error: 'Unable to complete sign-in.' }, 500);
  }
}
