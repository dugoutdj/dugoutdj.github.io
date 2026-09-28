// Temporary guest-DJ invites.
//
// The coach can hand a parent the job of running walk-up songs for a game
// without giving up the roster: an invite emails a /dj/<token> link that opens
// a play-only console and stops working after three days.
//
//   GET    /api/dj/invite?teamId=<id>          → list the team's active invites
//   POST   /api/dj/invite  { teamId, email }   → create (or refresh) an invite
//   DELETE /api/dj/invite?teamId=<id>&id=<id>  → revoke an invite immediately
//
// All three require a signed-in coach — only the emailed verification link
// (see ./verify.js) is unauthenticated. Invites are stored in D1 as a hash of
// the token, so the raw link exists only in the email and in the click.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
};

// How long a guest DJ keeps the console. Three days covers a weekend series
// and then expires on its own without the coach doing anything.
const INVITE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
// Cap invited hands: a team never needs more than a few DJs at once.
const MAX_ACTIVE_INVITES = 8;
// Abuse guard — the invite endpoint sends email, so throttle per team.
const MAX_INVITES_PER_HOUR = 10;

const encoder = new TextEncoder();

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
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

async function ensure(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS dj_invites ('
    + 'id TEXT PRIMARY KEY,'
    + 'team_id TEXT NOT NULL,'
    + 'email TEXT NOT NULL,'
    + 'token_hash TEXT NOT NULL UNIQUE,'
    + 'created_by TEXT,'
    + 'created_at INTEGER NOT NULL,'
    + 'expires_at INTEGER NOT NULL,'
    + 'revoked_at INTEGER,'
    + 'last_used_at INTEGER)'
  ).run();
}

