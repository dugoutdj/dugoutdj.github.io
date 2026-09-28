// Shared batting order helpers.
//
// The order is stored on the shared team record as an array of player ids
// (`order`), stamped with the server clock (`orderUpdatedAt`). Both the coach's
// roster and every guest DJ console read the same value, so whoever changes it
// changes it for everyone.
//
// Two rules make that safe with players being added at any time:
//   - anyone missing from `order` (a player the coach just added, or an id a
//     stale client never saw) keeps roster position at the END of the order,
//     never dropped and never shuffled into the middle;
//   - an empty or absent order leaves the roster exactly as it is.

// Player ids in batting order, for publishing.
export function rosterOrderIds(players) {
  return (players || []).map((p) => String(p.id ?? '')).filter(Boolean);
}

// The roster re-sequenced to match `order`.
export function orderPlayers(players, order) {
  const list = players || [];
  if (!Array.isArray(order) || order.length === 0) return list;

  const placed = order
    .map((id) => list.find((p) => String(p.id) === String(id)))
    .filter(Boolean);
  const placedIds = new Set(placed.map((p) => String(p.id)));
  return [...placed, ...list.filter((p) => !placedIds.has(String(p.id)))];
}

// True when two rosters are already in the same order.
export function sameOrder(a, b) {
  const left = a || [];
  const right = b || [];
  if (left.length !== right.length) return false;
  return left.every((p, i) => String(p.id) === String(right[i]?.id));
}
