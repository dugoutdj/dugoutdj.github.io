// GET /api/dj/me — is this browser currently a guest DJ?
//
// The guest console is reopened at /dj/<token> (the emailed link), so on a
// refresh the page can either re-verify that token or ask here. Both return
// the same shape so the client has one code path:
//   { active: true, teamId, email, expiresAt }  — a live DJ window
//   { active: false }                           — no session, or it expired
//
// The dj_invites table is created by POST /api/dj/invite, which always runs
// before any DJ link can exist; a missing table here just reads as inactive.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};

const encoder = new TextEncoder();

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cookie(request, name) {
  return request.headers.get('Cookie')?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1) || '';
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  try {
    const raw = cookie(request, 'ddj_dj');
    if (!raw || !env.DB) return json({ active: false });

    const hash = await sha256(raw);
    const row = await env.DB.prepare(
      'SELECT team_id,email,expires_at,revoked_at FROM dj_invites WHERE token_hash=?'
    ).bind(hash).first();

    if (!row || row.revoked_at || Number(row.expires_at) <= Date.now()) {
      return json({ active: false });
    }
    return json({
      active: true,
      teamId: row.team_id,
      email: row.email,
      expiresAt: Number(row.expires_at)
    });
  } catch (error) {
    console.error('GET /api/dj/me error:', error);
    return json({ active: false });
  }
}
