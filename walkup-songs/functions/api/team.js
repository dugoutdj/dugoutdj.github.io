// POST /api/team — create or refresh a team's shared roster in KV.
// Body: { name, players: [{ id, name, number, songTitle, previewUrl,
//         artworkUrl, appleTrackId, startTime, duration, songSource }] }
// Returns: { teamId }

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
    startTime: Number(p.startTime) || 0,
    duration: Number(p.duration) || 10,
    songSource: p.songSource === 'apple' ? 'apple' : (p.songSource === 'youtube' ? 'youtube' : ''),
    updatedAt: Number(p.updatedAt) || Date.now(),
    lastChangedBy: p.lastChangedBy === 'coach' ? 'coach' : 'parent'
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

    await env.TEAMS.put(`team:${teamId}`, JSON.stringify(team), { expirationTtl: 90 * 24 * 3600 });
    return json({ teamId });
  } catch (err) {
    console.error('POST /api/team error:', err);
    return json({ error: 'Server error' }, 500);
  }
}