async function coach(request, env) {
  const raw = cookie(request, 'ddj_session');
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

// List the invites that are still usable (not revoked, not expired).
export async function onRequestGet({ request, env }) {
  try {
    const c = await coach(request, env);
    if (!c) return json({ error: 'Sign in as coach to manage guest DJs.' }, 401);
    const teamId = String(new URL(request.url).searchParams.get('teamId') || '');
    if (!/^[a-z0-9]{8}$/i.test(teamId)) return json({ error: 'Invalid team id' }, 400);
    await ensure(env);

    const now = Date.now();
    const rows = await env.DB.prepare(
      'SELECT id,email,created_at,expires_at,last_used_at FROM dj_invites '
      + 'WHERE team_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC'
    ).bind(teamId, now).all();

    return json({
      invites: (rows.results || []).map((r) => ({
        id: r.id,
        email: r.email,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        lastUsedAt: r.last_used_at || null
      }))
    });
  } catch (error) {
    console.error('GET /api/dj/invite error:', error);
    return json({ error: 'Unable to load guest DJ invites.' }, 500);
  }
}

// Create (or refresh) an invite for one email and mail the DJ link.
export async function onRequestPost({ request, env }) {
  try {
    const c = await coach(request, env);
    if (!c) return json({ error: 'Sign in as coach to invite a guest DJ.' }, 401);
    if (!env.DB) return json({ error: 'D1 database binding is not configured.' }, 503);
    if (!env.RESEND_API_KEY) return json({ error: 'RESEND_API_KEY secret is not configured for this deployment.' }, 503);

    const body = await request.json().catch(() => ({}));
    const teamId = String(body?.teamId || '');
    const email = String(body?.email || '').trim().toLowerCase();
    if (!/^[a-z0-9]{8}$/i.test(teamId)) return json({ error: 'Invalid team id' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Enter a valid email address.' }, 400);
    }

    // The parent link has to exist before someone can DJ for it.
    const rawTeam = await env.TEAMS?.get(`team:${teamId}`);
    if (!rawTeam) return json({ error: 'Create the parent link before inviting a guest DJ.' }, 404);
    const teamName = (() => {
      try { return String(JSON.parse(rawTeam).name || 'the team'); } catch { return 'the team'; }
    })();

    await ensure(env);
    const now = Date.now();

    // Throttle: the endpoint sends mail, so cap how often one team can use it.
    const recent = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM dj_invites WHERE team_id=? AND created_at>?'
    ).bind(teamId, now - 60 * 60 * 1000).first();
    if ((recent?.n || 0) >= MAX_INVITES_PER_HOUR) {
      return json({ error: 'Too many invites for this team in the last hour. Try again later.' }, 429);
    }

    const active = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM dj_invites WHERE team_id=? AND revoked_at IS NULL AND expires_at>?'
    ).bind(teamId, now).first();
    // Refreshing an existing invite is always allowed; only a brand-new slot
    // has to respect the cap.
    const existing = await env.DB.prepare(
      'SELECT id FROM dj_invites WHERE team_id=? AND email=? AND revoked_at IS NULL AND expires_at>?'
    ).bind(teamId, email, now).first();
    if (!existing && (active?.n || 0) >= MAX_ACTIVE_INVITES) {
      return json({ error: `This team already has ${MAX_ACTIVE_INVITES} guest DJs invited. Revoke one first.` }, 409);
    }

    const rawToken = randomToken();
    const tokenHash = await sha256(rawToken);
    const expiresAt = now + INVITE_TTL_MS;
    const id = existing?.id || crypto.randomUUID();

    if (existing) {
      // Re-inviting the same parent refreshes the window and rotates the link,
      // so a stale forwarded email stops working.
      await env.DB.prepare(
        'UPDATE dj_invites SET token_hash=?,created_at=?,expires_at=?,revoked_at=NULL,last_used_at=NULL WHERE id=?'
      ).bind(tokenHash, now, expiresAt, id).run();
    } else {
      await env.DB.prepare(
        'INSERT INTO dj_invites (id,team_id,email,token_hash,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?)'
      ).bind(id, teamId, email, tokenHash, c.email || '', now, expiresAt).run();
    }

    const djUrl = `${new URL(request.url).origin}/dj/${rawToken}`;
    const expiresLabel = new Date(expiresAt).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: 'America/New_York'
    });

    const resend = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Dugout DJ <coach@dugoutdj.com>',
        to: [email],
        subject: `You're running the walk-up songs for ${teamName}`,
        html: `<p>You've been invited to run the walk-up songs for <strong>${teamName}</strong>.</p>
<p>Open this link on the phone you'll use at the game — it's a play-only console, so nothing in the roster can be changed:</p>
<p><a href="${djUrl}">Open the Dugout DJ game-day console</a></p>
<p>It works until <strong>${expiresLabel}</strong>, then it expires on its own.</p>
<p>Tip: open it before the game so the songs can save to your phone. It keeps playing even if the signal drops.</p>`
      })
    });
    if (!resend.ok) {
      console.error('Resend error:', await resend.text());
      return json({ error: 'Resend rejected the message. Check the verified sender and API key.' }, 502);
    }

    return json({
      ok: true,
      invite: { id, email, expiresAt, url: djUrl }
    });
  } catch (error) {
    console.error('POST /api/dj/invite error:', error);
    return json({ error: 'Unable to invite that guest DJ.' }, 500);
  }
}

// Revoke an invite — the link stops working on the next check.
export async function onRequestDelete({ request, env }) {
  try {
    const c = await coach(request, env);
    if (!c) return json({ error: 'Sign in as coach to manage guest DJs.' }, 401);
    const params = new URL(request.url).searchParams;
    const teamId = String(params.get('teamId') || '');
    const id = String(params.get('id') || '');
    if (!/^[a-z0-9]{8}$/i.test(teamId) || !id) return json({ error: 'Invalid invite' }, 400);
    await ensure(env);

    const result = await env.DB.prepare(
      'UPDATE dj_invites SET revoked_at=? WHERE id=? AND team_id=? AND revoked_at IS NULL'
    ).bind(Date.now(), id, teamId).run();
    if (!result.meta?.changes) return json({ error: 'Invite not found.' }, 404);
    return json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/dj/invite error:', error);
    return json({ error: 'Unable to revoke that invite.' }, 500);
  }
}
