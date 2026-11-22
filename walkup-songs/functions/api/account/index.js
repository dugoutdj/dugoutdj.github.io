const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'DELETE,OPTIONS'
};

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', ...CORS, ...headers }
});

const encoder = new TextEncoder();

async function sha256(value) {
  const d = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cookie(request, name) {
  return request.headers.get('Cookie')?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1) || '';
}

function sessionToken(request) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return cookie(request, 'ddj_session');
}

async function coach(request, env) {
  const raw = sessionToken(request);
  if (!raw || !env.DB) return null;
  const hash = await sha256(raw);
  const row = await env.DB.prepare(
    'SELECT c.id,c.email FROM sessions s JOIN coaches c ON c.id=s.coach_id WHERE s.token_hash=? AND s.expires_at>?'
  ).bind(hash, Date.now()).first();
  return row || null;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestDelete({ request, env }) {
  try {
    if (!env.DB) return json({ error: 'D1 database binding is not configured.' }, 503);
    const c = await coach(request, env);
    if (!c) return json({ error: 'Sign in required.' }, 401);

    let sharedIds = [];
    try {
      const rows = await env.DB.prepare('SELECT shared_team_id FROM teams WHERE coach_id=?').bind(c.id).all();
      sharedIds = (rows.results || []).map((r) => r.shared_team_id).filter(Boolean);
    } catch {
      // Teams table may not exist yet if no team was synced.
    }

    try {
      await env.DB.prepare(
        'DELETE FROM dj_invites WHERE created_by=? OR team_id IN (SELECT shared_team_id FROM teams WHERE coach_id=?) OR team_id IN (SELECT id FROM teams WHERE coach_id=?)'
      ).bind(c.email || '', c.id, c.id).run();
    } catch {
      // dj_invites table may not exist yet.
    }

    if (env.TEAMS && sharedIds.length) {
      await Promise.allSettled(sharedIds.map((id) => env.TEAMS.delete(`team:${id}`)));
    }

    try {
      await env.DB.prepare('DELETE FROM teams WHERE coach_id=?').bind(c.id).run();
    } catch {
      // Teams table may not exist yet.
    }

    await env.DB.prepare('DELETE FROM sessions WHERE coach_id=?').bind(c.id).run();

    try {
      if (c.email) {
        await env.DB.prepare('DELETE FROM login_tokens WHERE email=?').bind(c.email).run();
      }
    } catch {
      // login_tokens cleanup is best-effort.
    }

    await env.DB.prepare('DELETE FROM coaches WHERE id=?').bind(c.id).run();

    return json(
      { ok: true },
      200,
      { 'Set-Cookie': 'ddj_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' }
    );
  } catch (error) {
    console.error('DELETE /api/account error:', error);
    return json({ error: 'Unable to delete account.' }, 500);
  }
}
