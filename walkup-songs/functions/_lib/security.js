const encoder = new TextEncoder();

export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function getCookie(request, name) {
  return request.headers.get('Cookie')?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1) || '';
}

export function getSessionToken(request) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return getCookie(request, 'ddj_session');
}

export async function getAuthenticatedCoach(request, env) {
  const raw = getSessionToken(request);
  if (!raw || !env?.DB) return null;
  try {
    const hash = await sha256(raw);
    const row = await env.DB.prepare(
      'SELECT c.id,c.email FROM sessions s JOIN coaches c ON c.id=s.coach_id WHERE s.token_hash=? AND s.expires_at>?'
    ).bind(hash, Date.now()).first();
    return row || null;
  } catch {
    return null;
  }
}

export async function hasActiveDjSession(request, env, teamId) {
  const raw = getCookie(request, 'ddj_dj');
  if (!raw || !teamId || !env?.DB) return false;
  try {
    const hash = await sha256(raw);
    const row = await env.DB.prepare(
      'SELECT id FROM dj_invites WHERE token_hash=? AND team_id=? AND revoked_at IS NULL AND expires_at>?'
    ).bind(hash, teamId, Date.now()).first();
    return Boolean(row);
  } catch {
    return false;
  }
}

export async function getTeamOwnerCoachId(env, sharedTeamId) {
  if (!sharedTeamId || !env?.DB) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT coach_id FROM teams WHERE shared_team_id=?'
    ).bind(sharedTeamId).first();
    return row?.coach_id || null;
  } catch {
    return null;
  }
}

export function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP')?.trim()
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

export async function checkRateLimit(env, bucket, identifier, maxRequests, windowSeconds) {
  if (!env?.TEAMS) return { allowed: true, retryAfter: 0 };
  const nowSec = Math.floor(Date.now() / 1000);
  const windowBucket = Math.floor(nowSec / windowSeconds);
  const idHash = (await sha256(identifier || 'unknown')).slice(0, 24);
  const key = `rl:${bucket}:${idHash}:${windowBucket}`;
  try {
    const current = Number(await env.TEAMS.get(key)) || 0;
    if (current >= maxRequests) {
      const retryAfter = Math.max(1, (windowBucket + 1) * windowSeconds - nowSec);
      return { allowed: false, retryAfter };
    }
    await env.TEAMS.put(key, String(current + 1), {
      expirationTtl: Math.max(60, windowSeconds + 10)
    });
    return { allowed: true, retryAfter: 0 };
  } catch {
    return { allowed: true, retryAfter: 0 };
  }
}
