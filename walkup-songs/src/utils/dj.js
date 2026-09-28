// Client for the guest-DJ feature.
//
// A coach invites a parent by email; the parent opens /dj/<token> and gets a
// play-only game-day console for three days. Tokens are opaque and stored
// server-side as hashes, so this module only ever handles the link itself.

const API_BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response (e.g. a Function that never deployed) — leave null.
  }
  if (!res.ok) {
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return body;
}

// Invite (or re-invite) a parent as guest DJ. Returns
// { invite: { id, email, expiresAt, url } } — the link is returned only on
// creation, because the server keeps just its hash.
export async function inviteGuestDj(teamId, email) {
  return request('/dj/invite', {
    method: 'POST',
    body: JSON.stringify({ teamId, email })
  });
}

// Active (unrevoked, unexpired) invites for a team, newest first.
export async function listGuestDjInvites(teamId) {
  return request(`/dj/invite?teamId=${encodeURIComponent(teamId)}`);
}

// End a guest DJ's access immediately.
export async function revokeGuestDjInvite(teamId, id) {
  return request(
    `/dj/invite?teamId=${encodeURIComponent(teamId)}&id=${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  );
}

// Redeem the token from a /dj/<token> link; sets the session cookie.
export async function verifyDjToken(token) {
  return request('/dj/verify', { method: 'POST', body: JSON.stringify({ token }) });
}

// Check whether this browser already holds a live DJ session.
export async function getDjSession() {
  try {
    return await request('/dj/me');
  } catch {
    return { active: false };
  }
}

// Extract the guest-DJ token from a /dj/<token> path, or null.
export function djTokenFromLocation(pathname) {
  const m = String(pathname || window.location.pathname).match(/^\/dj\/([A-Za-z0-9_-]{16,})\/?$/);
  return m ? m[1] : null;
}
