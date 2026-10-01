// Saved-layout geometry shared by creation, Library Apply, and dashboard editing.

function overlaps(a, b) {
  return a.y === b.y && a.x < b.x + b.w && b.x < a.x + a.w;
}

/**
 * Normalize an arbitrary tile map into a conflict-free one: settle tiles in (y, x)
 * order; any tile overlapping an already-settled one (incl. full-row claims) shifts
 * down until free. Deterministic — used defensively on SAVED layouts (a stored layout
 * should already be conflict-free, but corrupted/hand-edited data must never render
 * overlapped).
 *
 * `isOff` (optional, the dashboard's switched-off predicate): visible tiles settle
 * first and ties break by id, so a switched-off tile never pushes a visible one and
 * the stored key order decides nothing. Without it the order is (y, x) exactly as
 * before — creation-time Layout copies and Library Apply call it that way.
 */
export function normalizeTiles(tiles, { isOff } = {}) {
  const out = {};
  const offRank = (id) => (isOff(id) ? 1 : 0);
  const ids = Object.keys(tiles).sort(isOff
    ? (a, b) => offRank(a) - offRank(b) || tiles[a].y - tiles[b].y || tiles[a].x - tiles[b].x
      || (a < b ? -1 : a > b ? 1 : 0)
    : (a, b) => tiles[a].y - tiles[b].y || tiles[a].x - tiles[b].x);
  const settled = [];
  for (const id of ids) {
    const t = { ...tiles[id] };
    let guardCount = 0;
    let collided = true;
    while (collided && guardCount++ < 1000) {
      collided = false;
      for (const sid of settled) {
        const s = out[sid];
        const fullRowClash = (s.w === 12 || t.w === 12) && s.y === t.y;
        if (fullRowClash || overlaps(t, s)) {
          t.y = s.y + 1;
          collided = true;
        }
      }
    }
    out[id] = t;
    settled.push(id);
  }
  return out;
}

/** Remove empty rows; stable (y, x) order preserved. */
export function compactVertical(tiles) {
  const list = Object.entries(tiles).map(([id, t]) => ({ id, t: { ...t } }));
  const usedRows = [...new Set(list.map((e) => e.t.y))].sort((a, b) => a - b);
  const remap = new Map(usedRows.map((y, i) => [y, i]));
  const out = {};
  for (const e of list) {
    out[e.id] = { ...e.t, y: remap.get(e.t.y) };
  }
  return out;
}
