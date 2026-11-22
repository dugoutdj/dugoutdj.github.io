// GET /api/team/:id — fetch a shared team roster.
// DELETE /api/team/:id — remove the shared roster from KV.

import { getAuthenticatedCoach, getTeamOwnerCoachId } from '../../_lib/security.js';

const ALLOWED_ORIGIN = '*';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  }});
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const teamId = String(params.id || '');
  if (!/^[a-z0-9]{8}$/.test(teamId)) {
    return json({ error: 'Invalid team id' }, 400);
  }
  try {
    const raw = await env.TEAMS.get(`team:${teamId}`);
    if (!raw) return json({ error: 'Team not found' }, 404);
    return json(JSON.parse(raw));
  } catch (err) {
    console.error('GET /api/team/:id error:', err);
    return json({ error: 'Server error' }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const teamId = String(params.id || '');
  if (!/^[a-z0-9]{8}$/.test(teamId)) {
    return json({ error: 'Invalid team id' }, 400);
  }
  try {
    const ownerCoachId = await getTeamOwnerCoachId(env, teamId);
    if (ownerCoachId) {
      const coach = await getAuthenticatedCoach(request, env);
      if (!coach || coach.id !== ownerCoachId) {
        return json({ error: 'Only the team coach can delete this shared roster.' }, 403);
      }
    }
    await env.TEAMS.delete(`team:${teamId}`);
    return json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/team/:id error:', err);
    return json({ error: 'Server error' }, 500);
  }
}
