// POST /api/team — create or refresh a team's shared roster in KV.
// Body: { name, players: [{ id, name, number, songTitle, previewUrl,
//         artworkUrl, appleTrackId, startTime, duration, songSource, history }] }
// Returns: { teamId }
//
// The batting order (team.order / team.orderUpdatedAt) is NOT touched here.
// It is seeded from this publish the first time a roster is shared, and from
// then on it only changes through PUT /api/team/:id/order — otherwise every
// song edit a coach published would overwrite an order a guest DJ just set.

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

function sanitizePlayer(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    id: String(p.id ?? ''),
    name: String(p.name ?? ''),
    pronounced: String(p.pronounced ?? p.name ?? ''),
    number: String(p.number ?? ''),
    songTitle: String(p.songTitle ?? ''),
    previewUrl: String(p.previewUrl ?? ''),
    artworkUrl: String(p.artworkUrl ?? ''),
    appleTrackId: String(p.appleTrackId ?? ''),
    songVideoId: String(p.songVideoId ?? ''),
    songThumbnail: String(p.songThumbnail ?? ''),
    mp3Key: String(p.mp3Key ?? ''),
    startTime: Number(p.startTime) || 0,
    duration: Number(p.duration) || 10,
    songSource: p.songSource === 'apple' ? 'apple' : (p.songSource === 'youtube' ? 'youtube' : (p.songSource === 'mp3' ? 'mp3' : '')),
    updatedAt: Number(p.updatedAt) || Date.now(),
    lastChangedBy: p.lastChangedBy === 'coach' ? 'coach' : 'parent',
    // Per-player song+window history (with coach play counts) rides along so
    // parents can re-pick a past selection and counts survive round trips.
    history: Array.isArray(p.history) ? p.history : []
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
    if (!body || typeof body !== 'object' || !body.name || !Array.isArray(body.players)) {
      return json({ error: 'Invalid team data: expected { name, players[] }' }, 400);
    }

    const players = body.players.map(sanitizePlayer).filter(Boolean);
    const team = {
      name: String(body.name),
      players,
      updatedAt: Date.now()
    };

    // Support updating an existing team by passing teamId.
    const teamId = /^[a-z0-9]{8}$/.test(String(body.teamId || ''))
      ? String(body.teamId)
      : generateTeamId();

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
