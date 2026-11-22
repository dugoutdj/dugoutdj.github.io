// PUT /api/team/:id/player/:pid — update one player's song in the shared
// roster. Body may contain any of: songTitle, previewUrl, artworkUrl,
// appleTrackId, startTime, duration, songSource. Player name/number are
// never changed by this endpoint (parents edit songs only).

import { getClientIP, checkRateLimit } from '../../../../_lib/security.js';

const ALLOWED_ORIGIN = '*';

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...extraHeaders
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  }});
}

const SONG_FIELD_LIMITS = {
  songTitle: 160,
  pronounced: 80,
  previewUrl: 500,
  artworkUrl: 500,
  appleTrackId: 64,
  songVideoId: 32,
  songThumbnail: 500,
  mp3Key: 64,
  songSource: 32
};

export async function onRequestPut(context) {
  const { request, env, params } = context;
  const teamId = String(params.id || '');
  const playerId = String(params.pid || '');
  if (!/^[a-z0-9]{8}$/.test(teamId)) return json({ error: 'Invalid team id' }, 400);
  if (!playerId) return json({ error: 'Invalid player id' }, 400);

  try {
    const editLimit = await checkRateLimit(env, 'player-edit', getClientIP(request), 60, 3600);
    if (!editLimit.allowed) {
      return json(
        { error: 'Too many song updates. Please try again later.' },
        429,
        { 'Retry-After': String(editLimit.retryAfter) }
      );
    }

    const raw = await env.TEAMS.get(`team:${teamId}`);
    if (!raw) return json({ error: 'Team not found' }, 404);

    const team = JSON.parse(raw);
    const player = team.players.find((p) => String(p.id) === playerId);
    if (!player) return json({ error: 'Player not found' }, 404);

    let body = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    for (const [field, limit] of Object.entries(SONG_FIELD_LIMITS)) {
      if (field in body) {
        player[field] = String(body[field] ?? '').slice(0, limit);
      }
    }
    if ('startTime' in body) player.startTime = Number(body.startTime) || 0;
    if ('duration' in body) player.duration = Number(body.duration) || 10;

    // Stamp the wall-clock time of this parent update so the coach can tell
    // a fresh parent submission from one they have already superseded.
    player.updatedAt = Date.now();
    player.lastChangedBy = 'parent';

    // Clamp the window only for Apple songs (30s preview / 5-15s model).
    // YouTube songs keep their chosen start/length over the full video.
    if (player.songSource === 'apple') {
      player.startTime = Math.max(0, Math.min(25, player.startTime));
      player.duration = Math.max(5, Math.min(15, player.duration));
      if (player.startTime + player.duration > 30) {
        player.duration = 30 - player.startTime;
      }
    } else {
      player.startTime = Math.max(0, player.startTime);
      player.duration = Math.max(1, player.duration);
    }

    team.updatedAt = Date.now();
    await env.TEAMS.put(`team:${teamId}`, JSON.stringify(team), { expirationTtl: 90 * 24 * 3600 });
    return json({ ok: true, player, updatedAt: team.updatedAt });
  } catch (err) {
    console.error('PUT /api/team/:id/player/:pid error:', err);
    return json({ error: 'Server error' }, 500);
  }
}
