// PUT /api/team/:id/player/:pid — update one player's song in the shared
// roster. Body may contain any of: songTitle, previewUrl, artworkUrl,
// appleTrackId, startTime, duration, songSource. Player name/number are
// never changed by this endpoint (parents edit songs only).

const ALLOWED_ORIGIN = '*';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
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

const SONG_FIELDS = ['songTitle', 'previewUrl', 'artworkUrl', 'appleTrackId', 'startTime', 'duration', 'songSource'];

export async function onRequestPut(context) {
  const { request, env, params } = context;
  const teamId = String(params.id || '');
  const playerId = String(params.pid || '');
  if (!/^[a-z0-9]{8}$/.test(teamId)) return json({ error: 'Invalid team id' }, 400);
  if (!playerId) return json({ error: 'Invalid player id' }, 400);

  try {
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

    for (const field of SONG_FIELDS) {
      if (field in body) {
        if (field === 'startTime') player.startTime = Number(body[field]) || 0;
        else if (field === 'duration') player.duration = Number(body[field]) || 10;
        else player[field] = String(body[field] ?? '');
      }
    }

    // Clamp the window to the 30s Apple preview / 5-15s model.
    player.startTime = Math.max(0, Math.min(25, player.startTime));
    player.duration = Math.max(5, Math.min(15, player.duration));
    if (player.startTime + player.duration > 30) {
      player.duration = 30 - player.startTime;
    }

    team.updatedAt = Date.now();
    await env.TEAMS.put(`team:${teamId}`, JSON.stringify(team), { expirationTtl: 90 * 24 * 3600 });
    return json({ ok: true, player, updatedAt: team.updatedAt });
  } catch (err) {
    console.error('PUT /api/team/:id/player/:pid error:', err);
    return json({ error: 'Server error' }, 500);
  }
}
