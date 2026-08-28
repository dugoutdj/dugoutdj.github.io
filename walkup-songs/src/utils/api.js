// Client for the Cloudflare Pages Functions API that backs the
// "Share with Parents" feature. All calls are same-origin (/api/*).

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
    // Non-JSON response — leave body null.
  }
  if (!res.ok) {
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return body;
}

// Create (or refresh) a shared team roster. Returns { teamId }.
export async function createTeam(teamData) {
  return request('/team', {
    method: 'POST',
    body: JSON.stringify(teamData)
  });
}

// Fetch the current shared roster for a team id.
export async function fetchTeam(teamId) {
  return request(`/team/${encodeURIComponent(teamId)}`);
}

// Update one player's song in the shared roster.
export async function updatePlayerSong(teamId, playerId, songData) {
  return request(`/team/${encodeURIComponent(teamId)}/player/${encodeURIComponent(playerId)}`, {
    method: 'PUT',
    body: JSON.stringify(songData)
  });
}

export async function requestLoginLink(email) {
  return request('/auth/request-link', { method: 'POST', body: JSON.stringify({ email }) });
}

export async function verifyLoginToken(token) {
  return request('/auth/verify', { method: 'POST', body: JSON.stringify({ token }) });
}

export async function getCurrentCoach() {
  return request('/auth/me');
}

export async function logoutCoach() {
  return request('/auth/logout', { method: 'POST' });
}

export async function claimAccountTeam(teamData) {
  return request('/account/team', { method: 'POST', body: JSON.stringify(teamData) });
}

export async function fetchAccountTeams() {
  return request('/account/team');
}

export async function syncAccountTeam(teamData) {
  return request('/account/team', { method: 'PUT', body: JSON.stringify(teamData) });
}

// Remove a shared roster from KV.
export async function deleteTeam(teamId) {
  return request(`/team/${encodeURIComponent(teamId)}`, { method: 'DELETE' });
}

// Build the shareable link for a team id (uses the current origin so it
// works on the live site and in local previews alike).
export function shareUrlForTeam(teamId) {
  const base = window.location.origin;
  return `${base}/team/${teamId}`;
}

// Extract a team id from the current URL path (/team/<id>), or null.
export function teamIdFromLocation(pathname) {
  const m = String(pathname || window.location.pathname).match(/^\/team\/([a-z0-9]{8})\/?$/i);
  return m ? m[1] : null;
}
