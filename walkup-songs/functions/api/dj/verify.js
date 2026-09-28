// POST /api/dj/verify — trade an emailed guest-DJ link for a 3-day session.
//
// Body: { token }  (the random part of /dj/<token>)
// Sets an HttpOnly `ddj_dj` cookie so the console survives refreshes, and
// returns { active: true, teamId, email, expiresAt }.
//
// This is the only guest-DJ endpoint that is not coach-authenticated — the
// unguessable token IS the credential, exactly like the parent link. Revoking
// the invite (or letting it expire) kills the cookie on the next check.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

const encoder = new TextEncoder();

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...headers }
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  try {
    const token = String((await request.json().catch(() => ({})))?.token || '');
    if (!token || !env.DB) return json({ error: 'That guest DJ link is not valid.' }, 400);

    const hash = await sha256(token);
    const row = await env.DB.prepare(
      'SELECT id,team_id,email,expires_at,revoked_at FROM dj_invites WHERE token_hash=?'
    ).bind(hash).first();

    const now = Date.now();
    if (!row) return json({ error: 'That guest DJ link is not valid.' }, 404);
    if (row.revoked_at) {
      return json({ error: 'The coach ended this guest DJ session. Ask them to invite you again.' }, 403);
    }
    if (Number(row.expires_at) <= now) {
      return json({ error: 'This guest DJ link has expired. Ask the coach to invite you again.' }, 410);
    }

    await env.DB.prepare('UPDATE dj_invites SET last_used_at=? WHERE id=?').bind(now, row.id).run();

    const maxAge = Math.max(60, Math.floor((Number(row.expires_at) - now) / 1000));
    return json(
      { active: true, teamId: row.team_id, email: row.email, expiresAt: Number(row.expires_at) },
      200,
      { 'Set-Cookie': `ddj_dj=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}` }
    );
  } catch (error) {
    console.error('POST /api/dj/verify error:', error);
    return json({ error: 'Unable to open that guest DJ link.' }, 500);
  }
}
