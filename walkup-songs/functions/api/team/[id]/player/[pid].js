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

const SONG_FIELDS = ['songTitle', 'pronounced', 'previewUrl', 'artworkUrl', 'appleTrackId', 'songVideoId', 'songThumbnail', 'startTime', 'duration', 'songSource'];

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

    // Stamp the wall-clock time of this parent update so the coach can tell
    // a fresh parent submission from one they have already superseded.
    player.updatedAt = Date.now();

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
