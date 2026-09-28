// PUT /api/team/:id/order — set the batting order for a shared roster.
//
// The walk-up order is shared state: whoever is running the console (the coach
// or an invited guest DJ) can change it, and every other device picks the
// change up on its next refresh, so the coach's roster and the guest DJ's
// console always agree.
//
// Two rules keep two writers from clobbering each other:
//   - Writes are stamped with the SERVER clock (`orderUpdatedAt`), so clients
//     compare timestamps that were all minted by the same clock and never
//     argue about whose phone is right. Last write wins.
//   - An unchanged order is a no-op that echoes the stored timestamp, so a
//     client republishing its roster (every song edit does) can't restamp —
//     and therefore can't outrank — someone else's newer order.
//
// Body: { order: ["<playerId>", ...] }  → { ok, order, orderUpdatedAt }

const ALLOWED_ORIGIN = '*';
const TEAM_TTL_SECONDS = 90 * 24 * 3600;
// A roster is never this big; the cap just bounds what a client can write.
const MAX_ORDER_ENTRIES = 200;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  }});
}

function sanitizeOrder(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_ORDER_ENTRIES)
    .map((id) => String(id ?? '').trim().slice(0, 64))
    .filter(Boolean);
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  const teamId = String(params.id || '');
  if (!/^[a-z0-9]{8}$/.test(teamId)) return json({ error: 'Invalid team id' }, 400);

  try {
    const raw = await env.TEAMS.get(`team:${teamId}`);
    if (!raw) return json({ error: 'Team not found' }, 404);
    const team = JSON.parse(raw);

    let body = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const incoming = sanitizeOrder(body?.order);
    if (!incoming.length) return json({ error: 'An order array is required.' }, 400);

    const current = Array.isArray(team.order) ? team.order.map(String) : [];
    const storedAt = Number(team.orderUpdatedAt) || 0;

    // Only ids that exist on the shared roster count, so a client that is a
    // step behind can't inject players the roster doesn't have.
    const knownIds = new Set((team.players || []).map((p) => String(p.id)));
    const next = incoming.filter((id) => knownIds.has(id));
    if (!next.length) {
      return json({ ok: true, order: current, orderUpdatedAt: storedAt, unchanged: true });
    }

    if (next.join('|') === current.join('|')) {
      // No change: echo the stored stamp so the caller records the same
      // "as of" value instead of thinking it just wrote something newer.
      return json({ ok: true, order: current, orderUpdatedAt: storedAt, unchanged: true });
    }

    team.order = next;
    team.orderUpdatedAt = Date.now();
    await env.TEAMS.put(`team:${teamId}`, JSON.stringify(team), { expirationTtl: TEAM_TTL_SECONDS });
    return json({ ok: true, order: team.order, orderUpdatedAt: team.orderUpdatedAt });
  } catch (err) {
    console.error('PUT /api/team/:id/order error:', err);
    return json({ error: 'Server error' }, 500);
  }
}
