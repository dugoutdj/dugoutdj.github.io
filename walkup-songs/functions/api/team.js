// POST /api/team — create or refresh a team's shared roster in KV.
// Body: { name, players: [{ id, name, number, songTitle, previewUrl,
//         artworkUrl, appleTrackId, startTime, duration, songSource, history }] }
// Returns: { teamId }
//
// The batting order (team.order / team.orderUpdatedAt) is NOT touched here.
// It is seeded from this publish the first time a roster is shared, and from
// then on it only changes through PUT /api/team/:id/order — otherwise every
// song edit a coach published would overwrite an order a guest DJ just set.

import { getAuthenticatedCoach, getTeamOwnerCoachId, getClientIP, checkRateLimit } from '../_lib/security.js';

const ALLOWED_ORIGIN = '*';
const MAX_PLAYERS = 100;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...extraHeaders
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

function sanitizePlayer(p) {
  if (!p || typeof p !== 'object') return null;
  const name = String(p.name ?? '').slice(0, 80);
  return {
    id: String(p.id ?? '').slice(0, 64),
    name,
    pronounced: String(p.pronounced ?? name).slice(0, 80),
    number: String(p.number ?? '').slice(0, 12),
    songTitle: String(p.songTitle ?? '').slice(0, 160),
    previewUrl: String(p.previewUrl ?? '').slice(0, 500),
    artworkUrl: String(p.artworkUrl ?? '').slice(0, 500),
    appleTrackId: String(p.appleTrackId ?? '').slice(0, 64),
    songVideoId: String(p.songVideoId ?? '').slice(0, 32),
    songThumbnail: String(p.songThumbnail ?? '').slice(0, 500),
    mp3Key: String(p.mp3Key ?? '').slice(0, 64),
    startTime: Number(p.startTime) || 0,
    duration: Number(p.duration) || 10,
    songSource: p.songSource === 'apple' ? 'apple' : (p.songSource === 'youtube' ? 'youtube' : (p.songSource === 'mp3' ? 'mp3' : '')),
    updatedAt: Number(p.updatedAt) || Date.now(),
    lastChangedBy: p.lastChangedBy === 'coach' ? 'coach' : 'parent',
    // Per-player song+window history (with coach play counts) rides along so
    // parents can re-pick a past selection and counts survive round trips.
    history: Array.isArray(p.history) ? p.history.slice(0, 20) : []
  };
}

function generateTeamId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const b of bytes) id += chars[b % chars.length];
  return id;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const teamName = String(body?.name || '').trim().slice(0, 80);
    if (!body || typeof body !== 'object' || !teamName || !Array.isArray(body.players)) {
      return json({ error: 'Invalid team data: expected { name, players[] }' }, 400);
    }

    const requestedId = String(body.teamId || '');
    const isExistingId = /^[a-z0-9]{8}$/.test(requestedId);

    if (isExistingId) {
      const ownerCoachId = await getTeamOwnerCoachId(env, requestedId);
      if (ownerCoachId) {
        const coach = await getAuthenticatedCoach(request, env);
        if (!coach || coach.id !== ownerCoachId) {
          return json({ error: 'Only the team coach can update this shared roster.' }, 403);
        }
      }
    } else {
      const createLimit = await checkRateLimit(env, 'team-create', getClientIP(request), 20, 3600);
      if (!createLimit.allowed) {
        return json(
          { error: 'Too many teams created. Please try again later.' },
          429,
          { 'Retry-After': String(createLimit.retryAfter) }
        );
      }
    }

    const players = body.players.slice(0, MAX_PLAYERS).map(sanitizePlayer).filter(Boolean);
    const team = {
      name: teamName,
      players,
      updatedAt: Date.now()
    };

    // Support updating an existing team by passing teamId.
    const teamId = isExistingId ? requestedId : generateTeamId();

    // Preserve the shared batting order across publishes; seed it from this
    // roster's order when the team has never had one.
    try {
      const existing = await env.TEAMS.get(`team:${teamId}`);
      const stored = existing ? JSON.parse(existing) : null;
      if (Array.isArray(stored?.order) && stored.order.length) {
        team.order = stored.order.map(String);
        team.orderUpdatedAt = Number(stored.orderUpdatedAt) || 0;
      }
    } catch (err) {
      console.error('POST /api/team order carry-over error:', err);
    }
    if (!team.order?.length) {
      team.order = players.map((p) => String(p.id));
      team.orderUpdatedAt = Date.now();
    }

    await env.TEAMS.put(`team:${teamId}`, JSON.stringify(team), { expirationTtl: 90 * 24 * 3600 });
    return json({ teamId });
  } catch (err) {
    console.error('POST /api/team error:', err);
    return json({ error: 'Server error' }, 500);
  }
}
