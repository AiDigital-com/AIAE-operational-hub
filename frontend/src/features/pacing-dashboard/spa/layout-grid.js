// workspace/src/lib/dashboard/layout-grid.js
//
// Pure math for the unified dashboard grid (spec 2026-07-12 §2). Plain ESM, no React,
// no DOM — host-tested by tests/layout-grid-test.mjs.
//
// Model: 12 columns; `y` is a LOGICAL ROW INDEX (not pixels). Every tile occupies
// exactly one logical row; a row's rendered height is its tallest tile (flow tiles =
// content height). Sized tiles carry a height STEP name (H_PX); flow tiles are
// normalized to {x:0, w:12, h:'auto'} and always own a full row — the degenerate case
// of the same math, NOT a parallel "section" engine.
//
// Invariants (asserted by the randomized suite): x>=0, x+w<=12, no cell overlaps,
// vertical compaction (no empty rows), flow always full-row, every live id placed by
// resolveLayout.
//
// Layout mode's move engine (owner decisions 2026-09-23) lives in the middle of this file,
// under "the Layout-mode engine". It replaced push-down physics: a drop is home, place, swap
// or insert, nothing is pushed, and only the mover and its one swap partner ever move.

import { normalizeTiles, compactVertical } from '../vendor/layout-geometry.mjs';
export { normalizeTiles, compactVertical };

export const KIND_CONSTRAINTS = {
  chart: { minW: 3, maxW: 12, defW: 6, hSteps: ['S', 'M', 'L', 'XL'], defH: 'M' },
  table: { minW: 4, maxW: 12, defW: 12, hSteps: ['L', 'XL', 'XXL'], defH: 'XL' },
  flow: { minW: 12, maxW: 12, defW: 12, hSteps: null, defH: 'auto' },
  // Composites (widget-library spec §7). ONE widget kind, TWO sizings, so two entries
  // here: this map is keyed by GRID kind and every reader looks a tile's kind up in it.
  // `composite` IS profile 'card' — a sized tile, exactly a KPI's box. `section` is
  // profile 'section' — full-row, height from content. compositeKind() below is the
  // only place a profile becomes a key.
  composite: { minW: 2, maxW: 4, defW: 3, hSteps: null, defH: null },
  section: { minW: 12, maxW: 12, defW: 12, hSteps: null, defH: 'auto' },
  // Forward-only placeholder: an older bundle cannot know the geometry of a profile
  // introduced by a newer schema, but it must still draw WidgetNeedsNewerApp instead
  // of crashing the whole grid. Callers may request this row only after isFutureWidget.
  unsupported: { minW: 2, maxW: 4, defW: 3, hSteps: null, defH: null },
};

const PROFILE_GRID_KIND = {
  card: 'composite',
  chart: 'chart',
  table: 'table',
  section: 'section',
};
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function constraintFor(kind) {
  if (!hasOwn(KIND_CONSTRAINTS, kind)) {
    throw new TypeError(`Unknown dashboard grid kind "${String(kind)}"`);
  }
  return KIND_CONSTRAINTS[kind];
}

/**
 * profile → grid kind. Canonical storage states the profile explicitly.
 * The server refuses an absent or unknown profile; the renderer makes the same
 * refusal instead of inventing card geometry for data outside the canonical grammar.
 */
export const compositeKind = (profile) => {
  if (!hasOwn(PROFILE_GRID_KIND, profile)) {
    throw new TypeError(`Unknown canonical widget profile "${String(profile)}"`);
  }
  return PROFILE_GRID_KIND[profile];
};

/**
 * The ONE mapping from a display.widgets[] entry to a grid kind. Three hand-written
 * copies of this ternary existed (DashGrid, LayoutMode, seedLayout's bare `wdef.kind`)
 * and composites would have made it four. Reads the INSTANCE only — never a resolved
 * library definition — because the grid sizes every tile before anything is resolved
 * (§3.3 denormalizes `kind`, and for composites `profile`, onto the ref for this).
 */
export function widgetGridKind(w, { futurePlaceholder = false } = {}) {
  if (!w || w.kind !== 'composite') {
    throw new TypeError(`Unknown canonical widget kind "${String(w?.kind)}"`);
  }
  try {
    return compositeKind(w.profile);
  } catch (err) {
    if (futurePlaceholder) return 'unsupported';
    throw err;
  }
}

export const H_PX = { S: 200, M: 220, L: 320, XL: 440, XXL: 560 };

// ── clamp ─────────────────────────────────────────────────────────────────────

export function clampTile(tile, kind) {
  const c = constraintFor(kind);
  // 'section' is a composite that owns its row — same geometry contract as a flow block.
  if (kind === 'flow' || kind === 'section') {
    return { x: 0, y: Math.max(0, Math.round(tile.y ?? 0)), w: 12, h: 'auto' };
  }
  const w = Math.min(c.maxW, Math.max(c.minW, Math.round(tile.w ?? c.defW)));
  const x = Math.min(12 - w, Math.max(0, Math.round(tile.x ?? 0)));
  const y = Math.max(0, Math.round(tile.y ?? 0));
  let h = tile.h;
  if (c.hSteps) {
    if (!c.hSteps.includes(h)) h = c.defH;
  } else {
    h = c.defH; // card → null (content height), full-row kinds handled above
  }
  return { x, y, w, h };
}

// ── row occupancy helpers ─────────────────────────────────────────────────────

function overlaps(a, b) {
  return a.y === b.y && a.x < b.x + b.w && b.x < a.x + a.w;
}

// ── the Layout-mode engine (owner decisions 2026-09-23) ───────────────────────
//
// Every gesture resolves to a TARGET, and one pure function turns a target into the new
// arrangement, so what the preview draws and what the drop writes cannot differ:
//
//   home                        nothing changes
//   place  {y, x}               the mover takes free columns of an existing row
//   swap   {partner, m, p}      the mover takes the partner's cell and the partner takes the
//                               mover's: m = {x, y, w} for the mover, p = {x, y, w} for it
//   insert {before, x}          the mover alone in a fresh row at boundary `before`
//
// Rows and boundaries are named in the row space of the map the gesture STARTED from (its
// y values, boundary index 0..n), never in a map with the mover taken out: that re-count
// is what made a tile alone on its row jump on pickup.
//
// Owner rules (2026-09-23):
//  - A drop onto another tile SWAPS CELLS: each takes the other's x and width (clamped to
//    its own min/max) and keeps its own height step. When the literal positions collide,
//    the nearest positions that still cover the other's cell are used. When no pair fits
//    without covering a third tile, the drop places or inserts instead. Nothing is pushed.
//  - A tile that leaves a shared row leaves its row-mates exactly where they were.
//  - Only the mover and its one swap partner change column, width or row. A move may open
//    ONE fresh row and closes the mover's old row only if it is left empty.

export const GRID_GAP = 14;       // the grid's column gutter in px (index.css .dash-grid)
export const HOME = Object.freeze({ type: 'home' });
export const HYST_PX = 12;        // the dead zone: a new interval must be entered this deep
export const SNAP_COLS = 1;       // a placed / inserted tile snaps to an edge this close
export const NEAR_PLACE_COLS = 2; // a refused swap still takes free columns this close

const overl = (ax, aw, bx, bw) => ax < bx + bw && bx < ax + aw;
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lexLess = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

/** Fixed full-row kinds: always x0 / w12, never share a row, never change width. */
export const isBandKind = (kind) => kind === 'flow' || kind === 'section';

function kindLimits(kind) {
  const c = constraintFor(kind);
  return { minW: c.minW, maxW: c.maxW, band: isBandKind(kind) };
}
/**
 * The width limits a BARE tile can be trusted with when the caller named no kinds: the
 * intersection over every kind its height step allows ('L' is a chart's or a table's, so
 * 4..12). Only the pre-rewrite call sites (moveTile / moveTiles without kindOf) reach it,
 * and they must never hand a tile a width one of its possible kinds refuses.
 */
function guessLimits(t) {
  if (t && t.h === 'auto') return { minW: 12, maxW: 12, band: true };
  const kinds = !t ? [] : t.h == null
    ? ['composite', 'unsupported']
    : Object.keys(KIND_CONSTRAINTS).filter((k) => (KIND_CONSTRAINTS[k].hSteps || []).includes(t.h));
  if (!kinds.length) return { minW: t ? t.w : 12, maxW: t ? t.w : 12, band: false };
  return {
    minW: Math.max(...kinds.map((k) => KIND_CONSTRAINTS[k].minW)),
    maxW: Math.min(...kinds.map((k) => KIND_CONSTRAINTS[k].maxW)),
    band: false,
  };
}
/** (id) → {minW, maxW, band}: the mover by its own kind, everyone else through kindOf. */
function limitsFor(kindOf, tiles, moverId, moverKind) {
  return (id) => {
    if (id === moverId && moverKind) return kindLimits(moverKind);
    if (kindOf) return kindLimits(kindOf(id));
    return guessLimits(tiles[id]);
  };
}
export const clampW = (w, kind) => {
  const l = kindLimits(kind);
  return clampN(w, l.minW, l.maxW);
};

/** The row values of a map, ascending: index i is "row i" in that map's row space. */
export function rowYs(tiles) {
  return [...new Set(Object.values(tiles).map((t) => t.y))].sort((a, b) => a - b);
}
function rowOf(tiles, y, except = []) {
  return Object.entries(tiles).filter(([k, t]) => t.y === y && !except.includes(k));
}
function fitsRow(row, x, w) {
  if (x < 0 || x + w > 12) return false;
  if (row.some(([, t]) => t.w === 12)) return false;
  return row.every(([, t]) => !overl(x, w, t.x, t.w));
}
/** The free x nearest x0 (x0 itself first, then x0-1, x0+1, …) within maxD, or null. */
export function nearestFit(row, w, x0, maxD = 12) {
  for (let d = 0; d <= maxD; d++) {
    for (const x of d ? [x0 - d, x0 + d] : [x0]) if (fitsRow(row, x, w)) return x;
  }
  return null;
}
export function tilesEqual(a, b) {
  const ka = Object.keys(a || {});
  const kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const x = a[k];
    const y = b[k];
    if (!y || x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h) return false;
  }
  return true;
}
/** A stable string for a target: the UI re-renders the overlay only when this changes. */
export const targetKey = (t) => (t ? JSON.stringify(t) : 'null');

// ── snapping: no tile lands a column off by accident ─────────────────────────
/**
 * The x a placed or inserted tile lands on. Candidates: the grid edges, the edges of the
 * free run it lands in (flush against a row-mate), and the left / right edges of the tiles
 * directly above and below (so it lines up with them). The nearest candidate within
 * SNAP_COLS wins; a tie prefers flush-in-row, then grid edge, then above/below, then the
 * left one. Two or more columns away counts as deliberate and is kept.
 * `row` = the tiles already in the landing row (never the mover); for a fresh row it is [].
 */
export function snapX(row, w, x, neighbours) {
  const cands = [];
  const s0 = Math.max(0, ...row.filter(([, t]) => t.x + t.w <= x).map(([, t]) => t.x + t.w));
  const s1 = Math.min(12, ...row.filter(([, t]) => t.x >= x + w).map(([, t]) => t.x));
  if (row.length) { cands.push([s0, 0]); cands.push([s1 - w, 0]); }
  cands.push([0, 1]); cands.push([12 - w, 1]);
  for (const [, t] of neighbours) { cands.push([t.x, 2]); cands.push([t.x + t.w - w, 2]); }
  let best = null;
  for (const [c, pri] of cands) {
    if (c < 0 || c + w > 12 || Math.abs(c - x) > SNAP_COLS) continue;
    if (!fitsRow(row, c, w)) continue;
    const key = [Math.abs(c - x), pri, c];
    if (!best || lexLess(key, best)) best = key;
  }
  return best ? best[2] : x;
}

// ── groups: frames must stay honest ──────────────────────────────────────────
const liveMembers = (tiles, g) => ((g && g.tileIds) || []).filter((i) => tiles[i]);
/** A frame is valid while its box holds members only (§6.4); an empty group is vacuous. */
function frameValid(tiles, g) {
  const live = liveMembers(tiles, g);
  return live.length < 1 || selectionGroupable(tiles, live).ok;
}
export const groupOf = (groups, id) => (groups || []).find((g) => (g.tileIds || []).includes(id)) || null;
/** Member rows of a group, as indexes into the map's row order. */
function memberRowIdx(tiles, g) {
  const ys = rowYs(tiles);
  return [...new Set(liveMembers(tiles, g).map((i) => ys.indexOf(tiles[i].y)))].sort((a, b) => a - b);
}
/** Solid = the member rows are next to each other (no stranger's row between them). */
export const isSolidGroup = (tiles, g) => {
  const r = memberRowIdx(tiles, g);
  return r.length > 0 && r[r.length - 1] - r[0] === r.length - 1;
};
/** Where the mover lands, as a row index of the START map: a fresh row sits half-way
 *  between the two rows around it. */
function landingIdx(start, id, tg) {
  const ys = rowYs(start);
  if (tg.type === 'place') return ys.indexOf(tg.y);
  if (tg.type === 'swap') return ys.indexOf(tg.m.y);
  if (tg.type === 'insert') return tg.before - 0.5;
  return ys.indexOf(start[id].y);
}
/**
 * The frame guard → the group whose frame a result breaks, or null. Every frame valid in
 * `start` must still be valid in `out`, with ONE exception: the mover's own group, when the
 * mover lands outside that group's box (judged in START rows, before anything renumbers)
 * and the rest of the group is still clean without it. A member can be arranged on its
 * own; its frame hides until it is clean again. A partner is never exempt.
 */
function breaksFrame(start, out, moverId, groups, idx) {
  const own = groupOf(groups, moverId);
  for (const g of groups || []) {
    if (!frameValid(start, g) || frameValid(out, g)) continue;
    if (g === own && idx != null) {
      const b = groupBounds(start, g.tileIds);
      const ys = rowYs(start);
      const a = ys.indexOf(b.y);
      const z = ys.indexOf(b.y + b.rows - 1);
      const m = out[moverId];
      const inside = !!m && overl(m.x, m.w, b.x, b.w) && idx >= a && idx <= z;
      const rest = { tileIds: g.tileIds.filter((i) => i !== moverId) };
      if (!inside && frameValid(out, rest)) continue;
    }
    return g;
  }
  return null;
}

// ── applyTarget: (start, target) → the arrangement ───────────────────────────
/**
 * The one function every preview and every drop goes through. A home target, or one that
 * changes nothing, returns `start` itself, so a caller can compare by identity.
 */
export function applyTarget(start, id, kind, tg) {
  const M = start[id];
  if (!M || !tg || tg.type === 'home') return start;
  const out = {};
  for (const [k, t] of Object.entries(start)) out[k] = { ...t };
  const ys = rowYs(start);
  switch (tg.type) {
    case 'place':
      out[id] = { ...M, x: tg.x, y: tg.y };
      break;
    case 'insert': {
      const y = tg.before < ys.length ? ys[tg.before] - 0.5 : ys[ys.length - 1] + 0.5;
      out[id] = isBandKind(kind) ? { ...M, x: 0, y } : { ...M, x: tg.x, y };
      break;
    }
    case 'swap':
      out[id] = { ...M, x: tg.m.x, y: tg.m.y, w: tg.m.w };
      out[tg.partner] = { ...start[tg.partner], x: tg.p.x, y: tg.p.y, w: tg.p.w };
      break;
    default:
      throw new TypeError(`Unknown layout target "${String(tg.type)}"`);
  }
  const res = compactVertical(out);
  return tilesEqual(res, start) ? start : res;
}

/** The ids a target moves besides the mover: the swap partner, or nobody. */
export function displacedBy(start, id, tg) {
  return tg && tg.type === 'swap' ? [tg.partner] : [];
}

// ── the cell swap ─────────────────────────────────────────────────────────────
/** The x values at which a tile of width w still takes the cell [cx, cx+cw): inside it
 *  when narrower, covering it when wider. Ordered from the cell's own x outwards, so the
 *  literal position ("takes its position") is always tried first. */
function cellXs(cx, cw, w) {
  const xs = [];
  if (w <= cw) for (let x = cx; x <= cx + cw - w; x++) xs.push(x);
  else for (let x = cx; x >= cx + cw - w; x--) xs.push(x);
  return xs.filter((x) => x >= 0 && x + w <= 12);
}
/**
 * The two positions of a swap, searched TOGETHER: the mover (width mw) inside/over the
 * partner's cell, the partner (width tw) inside/over the mover's, neither covering a third
 * tile nor each other. EVERY pair that fits, nearest the literal positions first (total
 * distance, then the mover's, then search order), so a caller that must refuse the nearest
 * pair (it would break a group's frame) can take the next one instead of giving the swap up.
 */
function jointCells(start, id, tk, mw, tw) {
  const M = start[id];
  const T = start[tk];
  const same = M.y === T.y;
  if (same && (mw === 12 || tw === 12)) return [];
  const rowT = rowOf(start, T.y, [id, tk]);
  const rowM = rowOf(start, M.y, [id, tk]);
  const out = [];
  for (const mx of cellXs(T.x, T.w, mw)) {
    if (!fitsRow(rowT, mx, mw)) continue;
    for (const px of cellXs(M.x, M.w, tw)) {
      if (!fitsRow(rowM, px, tw)) continue;
      if (same && overl(mx, mw, px, tw)) continue;
      const dm = Math.abs(mx - T.x);
      const dp = Math.abs(px - M.x);
      out.push({ key: [dm + dp, dm, dp], mx, px });
    }
  }
  // Stable: pairs with the same distances keep their search order (the literal x first).
  return out.sort((a, b) => (lexLess(a.key, b.key) ? -1 : lexLess(b.key, a.key) ? 1 : 0));
}
/**
 * swapPlans(start, id, tk, kindOf, kind?) → every cell swap of `id` with `tk` that fits, the
 * nearest first (owner 2026-09-23). The mover takes the partner's cell: its row, its x, its
 * width clamped to the MOVER's min/max. The partner takes the mover's home cell the same
 * way. Heights never change. A full-row block (w12) needs its whole row, so it can trade
 * only with a tile alone on its row, and only while it is alone on its own.
 */
export function swapPlans(start, id, tk, kindOf, kind = null) {
  const M = start[id];
  const T = start[tk];
  if (!M || !T || id === tk) return [];
  const lim = limitsFor(kindOf, start, id, kind || (kindOf ? kindOf(id) : null));
  const lm = lim(id);
  const lt = lim(tk);
  const mw = clampN(T.w, lm.minW, lm.maxW);
  const tw = clampN(M.w, lt.minW, lt.maxW);
  return jointCells(start, id, tk, mw, tw).map((j) => (
    { type: 'swap', partner: tk, m: { x: j.mx, y: T.y, w: mw }, p: { x: j.px, y: M.y, w: tw } }
  ));
}
/** The nearest cell swap (swapPlans' first), or null when none fits. Frames are not judged. */
export function swapCells(start, id, tk, kindOf, kind = null) {
  return swapPlans(start, id, tk, kindOf, kind)[0] || null;
}
/**
 * The keyboard's exchanges, nearest first: like a drop, but EACH TILE KEEPS ITS WIDTH, so an
 * arrow press never widens or narrows anything. Two touching row-mates trade order inside the
 * span they already share; across rows each goes to the other's cell with its own width,
 * when that fits without covering a third tile.
 */
function keySwaps(start, id, tk) {
  const M = start[id];
  const T = start[tk];
  if (M.y === T.y) {
    if (M.x + M.w === T.x) {
      return [{ type: 'swap', partner: tk, m: { x: M.x + T.w, y: M.y, w: M.w }, p: { x: M.x, y: M.y, w: T.w } }];
    }
    if (T.x + T.w === M.x) {
      return [{ type: 'swap', partner: tk, m: { x: T.x, y: M.y, w: M.w }, p: { x: T.x + M.w, y: M.y, w: T.w } }];
    }
    return [];
  }
  return jointCells(start, id, tk, M.w, T.w).map((j) => (
    { type: 'swap', partner: tk, m: { x: j.mx, y: T.y, w: M.w }, p: { x: j.px, y: M.y, w: T.w } }
  ));
}

// ── pointer → target ─────────────────────────────────────────────────────────
/**
 * Everything a drag needs, fixed at activation (the page is frozen during a carry).
 *   geo.rows  [{y, top, bottom}] per row of `start`, grid-local content px, in row order
 *   geo.colW  one column's width in px; geo.gap the gutter (defaults to GRID_GAP)
 * `halfW` is the horizontal anchor: the reference point R sits halfW right of the carried
 * tile's left edge (its centre column). The UI computes R (layout-motion.js).
 */
export function dragContext(start, id, kind, geo, { groups = [], kindOf = null, halfW = null } = {}) {
  const M = start[id];
  const ys = rowYs(start);
  const gap = geo.gap ?? GRID_GAP;
  const step = geo.colW + gap;
  const band = isBandKind(kind);
  return {
    start, id, kind, M, geo, groups: groups || [], kindOf, band, ys, step, gap,
    ownIdx: ys.indexOf(M.y),
    halfW: halfW ?? ((band ? 12 : M.w) * step - gap) / 2,
    // Multi-row groups the mover is not in: a fresh row never opens between their rows.
    spans: (groups || []).filter((g) => !(g.tileIds || []).includes(id)).map((g) => {
      const b = groupBounds(start, g.tileIds);
      return b && { a: ys.indexOf(b.y), z: ys.indexOf(b.y + b.rows - 1), g };
    }).filter((s) => s && s.z > s.a),
  };
}
/** The height of a row's edge zone: 15% of the row, 14..40 px. */
export const edgeOf = (r) => clampN(0.15 * (r.bottom - r.top), 14, 40);

/** A fresh row may not open strictly inside another group's rows: the boundary moves to
 *  that group's edge NEAREST THE REFERENCE POINT in pixels (in rows when there is none). */
function outsideSpans(ctx, b, py) {
  const rows = ctx.geo.rows;
  for (let guard = 0; guard < 8; guard++) {
    const s = ctx.spans.find((q) => b > q.a && b <= q.z);
    if (!s) break;
    const nearTop = (py == null || !rows.length)
      ? (b - s.a) <= (s.z + 1 - b)
      : Math.abs(py - rows[s.a].top) <= Math.abs(rows[s.z].bottom - py);
    b = nearTop ? s.a : s.z + 1;
  }
  return b;
}
function neighboursOfBoundary(ctx, b) {
  const { start, id, ys } = ctx;
  const out = [];
  if (b - 1 >= 0) out.push(...rowOf(start, ys[b - 1], [id]));
  if (b < ys.length) out.push(...rowOf(start, ys[b], [id]));
  return out;
}
function neighboursOfRow(ctx, r) {
  const { start, id, ys } = ctx;
  const out = [];
  if (r - 1 >= 0) out.push(...rowOf(start, ys[r - 1], [id]));
  if (r + 1 < ys.length) out.push(...rowOf(start, ys[r + 1], [id]));
  return out;
}
function insertTarget(ctx, b, cardX, py) {
  const bb = outsideSpans(ctx, b, py);
  const { M, ownIdx, start, id } = ctx;
  if (ctx.band) {
    if (bb === ownIdx || bb === ownIdx + 1) return HOME;
    return { type: 'insert', before: bb };
  }
  const x = snapX([], M.w, cardX, neighboursOfBoundary(ctx, bb).filter(([, t]) => t.w < 12));
  const alone = rowOf(start, M.y, [id]).length === 0;
  if (alone && (bb === ownIdx || bb === ownIdx + 1) && x === M.x) return HOME;
  return { type: 'insert', before: bb, x };
}
function placeTarget(ctx, r, x) {
  const { start, id, ys, M } = ctx;
  const others = rowOf(start, ys[r], [id]);
  const sx = snapX(others, M.w, x, neighboursOfRow(ctx, r).filter(([, t]) => t.w < 12));
  if (ys[r] === M.y && sx === M.x) return HOME;
  return { type: 'place', y: ys[r], x: sx };
}
/** Guard: a result that breaks a frame becomes a fresh row outside that group (at its
 *  edge nearer the pointer); failing that, home. Never a push. */
function guarded(ctx, tg, cardX, py) {
  if (!tg || tg.type === 'home') return HOME;
  const out = applyTarget(ctx.start, ctx.id, ctx.kind, tg);
  if (out === ctx.start) return HOME;
  const g = breaksFrame(ctx.start, out, ctx.id, ctx.groups, landingIdx(ctx.start, ctx.id, tg));
  if (!g) return tg;
  if (tg.type === 'insert') return HOME;
  const b = groupBounds(ctx.start, g.tileIds);
  const a = ctx.ys.indexOf(b.y);
  const z = ctx.ys.indexOf(b.y + b.rows - 1);
  const rows = ctx.geo.rows;
  const before = rows.length && py != null
    ? (Math.abs(py - rows[a].top) <= Math.abs(rows[z].bottom - py) ? a : z + 1)
    : a;
  const alt = insertTarget(ctx, before, cardX, py);
  if (alt.type === 'home') return HOME;
  const out2 = applyTarget(ctx.start, ctx.id, ctx.kind, alt);
  if (out2 === ctx.start) return HOME;
  return breaksFrame(ctx.start, out2, ctx.id, ctx.groups, landingIdx(ctx.start, ctx.id, alt)) ? HOME : alt;
}
/** The owner's cell swap with `tk`: the nearest pair of positions that breaks no frame (a
 *  stranger landing inside a group's box, or the pair's own frame left unclean), or null when
 *  every pair that fits would. */
function swapGuarded(ctx, tk) {
  for (const plan of swapPlans(ctx.start, ctx.id, tk, ctx.kindOf, ctx.kind)) {
    const out = applyTarget(ctx.start, ctx.id, ctx.kind, plan);
    if (!breaksFrame(ctx.start, out, ctx.id, ctx.groups, landingIdx(ctx.start, ctx.id, plan))) return plan;
  }
  return null;
}

/**
 * The target for one reference point R = (px, py), grid-local content px, with no memory.
 * In order:
 *  0. R inside the home cell at the tile's own column → home (a pickup is never a move).
 *  1. R in a boundary zone (the gutter plus each row's edge zone) → a fresh row there.
 *  2. R over another tile → swap cells with it; if that cannot be, free columns within
 *     NEAR_PLACE_COLS of the card; else a fresh row above or below by pointer half.
 *  3. R over free columns → the nearest free fit to the card's column, snapped.
 */
export function rawTarget(ctx, px, py) {
  const { geo, M, start, id, band, step, ys } = ctx;
  const rows = geo.rows;
  const n = rows.length;
  if (!M || !n || ctx.ownIdx < 0) return HOME;
  const cardX = clampN(Math.round((px - ctx.halfW) / step), 0, 12 - M.w);
  const own = rows[ctx.ownIdx];
  const hx0 = M.x * step;
  const hx1 = (M.x + M.w) * step - ctx.gap;
  if (py >= own.top && py < own.bottom && (band || (px >= hx0 && px < hx1 && cardX === M.x))) return HOME;
  let r = -1;
  let b = n;
  for (let i = 0; i < n; i++) {
    const e = edgeOf(rows[i]);
    if (py < rows[i].top + e) { b = i; break; }
    if (py < rows[i].bottom - e) { r = i; break; }
  }
  if (r < 0) return guarded(ctx, insertTarget(ctx, b, cardX, py), cardX, py);
  const R = rows[r];
  const upper = py < (R.top + R.bottom) / 2;
  const byHalf = () => guarded(ctx, insertTarget(ctx, upper ? r : r + 1, cardX, py), cardX, py);
  const others = rowOf(start, ys[r], [id]);
  const rowTaken = others.some(([, t]) => t.w === 12);
  const pc = clampN(Math.floor(px / step), 0, 11);
  const under = others.find(([, t]) => pc >= t.x && pc < t.x + t.w);
  if (under) {
    const plan = swapGuarded(ctx, under[0]);
    if (plan) return plan;
    if (!band && !rowTaken) {
      const near = nearestFit(others, M.w, cardX, NEAR_PLACE_COLS);
      if (near != null) {
        const tg = guarded(ctx, placeTarget(ctx, r, near), cardX, py);
        if (tg.type !== 'home') return tg;
      }
    }
    // The owner's fallback, literally: a place, else an insert, also on the tile's own row.
    return byHalf();
  }
  if (!band && !rowTaken) {
    const fit = nearestFit(others, M.w, cardX);
    if (fit != null) return guarded(ctx, placeTarget(ctx, r, fit), cardX, py);
  }
  return ys[r] === M.y ? HOME : byHalf();
}

// ── the 2-D dead zone ────────────────────────────────────────────────────────
/**
 * rawTarget is constant between known lines on each axis: column lines, the card's
 * half-column rounding lines, the home cell's edges, each row's edge zones and middle, and
 * the middle of every group's rows. axisBreaks lists them, so the lines cut the page into
 * CELLS, and each cell has one target (tests/layout-grid-test.mjs checks that no line is
 * missing).
 */
export function axisBreaks(ctx) {
  const { geo, M, step, halfW } = ctx;
  const own = geo.rows[ctx.ownIdx];
  const ys = own ? [own.top, own.bottom] : [];
  for (const r of geo.rows) {
    const e = edgeOf(r);
    ys.push(r.top + e, (r.top + r.bottom) / 2, r.bottom - e);
  }
  for (const g of ctx.groups || []) {
    const b = groupBounds(ctx.start, g.tileIds);
    if (!b) continue;
    const a = ctx.ys.indexOf(b.y);
    const z = ctx.ys.indexOf(b.y + b.rows - 1);
    if (geo.rows[a] && geo.rows[z]) ys.push((geo.rows[a].top + geo.rows[z].bottom) / 2);
  }
  const xs = [M.x * step, (M.x + M.w) * step - ctx.gap];
  for (let k = 1; k < 12; k++) xs.push(k * step);
  for (let k = 0; k < 12; k++) xs.push((k + 0.5) * step + halfW);
  return { xs: uniqSorted(xs), ys: uniqSorted(ys) };
}
const uniqSorted = (a) => [...new Set(a.map((v) => Math.round(v * 1000) / 1000))].sort((p, q) => p - q);
const intervalOf = (breaks, v) => {
  let i = 0;
  while (i < breaks.length && breaks[i] <= v) i++;
  return i;
};
/** How far v lies outside interval i ([breaks[i-1], breaks[i])); 0 inside it. */
const axisGap = (breaks, i, v) => {
  const lo = i > 0 ? breaks[i - 1] : -Infinity;
  const hi = i < breaks.length ? breaks[i] : Infinity;
  return v < lo ? lo - v : v >= hi ? v - hi : 0;
};
/** A point well inside interval i: its middle, or 1px past its one finite edge. */
const axisPoint = (breaks, i) => {
  const lo = i > 0 ? breaks[i - 1] : null;
  const hi = i < breaks.length ? breaks[i] : null;
  if (lo == null && hi == null) return 0;
  if (lo == null) return hi - 1;
  if (hi == null) return lo + 1;
  return (lo + hi) / 2;
};
/** The target of cell (i, j), computed once per carry (the page is frozen, so it holds). */
function cellTarget(ctx, fn, i, j) {
  const cache = ctx.cellCache || (ctx.cellCache = new Map());
  const k = i * 65536 + j;
  let c = cache.get(k);
  if (!c) {
    const target = fn(ctx, axisPoint(ctx.breaks.xs, i), axisPoint(ctx.breaks.ys, j));
    c = { target, key: targetKey(target) };
    cache.set(k, c);
  }
  return c;
}
/**
 * The dead zone, in 2-D (owner ask 2026-09-23: "smooth, not glitchy"). The target in force is
 * kept while a point that still gives it lies closer than H px to the hand; otherwise the
 * target is the one under the hand. So the landing mark never flips on a tremor under H px in
 * any direction, and it is never more than H px from the hand either: after a quick move it
 * follows at once instead of staying where the hand used to be (review 2026-09-23: a settled
 * point per axis could trail the hand by hundreds of px and show a mix of the two).
 * `state` = {key} of the target in force, or null.
 */
function settle(ctx, fn, state, px, py, H) {
  const { xs, ys } = ctx.breaks;
  const here = cellTarget(ctx, fn, intervalOf(xs, px), intervalOf(ys, py));
  if (!state || state.key === here.key) return { state: { key: here.key }, target: here.target };
  for (let i = intervalOf(xs, px - H), i1 = intervalOf(xs, px + H); i <= i1; i++) {
    const dx = axisGap(xs, i, px);
    if (dx >= H) continue;
    for (let j = intervalOf(ys, py - H), j1 = intervalOf(ys, py + H); j <= j1; j++) {
      const dy = axisGap(ys, j, py);
      if (Math.hypot(dx, dy) >= H) continue;
      const c = cellTarget(ctx, fn, i, j);
      if (c.key === state.key) return { state, target: c.target };
    }
  }
  return { state: { key: here.key }, target: here.target };
}
/**
 * One animation frame of a carry: state = {key} | null → {state, target}. The drop commits
 * the target of the last call; pointerup computes nothing new.
 */
export function pointerStep(ctx, state, px, py, H = HYST_PX) {
  if (!ctx.breaks) ctx.breaks = axisBreaks(ctx);
  return settle(ctx, rawTarget, state, px, py, H);
}

/**
 * What the overlay draws for a target, in the FROZEN geometry, grid-local px:
 *   slot       {left, top, width, height}  the landing cell (place, swap, home)
 *   insert     {left, width, y}            the fresh-row bar, centred in the row gap
 *   partners   {id: {left, top, width, height}}  where the swap partner goes
 *   vacated    {left, top, width, height}  the freed space (place and insert only)
 * `heightOf(id)` → the tile's own drawn height, so a taller tile's slot honestly overhangs
 * a shorter row; null falls back to the row height.
 * `naturalOf(id)` → the tile's height when nothing stretches it (defaults to heightOf). A
 * swap between rows can change their heights: the two rows it touches become as tall as the
 * tallest tile each now holds. The mark lower of the two then moves down by what the row
 * above it grows, so the slot and the partner's destination are where the drop puts them
 * and never overlap each other (review 2026-09-23: Line Items carried onto a chart showed the
 * chart going 127px short of where it landed, under the slot). A row that shrinks is not
 * followed upwards: the frozen page still shows it at full height, and the whole page closes
 * up together at the drop.
 */
export function previewRects(ctx, tg, heightOf = () => null, naturalOf = null) {
  const { geo, M, step, id, gap, start } = ctx;
  const rowRect = (y) => geo.rows.find((r) => r.y === y);
  const colRect = (x, w) => ({ left: x * step, width: w * step - gap });
  const hOf = (k, y) => {
    const r = rowRect(y);
    const h = heightOf(k);
    return h == null ? r.bottom - r.top : h;
  };
  const out = { slot: null, insert: null, partners: {}, vacated: null };
  const home = rowRect(M.y);
  const homeCell = { ...colRect(ctx.band ? 0 : M.x, ctx.band ? 12 : M.w), top: home.top, height: hOf(id, M.y) };
  if (!tg || tg.type === 'home') {
    out.slot = homeCell;
    return out;
  }
  out.vacated = homeCell;
  if (tg.type === 'place') {
    out.slot = { ...colRect(tg.x, M.w), top: rowRect(tg.y).top, height: hOf(id, tg.y) };
  } else if (tg.type === 'swap') {
    // How much the row at y grows when `leaving` goes and `coming` arrives.
    const nat = (k, y) => {
      const n = naturalOf ? naturalOf(k) : null;
      return n == null ? hOf(k, y) : n;
    };
    const grows = (y, leaving, coming) => {
      const r = rowRect(y);
      const stay = rowOf(start, y, [leaving]).map(([k]) => nat(k, y));
      return Math.max(0, Math.max(nat(coming, y), ...stay) - (r.bottom - r.top));
    };
    const same = tg.m.y === tg.p.y;
    const slotDown = !same && tg.p.y < tg.m.y ? grows(tg.p.y, id, tg.partner) : 0;
    const partnerDown = !same && tg.m.y < tg.p.y ? grows(tg.m.y, tg.partner, id) : 0;
    out.slot = { ...colRect(tg.m.x, tg.m.w), top: rowRect(tg.m.y).top + slotDown, height: hOf(id, tg.m.y) };
    out.partners[tg.partner] = {
      ...colRect(tg.p.x, tg.p.w), top: rowRect(tg.p.y).top + partnerDown, height: hOf(tg.partner, tg.p.y),
    };
    out.vacated = null;
  } else if (tg.type === 'insert') {
    const rows = geo.rows;
    const y = tg.before < rows.length ? rows[tg.before].top - gap / 2 : rows[rows.length - 1].bottom + gap / 2;
    out.insert = { ...colRect(ctx.band ? 0 : tg.x, ctx.band ? 12 : M.w), y };
  }
  return out;
}

// ── keyboard: one press = one step; the opposite key right after undoes it exactly ──
const INVERSE = { ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft', ArrowUp: 'ArrowDown', ArrowDown: 'ArrowUp' };

/**
 * The target one arrow press asks for → {target, why, other?, group?}. target null means
 * nothing to do, and `why` says what the live line announces:
 *   'left' | 'right' | 'top' | 'bottom'  already at that edge
 *   'fullrow'                             a full-width block moves up and down only
 *   'group'                               a group's frame refuses it (`group` = its id;
 *                                         `other` = the tile it would have traded with)
 * Same vocabulary as a pointer drop, with two keyboard rules: a key never changes a width
 * (keySwaps), and a key never trades with a full-row block (it hops over it).
 */
export function arrowTarget(tiles, id, kind, key, groups = [], kindOf = null) {
  const M = tiles[id];
  if (!M) return { target: null, why: 'gone' };
  const ys = rowYs(tiles);
  const pos = ys.indexOf(M.y);
  const lim = limitsFor(kindOf, tiles, id, kind);
  const band = isBandKind(kind);
  const ctx = dragContext(tiles, id, kind, { rows: [], colW: 100 }, { groups, kindOf });
  const check = (tg) => {
    if (!tg || tg.type === 'home') return { tg: null, g: null };
    const out = applyTarget(tiles, id, kind, tg);
    if (out === tiles) return { tg: null, g: null };
    const g = breaksFrame(tiles, out, id, groups, landingIdx(tiles, id, tg));
    return g ? { tg: null, g } : { tg, g: null };
  };
  // The first exchange that breaks no frame; else the group the nearest one would break.
  const checkAll = (plans) => {
    let g = null;
    for (const tg of plans) {
      const c = check(tg);
      if (c.tg) return c;
      g = g || c.g;
    }
    return { tg: null, g };
  };
  const done = (tg) => ({ target: tg, why: null });
  const refused = (g, other) => ({ target: null, why: 'group', group: g ? g.id : null, other: other || null });
  // A row inside another group's multi-row span is hopped as one.
  const hop = (next, dir) => {
    const span = ctx.spans.find((sp) => next >= sp.a && next <= sp.z);
    return span ? (dir > 0 ? span.z + 1 : span.a) : null;
  };
  if (band) {
    if (key === 'ArrowLeft' || key === 'ArrowRight') return { target: null, why: 'fullrow' };
    const dir = key === 'ArrowUp' ? -1 : 1;
    const next = pos + dir;
    if (next < 0 || next >= ys.length) return { target: null, why: dir < 0 ? 'top' : 'bottom' };
    const h = hop(next, dir);
    const c = check({ type: 'insert', before: h != null ? h : (dir < 0 ? next : next + 1) });
    return c.tg ? done(c.tg) : refused(c.g);
  }
  const mates = rowOf(tiles, M.y, [id]);
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const d = key === 'ArrowLeft' ? -1 : 1;
    if (fitsRow(mates, M.x + d, M.w)) {
      const c = check({ type: 'place', y: M.y, x: M.x + d });
      return c.tg ? done(c.tg) : refused(c.g);
    }
    const touching = mates.find(([, t]) => (d < 0 ? t.x + t.w === M.x : t.x === M.x + M.w));
    if (!touching) return { target: null, why: d < 0 ? 'left' : 'right' };
    const c = checkAll(keySwaps(tiles, id, touching[0]));
    return c.tg ? done(c.tg) : refused(c.g, touching[0]);
  }
  const dir = key === 'ArrowUp' ? -1 : 1;
  const alone = mates.length === 0;
  const nextIdx = pos + dir;
  if (nextIdx < 0 || nextIdx >= ys.length) {
    if (alone) return { target: null, why: dir < 0 ? 'top' : 'bottom' };
    const c = check({ type: 'insert', before: dir < 0 ? 0 : ys.length, x: M.x });
    return c.tg ? done(c.tg) : refused(c.g);
  }
  const h = hop(nextIdx, dir);
  if (h != null) {
    const c = check({ type: 'insert', before: h, x: M.x });
    return c.tg ? done(c.tg) : refused(c.g);
  }
  let blocked = null;
  const R = rowOf(tiles, ys[nextIdx], [id]);
  if (!R.some(([k]) => lim(k).band)) {
    // 1. trade places with the tile of the next row that overlaps it most (widths kept)
    const best = R.map(([k, t]) => [k, Math.min(M.x + M.w, t.x + t.w) - Math.max(M.x, t.x), t.x])
      .filter((c) => c[1] > 0).sort((p, q) => q[1] - p[1] || p[2] - q[2])[0];
    if (best) {
      const c = checkAll(keySwaps(tiles, id, best[0]));
      if (c.tg) return done(c.tg);
      if (c.g) blocked = { g: c.g, other: best[0] };
    }
    // 2. the free columns of the next row nearest its own column
    const fit = nearestFit(R, M.w, M.x);
    if (fit != null) {
      const c = check({ type: 'place', y: ys[nextIdx], x: fit });
      if (c.tg) return done(c.tg);
      if (c.g && !blocked) blocked = { g: c.g };
    }
  }
  // 3. a row of its own: right next to its row when it shares one, past the next row when alone
  const c = check({ type: 'insert', before: alone ? (dir > 0 ? nextIdx + 1 : nextIdx) : (dir > 0 ? pos + 1 : pos), x: M.x });
  if (c.tg) return done(c.tg);
  return refused((blocked && blocked.g) || c.g, blocked && blocked.other);
}
export function arrowMove(tiles, id, kind, key, groups = [], kindOf = null) {
  const { target } = arrowTarget(tiles, id, kind, key, groups, kindOf);
  return target ? applyTarget(tiles, id, kind, target) : tiles;
}
/**
 * The UI's arrow handler. state = {tiles, stack} → {tiles, stack, undone, why, other, group}.
 * Each stack entry remembers the map it PRODUCED. The opposite arrow undoes the last press
 * only while `tiles` is still exactly that map (identity): any other write in between (a
 * switch parked a tile, a newcomer was merged, a drag) makes the stack stale, and the press
 * steps forward instead. `mover(tiles, id, kind, key)` → {tiles, why?} replaces the tile
 * move, so a group frame's keys share the same undo (frameMover).
 */
export function arrowStep(state, id, kind, key, groups = [], kindOf = null, mover = null) {
  const cur = state.tiles;
  const stack = state.stack || [];
  const top = stack[stack.length - 1];
  const fresh = !!top && top.after === cur;
  if (fresh && top.id === id && top.key === INVERSE[key]) {
    return { tiles: top.before, stack: stack.slice(0, -1), undone: true, why: null };
  }
  let next = cur;
  let info;
  if (mover) {
    info = mover(cur, id, kind, key) || {};
    next = info.tiles || cur;
  } else {
    info = arrowTarget(cur, id, kind, key, groups, kindOf);
    next = info.target ? applyTarget(cur, id, kind, info.target) : cur;
  }
  if (next === cur) {
    return { tiles: cur, stack: fresh ? stack : [], undone: false, why: info.why || null, other: info.other || null, group: info.group || null };
  }
  const keep = fresh && top.id === id ? stack : [];
  return { tiles: next, stack: [...keep, { id, key, before: cur, after: next }], undone: false, why: null };
}
/** arrowStep's mover for a group frame: the frame's keys, undone like a tile's. Pass the
 *  group's id as arrowStep's `id`. */
export function frameMover(ids, groups = []) {
  return (tiles, _id, _kind, key) => {
    const at = groupArrowTarget(tiles, ids, key, groups);
    return { tiles: at.target ? applyGroupTarget(tiles, ids, at.target) : tiles, why: at.why };
  };
}

// ── resize: the right edge follows the pointer; what it cannot get there comes from the left ──
/**
 * resizeTo(start, id, kind, w, h, kindOf, groups) → {tiles, capped}. Always computed from
 * the map the gesture started from, so a pickup changes nothing and returning restores it.
 * Growth, in order: free columns on the right; the touching right neighbour slides into its
 * own trailing free space, then narrows (right edge fixed) to its minimum; then the mirror on
 * the left: free columns, the touching left neighbour slides left, then narrows (left edge
 * fixed). Past that the width is capped. Narrowing keeps x and never re-grows a neighbour.
 * Nothing leaves its row, at most one neighbour on each side changes, and no valid frame is
 * broken (the width is capped at the widest that keeps every frame).
 */
export function resizeTo(start, id, kind, w, h, kindOf = null, groups = []) {
  const M = start[id];
  if (!M) return { tiles: start, capped: false };
  const lim = limitsFor(kindOf, start, id, kind);
  const lm = lim(id);
  if (lm.band) return { tiles: start, capped: false };
  const steps = hasOwn(KIND_CONSTRAINTS, kind) ? KIND_CONSTRAINTS[kind].hSteps : null;
  const hh = steps ? (steps.includes(h) ? h : M.h) : M.h;
  const want0 = clampN(Math.round(w), lm.minW, lm.maxW);
  for (let want = want0; want >= Math.min(M.w, want0); want--) {
    const r = resizeOnce(start, id, want, hh, lim);
    if (!(groups || []).length || !breaksAnyFrame(start, r.tiles, groups)) {
      return { tiles: r.tiles, capped: r.capped || want < want0 };
    }
  }
  return { tiles: start, capped: true };
}
function breaksAnyFrame(start, out, groups) {
  return (groups || []).some((g) => frameValid(start, g) && !frameValid(out, g));
}
function resizeOnce(start, id, want, h, lim) {
  const M = start[id];
  const out = {};
  for (const [k, t] of Object.entries(start)) out[k] = { ...t };
  let x = M.x;
  if (want <= M.w) {
    out[id] = { ...M, w: want, h };
    return { tiles: tilesEqual(out, start) ? start : out, capped: false };
  }
  let grow = want - M.w;
  const row = rowOf(start, M.y, [id]);
  const right = row.filter(([, t]) => t.x >= M.x + M.w).sort((a, b) => a[1].x - b[1].x);
  const left = row.filter(([, t]) => t.x + t.w <= M.x).sort((a, b) => b[1].x - a[1].x);
  // the right side: free columns, then the touching neighbour slides, then narrows
  const freeR = (right[0] ? right[0][1].x : 12) - (M.x + M.w);
  grow -= Math.min(grow, freeR);
  if (grow > 0 && right[0]) {
    const [nk, nt] = right[0];
    const limit = right[1] ? right[1][1].x : 12;
    const slide = Math.min(grow, limit - (nt.x + nt.w));
    let nx = nt.x + slide;
    let nw = nt.w;
    grow -= slide;
    const sh = Math.min(grow, nt.w - lim(nk).minW);
    nx += sh; nw -= sh; grow -= sh;
    out[nk] = { ...nt, x: nx, w: nw };
  }
  // the left side, the mirror
  if (grow > 0) {
    const freeL = M.x - (left[0] ? left[0][1].x + left[0][1].w : 0);
    const takeL = Math.min(grow, freeL);
    x -= takeL; grow -= takeL;
    if (grow > 0 && left[0]) {
      const [pk, pt] = left[0];
      const limitL = left[1] ? left[1][1].x + left[1][1].w : 0;
      const slide = Math.min(grow, pt.x - limitL);
      const pxx = pt.x - slide;
      let pw = pt.w;
      grow -= slide; x -= slide;
      const sh = Math.min(grow, pt.w - lim(pk).minW);
      pw -= sh; grow -= sh; x -= sh;
      out[pk] = { ...pt, x: pxx, w: pw };
    }
  }
  out[id] = { ...M, x, w: want - grow, h };
  return { tiles: tilesEqual(out, start) ? start : out, capped: grow > 0 };
}
/**
 * One grip key: width ±1 (←/→) or height step ±1 (↑/↓), recomputed from `anchor` — the
 * map at grip focus — so one focus is one resize, exactly like a pointer resize from its
 * pickup, and Right×n then Left×n comes back exactly.
 */
export function gripMove(tiles, id, kind, key, kindOf = null, groups = [], anchor = null) {
  const t = tiles[id];
  if (!t) return tiles;
  const base = anchor && anchor[id] ? anchor : tiles;
  const k = key.replace(/^grip:/, '');
  if (k === 'ArrowLeft' || k === 'ArrowRight') {
    return resizeTo(base, id, kind, t.w + (k === 'ArrowRight' ? 1 : -1), t.h, kindOf, groups).tiles;
  }
  const steps = hasOwn(KIND_CONSTRAINTS, kind) ? KIND_CONSTRAINTS[kind].hSteps : null;
  if (!steps || (k !== 'ArrowUp' && k !== 'ArrowDown')) return tiles;
  const i = steps.indexOf(t.h);
  const j = clampN(i + (k === 'ArrowDown' ? 1 : -1), 0, steps.length - 1);
  return j === i ? tiles : resizeTo(base, id, kind, t.w, steps[j], kindOf, groups).tiles;
}

// ── groups: the frame moves the member SET ───────────────────────────────────
/**
 * Group targets, in the start map's row space:
 *   home
 *   gshift  {dx}             members slide dx columns inside their own rows (free columns)
 *   gswap   {dx, with, wdx}  members slide dx; the non-members they cover slide the other way
 *                            into the columns the members left (a column swap)
 *   ginsert {before, x}      the member rows leave and re-open as fresh rows at boundary
 *                            `before`, at box column x, offsets kept
 * A group whose member rows are not next to each other (a stranger's row between them)
 * keeps its shape: it moves sideways only, and a vertical move is refused.
 */
export function groupContext(start, ids, geo, { groups = [], halfW = null } = {}) {
  const members = (ids || []).filter((i) => start[i]);
  const b0 = groupBounds(start, members);
  const b = { x: b0.x, w: b0.w, y1: b0.y, y2: b0.y + b0.rows - 1 };
  const ys = rowYs(start);
  const gap = geo.gap ?? GRID_GAP;
  const step = geo.colW + gap;
  return {
    start, members, b, ys, a: ys.indexOf(b.y1), z: ys.indexOf(b.y2), geo, groups: groups || [], step, gap,
    solid: isSolidGroup(start, { tileIds: members }),
    halfW: halfW ?? (b.w * step - gap) / 2,
    spans: (groups || []).filter((g) => !members.some((m) => (g.tileIds || []).includes(m))).map((g) => {
      const gb = groupBounds(start, g.tileIds);
      return gb && { a: ys.indexOf(gb.y), z: ys.indexOf(gb.y + gb.rows - 1) };
    }).filter((s) => s && s.z > s.a),
  };
}
export function applyGroupTarget(start, ids, tg) {
  if (!tg || tg.type === 'home') return start;
  const members = (ids || []).filter((i) => start[i]);
  if (!members.length) return start;
  const out = {};
  for (const [k, t] of Object.entries(start)) out[k] = { ...t };
  const b = groupBounds(start, members);
  if (tg.type === 'gshift' || tg.type === 'gswap') {
    for (const m of members) out[m].x += tg.dx;
    if (tg.type === 'gswap') for (const w of tg.with) out[w].x += tg.wdx;
  } else if (tg.type === 'ginsert') {
    const ys = rowYs(start);
    const base = tg.before < ys.length ? ys[tg.before] - 0.5 : ys[ys.length - 1] + 0.5;
    const memberRows = [...new Set(members.map((m) => start[m].y))].sort((p, q) => p - q);
    for (const m of members) {
      out[m].y = base + (memberRows.indexOf(start[m].y) + 1) / (memberRows.length + 1) - 0.5;
      out[m].x = start[m].x - b.x + tg.x;
    }
  } else {
    throw new TypeError(`Unknown group target "${String(tg.type)}"`);
  }
  const res = compactVertical(out);
  return tilesEqual(res, start) ? start : res;
}
/**
 * previewRects for a group frame's target: the same shapes, grid-local px in the frozen
 * geometry, so one overlay draws both.
 *   slot      the box at its landing columns (home, gshift, gswap)
 *   insert    the fresh-row bar at boundary `before`, as wide as the box (ginsert)
 *   partners  where each non-member a gswap trades columns with goes
 *   vacated   the box it leaves (ginsert only)
 */
export function groupPreviewRects(gctx, tg, heightOf = () => null) {
  const { geo, b, step, gap, start } = gctx;
  const rows = geo.rows;
  const rowRect = (y) => rows.find((r) => r.y === y);
  const colRect = (x, w) => ({ left: x * step, width: w * step - gap });
  const top = rowRect(b.y1).top;
  const home = { ...colRect(b.x, b.w), top, height: rowRect(b.y2).bottom - top };
  const out = { slot: null, insert: null, partners: {}, vacated: null };
  if (!tg || tg.type === 'home') {
    out.slot = home;
    return out;
  }
  if (tg.type === 'gshift' || tg.type === 'gswap') {
    out.slot = { ...home, left: (b.x + tg.dx) * step };
    for (const k of tg.type === 'gswap' ? tg.with : []) {
      const t = start[k];
      const r = rowRect(t.y);
      const h = heightOf(k);
      out.partners[k] = { ...colRect(t.x + tg.wdx, t.w), top: r.top, height: h == null ? r.bottom - r.top : h };
    }
    return out;
  }
  if (tg.type === 'ginsert') {
    const y = tg.before < rows.length ? rows[tg.before].top - gap / 2 : rows[rows.length - 1].bottom + gap / 2;
    out.insert = { ...colRect(tg.x, b.w), y };
    out.vacated = home;
  }
  return out;
}
/**
 * The frame moved dx columns inside its own rows → gshift, gswap, HOME (dx 0) or null. A
 * gswap's traded tiles must fit ENTIRELY in the columns the group gives up: one landing
 * inside the moved box would hide the group's own frame (review 2026-09-23: a 1-column nudge
 * threw a wide neighbour across the group into its box). No other valid frame may break.
 */
function groupHorizontal(gctx, dx) {
  const { start, members, b } = gctx;
  if (!dx) return HOME;
  const m = new Set(members);
  const nx = b.x + dx;
  if (nx < 0 || nx + b.w > 12) return null;
  const own = { tileIds: members };
  const ownBroken = (out) => frameValid(start, own) && !frameValid(out, own);
  const inRows = Object.entries(start).filter(([k, t]) => !m.has(k) && t.y >= b.y1 && t.y <= b.y2);
  const covered = inRows.filter(([, t]) => overl(t.x, t.w, nx, b.w));
  if (!covered.length) {
    const out = applyGroupTarget(start, members, { type: 'gshift', dx });
    return ownBroken(out) || breaksAnyFrameExcept(start, out, gctx) ? null : { type: 'gshift', dx };
  }
  if (covered.some(([, t]) => t.w === 12)) return null;
  const lo = Math.min(...covered.map(([, t]) => t.x));
  const hi = Math.max(...covered.map(([, t]) => t.x + t.w));
  const wdx = dx > 0 ? b.x - lo : (b.x + b.w) - hi;
  const tg = { type: 'gswap', dx, with: covered.map(([k]) => k), wdx };
  const out = applyGroupTarget(start, members, tg);
  const cells = new Set();
  for (const t of Object.values(out)) {
    if (t.x < 0 || t.x + t.w > 12) return null;
    for (let c = t.x; c < t.x + t.w; c++) {
      const key = `${t.y}:${c}`;
      if (cells.has(key)) return null;
      cells.add(key);
    }
  }
  return ownBroken(out) || breaksAnyFrameExcept(start, out, gctx) ? null : tg;
}
function breaksAnyFrameExcept(start, out, gctx) {
  return (gctx.groups || []).some((g) => !(g.tileIds || []).some((i) => gctx.members.includes(i))
    && frameValid(start, g) && !frameValid(out, g));
}
/** The frame's target for a reference point R (the carried box's centre column and the
 *  grabbed height), no memory. */
export function rawGroupTarget(gctx, px, py) {
  const { geo, b, step, start } = gctx;
  const rows = geo.rows;
  if (!rows.length || gctx.a < 0) return HOME;
  const cardX = clampN(Math.round((px - gctx.halfW) / step), 0, 12 - b.w);
  const top = rows[gctx.a].top;
  const bottom = rows[gctx.z].bottom;
  if (py >= top && py < bottom) {
    const want = cardX - b.x;
    let best = null;
    for (let dx = -b.x; dx <= 12 - b.w - b.x; dx++) {
      const tg = groupHorizontal(gctx, dx);
      if (!tg) continue;
      if (!best || Math.abs(dx - want) < Math.abs(best.dx - want)
        || (Math.abs(dx - want) === Math.abs(best.dx - want) && Math.abs(dx) < Math.abs(best.dx))) best = { dx, tg };
    }
    return best ? best.tg : HOME;
  }
  if (!gctx.solid) return HOME; // keeps its shape: sideways only
  let bIdx = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const e = edgeOf(rows[i]);
    if (py < rows[i].top + e) { bIdx = i; break; }
    if (py < rows[i].bottom - e) { bIdx = py < (rows[i].top + rows[i].bottom) / 2 ? i : i + 1; break; }
  }
  for (let guard = 0; guard < 8; guard++) {
    const s = gctx.spans.find((q) => bIdx > q.a && bIdx <= q.z);
    if (!s) break;
    bIdx = Math.abs(py - rows[s.a].top) <= Math.abs(rows[s.z].bottom - py) ? s.a : s.z + 1;
  }
  const tg = { type: 'ginsert', before: bIdx, x: cardX };
  const out = applyGroupTarget(start, gctx.members, tg);
  if (out === start) return HOME;
  if (breaksAnyFrameExcept(start, out, gctx)) return HOME;
  return tg;
}
export function groupAxisBreaks(gctx) {
  const { geo, step, halfW } = gctx;
  const ys = [geo.rows[gctx.a].top, geo.rows[gctx.z].bottom];
  for (const r of geo.rows) {
    const e = edgeOf(r);
    ys.push(r.top + e, (r.top + r.bottom) / 2, r.bottom - e);
  }
  for (const s of gctx.spans) ys.push((geo.rows[s.a].top + geo.rows[s.z].bottom) / 2);
  const xs = [];
  for (let k = 0; k < 12; k++) xs.push((k + 0.5) * step + halfW);
  return { xs: uniqSorted(xs), ys: uniqSorted(ys) };
}
/** pointerStep for a group frame: the same 2-D dead zone over rawGroupTarget's cells. */
export function groupPointerStep(gctx, state, px, py, H = HYST_PX) {
  if (!gctx.breaks) gctx.breaks = groupAxisBreaks(gctx);
  return settle(gctx, rawGroupTarget, state, px, py, H);
}
/**
 * One arrow press on a frame → {target, why}. ←/→: one column into free space, else the
 * nearest clean column swap in that direction. ↑/↓: past the adjacent row, hopping another
 * group's rows as one. `why`: 'left' | 'right' | 'top' | 'bottom' | 'blocked' | 'group' |
 * 'shape' (member rows not next to each other: it moves sideways only).
 */
export function groupArrowTarget(tiles, ids, key, groups = []) {
  const members = (ids || []).filter((i) => tiles[i]);
  if (!members.length) return { target: null, why: 'gone' };
  const gctx = groupContext(tiles, members, { rows: [], colW: 100 }, { groups });
  const { b, a, z, ys } = gctx;
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const d = key === 'ArrowLeft' ? -1 : 1;
    if (b.x + d < 0 || b.x + b.w + d > 12) return { target: null, why: d < 0 ? 'left' : 'right' };
    const tg = groupHorizontal(gctx, d);
    if (tg && tg.type === 'gshift') return { target: tg, why: null };
    for (let dx = d; b.x + dx >= 0 && b.x + b.w + dx <= 12; dx += d) {
      const t2 = groupHorizontal(gctx, dx);
      if (t2 && t2.type === 'gswap') return { target: t2, why: null };
    }
    return { target: null, why: 'blocked' };
  }
  if (!gctx.solid) return { target: null, why: 'shape' };
  const dir = key === 'ArrowUp' ? -1 : 1;
  const next = dir < 0 ? a - 1 : z + 1;
  if (next < 0 || next >= ys.length) return { target: null, why: dir < 0 ? 'top' : 'bottom' };
  let before = dir < 0 ? a - 1 : z + 2;
  for (const s of gctx.spans) if (next >= s.a && next <= s.z) before = dir < 0 ? s.a : s.z + 1;
  const tg = { type: 'ginsert', before, x: b.x };
  const out = applyGroupTarget(tiles, members, tg);
  if (out === tiles) return { target: null, why: dir < 0 ? 'top' : 'bottom' };
  return breaksAnyFrameExcept(tiles, out, gctx) ? { target: null, why: 'group' } : { target: tg, why: null };
}
export function groupArrowMove(tiles, ids, key, groups = []) {
  const { target } = groupArrowTarget(tiles, ids, key, groups);
  return target ? applyGroupTarget(tiles, ids, target) : tiles;
}

// ── the cell-shaped API, re-expressed as targets ─────────────────────────────
/**
 * cand = {slot} for a full-row block (insert before ORIGINAL row `slot`) or {x, y} for a
 * sized tile (the cell whose ORIGINAL row value is y). A drop on an occupied cell swaps
 * cells with the tile it covers most.
 */
export function targetForCell(tiles, id, kind, cand, groups = [], kindOf = null) {
  const M = tiles[id];
  if (!M) return HOME;
  const ctx = dragContext(tiles, id, kind, { rows: [], colW: 100 }, { groups, kindOf });
  if (ctx.band) {
    const slot = clampN(cand.slot ?? 0, 0, ctx.ys.length);
    return slot === ctx.ownIdx || slot === ctx.ownIdx + 1 ? HOME : { type: 'insert', before: slot };
  }
  const x = clampN(cand.x ?? M.x, 0, 12 - M.w);
  const r = ctx.ys.indexOf(cand.y);
  if (r < 0) return { type: 'insert', before: ctx.ys.length, x };
  const others = rowOf(tiles, cand.y, [id]);
  const down = r > ctx.ownIdx;
  if (fitsRow(others, x, M.w)) return cand.y === M.y && x === M.x ? HOME : { type: 'place', y: cand.y, x };
  const under = others.map(([k, t]) => [k, Math.min(x + M.w, t.x + t.w) - Math.max(x, t.x)])
    .filter((o) => o[1] > 0).sort((a, b) => b[1] - a[1])[0];
  const plan = under && swapGuarded(ctx, under[0]);
  if (plan) return plan;
  const near = nearestFit(others, M.w, x, NEAR_PLACE_COLS);
  if (near != null) return { type: 'place', y: cand.y, x: near };
  return cand.y === M.y ? HOME : { type: 'insert', before: down ? r + 1 : r, x };
}
/**
 * moveTile(tiles, id, kind, cand, groups?, kindOf?) → tiles — the cell-shaped move over
 * the target engine. Without kindOf a partner's width limits are guessed from its height
 * step, conservatively (guessLimits).
 */
export function moveTile(tiles, id, kind, cand, groups = [], kindOf = null) {
  return applyTarget(tiles, id, kind, targetForCell(tiles, id, kind, cand, groups, kindOf));
}
/**
 * moveTiles(tiles, ids, cand, groups?) — the box-origin API over the group targets: cand =
 * the target bounding-box ORIGIN {x, y}. Same row → the nearest clean column position, which
 * may be where it already is (the same choice a frame drag makes, rawGroupTarget); another
 * row → the member rows re-open there, offsets kept. A no-op returns `tiles`.
 */
export function moveTiles(tiles, ids, cand, groups = []) {
  const members = (ids || []).filter((i) => tiles[i]);
  if (!members.length) return tiles;
  const gctx = groupContext(tiles, members, { rows: [], colW: 100 }, { groups });
  const { b, ys } = gctx;
  if ((cand.y ?? b.y1) === b.y1) {
    const wantX = clampN(Math.round(cand.x ?? b.x), 0, 12 - b.w);
    if (wantX === b.x) return tiles;
    let best = null;
    for (let dx = -b.x; dx <= 12 - b.w - b.x; dx++) {
      const tg = groupHorizontal(gctx, dx);
      if (!tg) continue;
      const d = Math.abs(b.x + dx - wantX);
      if (!best || d < best.d || (d === best.d && Math.abs(dx) < Math.abs(best.dx))) best = { d, dx, tg };
    }
    return best ? applyGroupTarget(tiles, members, best.tg) : tiles;
  }
  if (!gctx.solid) return tiles;
  const r = ys.indexOf(cand.y);
  const before = r < 0 ? (cand.y < b.y1 ? 0 : ys.length) : cand.y > b.y1 ? r + 1 : r;
  return applyGroupTarget(tiles, members, { type: 'ginsert', before, x: clampN(Math.round(cand.x ?? b.x), 0, 12 - b.w) });
}

/** First gap that fits the kind's default size, scanning (y, x); else append below. */
export function placeNew(tiles, kind) {
  const c = constraintFor(kind);
  const w = c.defW;
  const h = c.defH;
  const list = Object.values(tiles);
  const maxY = list.length ? Math.max(...list.map((t) => t.y)) : -1;

  // The gap scan is for tiles that can SHARE a row; the full-row kinds never can.
  if (kind !== 'flow' && kind !== 'section') {
    for (let y = 0; y <= maxY; y++) {
      const row = list.filter((t) => t.y === y);
      if (row.some((t) => t.w === 12)) continue; // full-row tile owns the row
      // scan columns left→right for a w-wide gap
      for (let x = 0; x + w <= 12; x++) {
        const cand = { x, y, w };
        if (!row.some((t) => overlaps({ ...cand, y }, t))) {
          return { x, y, w, h };
        }
      }
    }
  }
  return { x: 0, y: maxY + 1, w, h };
}

/**
 * Widgets that appeared while a layout session is already open (the Library's
 * "+ Add", widget-library spec §6.2) placed into that session's LIVE snapshot —
 * first free spot first, the same placeNew resolveLayout uses for an unplaced id.
 *
 * ADDITIVE ONLY, and identity-preserving:
 *  - nothing new → `cur` itself comes back, so `setTiles` bails out: no re-render,
 *    and a tilesEqual-based `dirty` cannot flip because the drawer pushed a fresh
 *    `display.widgets` array on a keystroke;
 *  - a tile the session already holds is never re-placed (the user may have dragged
 *    it) and never removed — an id that left `display.widgets` is gcLayout's job at
 *    Save. The session owns the arrangement it is editing.
 *
 * @param {Record<string, object>} cur   the session's tiles
 * @param {Array<{id:string}>} widgets   display.widgets (may be null / half-built)
 * @param {(id:string) => string} kindOf the grid's kind resolver
 */
export function mergeNewTiles(cur, widgets, kindOf) {
  const tiles = cur || {};
  const newcomers = (widgets || []).filter((w) => w && w.id && !tiles[w.id]);
  // `tiles`, not `cur`: one shape out of every path — the identity return for a
  // real map, and an empty map for a caller that had none.
  if (!newcomers.length) return tiles;
  const next = { ...tiles };
  for (const w of newcomers) {
    if (next[w.id]) continue; // a repeated id in the list is still ONE tile
    next[w.id] = placeNew(next, kindOf(w.id));
  }
  return next;
}

// ── switched-off tiles: kept, but not in the arrangement (spec 2026-09-03) ────
//
// A tile the user switched off is not on Layout mode's grid, and its place must still be
// there when the switch comes back. That place cannot be a ROW INDEX. The visible half is
// compacted (spec §1), the user then drags rows together and apart, and other tiles park
// and unpark around it — every one of those renumbers the rows, so a stored number points
// somewhere else afterwards and the tile returns below what it used to sit above. (It did:
// review 2026-09-04 found it three ways, and fix round 1 replaced the number.)
//
// What survives all of that is a TILE ID. So a parked tile remembers its two neighbours:
//
//   beside — a tile it shared its row with. It comes back onto THAT tile's row, wherever
//            the session has since moved it. Preferred, and preferably a visible one.
//   under  — the tile immediately above it in the whole arrangement's (y, x) order. Used
//            when it began its own row: that row is re-created directly below `under`'s
//            row. null means it was the very first tile, so the row is a new top row.
//
// Either anchor can name a tile that is itself still parked (two switched-off tiles next
// to each other): the answer is then resolved THROUGH it, so no two parked tiles ever
// collapse onto one remembered place. The pair is exact — materializeParked over a split's
// own output reproduces the arrangement the split was handed, whatever is switched off
// (tests/layout-grid-test.mjs pins it, randomized).
//
// Returning never moves a visible tile (owner 2026-09-23, amending spec 2026-09-03 rules 3
// and 8): a returner whose cell was taken yields, see unparkTile.

const bottomRow = (tiles) => Math.max(-1, ...Object.values(tiles).map((t) => t.y)) + 1;

/**
 * Where a parked tile lands → `{share, y}`: `share` joins the row at `y`, otherwise a
 * fresh row is opened there. Anchors pointing at a tile that is ALSO parked resolve
 * through it — a row-mate hands over its own answer (they came back onto one row), a tile
 * above hands over the place IT would have taken (this one slides up into it).
 */
function parkedPlace(tiles, parked, id, seen) {
  const p = parked[id];
  if (p.beside != null) {
    if (tiles[p.beside]) return { share: true, y: tiles[p.beside].y };
    if (parked[p.beside] && !seen.has(p.beside)) {
      seen.add(p.beside);
      return parkedPlace(tiles, parked, p.beside, seen);
    }
  }
  if (p.under == null) return { share: false, y: 0 };
  if (tiles[p.under]) return { share: false, y: tiles[p.under].y + 1 };
  if (parked[p.under] && !seen.has(p.under)) {
    seen.add(p.under);
    const up = parkedPlace(tiles, parked, p.under, seen);
    return { share: false, y: up.share ? up.y + 1 : up.y };
  }
  // Both anchors are gone (their widgets were deleted mid-session): the bottom is the
  // only honest answer left.
  return { share: false, y: bottomRow(tiles) };
}

/**
 * splitSwitchedOff(placedTiles, isOff) → {tiles, parked}
 *
 * Layout mode arranges only what the dashboard shows. A tile switched off through
 * display.enabled{} takes no row there — so the placed map splits in two: `tiles`, the
 * switched-on half compacted the way view mode compacts it, and `parked`, where the
 * switched-off half waits for its switch, holding x/w/h verbatim plus the two anchors
 * described above. Both halves are fresh objects: the caller edits `tiles` for a whole
 * session and the map it passed in must not move with it.
 *
 * @param {Record<string, object>} placedTiles a resolved id → tile map
 * @param {(id:string) => boolean} isOff       switched-off predicate (display-blocks)
 */
export function splitSwitchedOff(placedTiles, isOff) {
  const order = Object.entries(placedTiles || {})
    .sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x);
  const on = {};
  for (const [id, t] of order) if (!isOff(id)) on[id] = { ...t };
  const parked = {};
  let above = null; // the tile immediately above in (y, x) order — visible or parked
  for (const [id, t] of order) {
    if (!isOff(id)) { above = id; continue; }
    const mates = order.filter(([mid, m]) => mid !== id && m.y === t.y);
    // A VISIBLE row-mate first: it holds that row through every drag. Failing that, the
    // parked tile immediately to the left, whose own anchor then answers for the row.
    const mate = mates.find(([mid]) => on[mid]) || mates.filter(([, m]) => m.x < t.x).pop();
    parked[id] = { x: t.x, w: t.w, h: t.h, beside: mate ? mate[0] : null, under: above };
    above = id;
  }
  return { tiles: compactVertical(on), parked };
}

/**
 * unparkTile(tiles, parked, id) → tiles — one switched-off tile coming back.
 *
 * It returns to the row its anchor names, and NO VISIBLE TILE EVER MOVES for it (owner
 * 2026-09-23, amending spec 2026-09-03 rules 3 and 8):
 *  - it had a row of its own → that row is re-opened directly under the tile it sat under;
 *  - it shared a row and its cell there is free → it takes the cell;
 *  - its cell was taken → it opens a row of its own directly under that row. Returners
 *    pushed out of one row come back together on ONE such row, in their old order
 *    (materializeParked remembers that row by the row's visible tiles).
 * That is the whole rule, groups included: a returner is never moved anywhere else because
 * a group's frame is near. A free cell inside a group's box is still its cell (review
 * 2026-09-23: an extra "out of the frame" pass moved tiles whose cells were free, which the
 * owner's rule does not allow; whether a returner may hide a frame is his call).
 *
 * An id with nothing remembered is a no-op that returns `tiles` ITSELF, so a caller
 * looping over ids cannot mint a new map (and a new render) for nothing.
 */
export function unparkTile(tiles, parked, id) {
  return placeParked(tiles, parked, id, null);
}
function placeParked(tiles, parked, id, memo) {
  const p = parked?.[id];
  if (!p) return tiles;
  const rows = (memo && memo.rows) || new Map();
  const { share, y } = parkedPlace(tiles, parked, id, new Set([id]));
  const cand = { x: p.x, y, w: p.w, h: p.h };
  if (!share) return compactVertical({ ...tiles, [id]: { ...cand, y: y - 0.5 } });
  const row = rowOf(tiles, y);
  if (p.w !== 12 && fitsRow(row, p.x, p.w)) return compactVertical({ ...tiles, [id]: cand });
  // Displaced: join the return row already opened under this row, or open one. The row is
  // named by its VISIBLE tiles: they never move while parked tiles return, so the name
  // survives a row-mate that came back into a free cell of that same row.
  const vis = row.filter(([k]) => !parked[k]).map(([k]) => k).sort();
  const anchorKey = (vis.length ? vis : row.map(([k]) => k).sort()).join(',');
  const firstId = rows.get(anchorKey);
  if (firstId && tiles[firstId] && fitsRow(rowOf(tiles, tiles[firstId].y), p.x, p.w)) {
    return compactVertical({ ...tiles, [id]: { ...cand, y: tiles[firstId].y } });
  }
  rows.set(anchorKey, id);
  return compactVertical({ ...tiles, [id]: { ...cand, y: y + 0.5 } });
}

/**
 * materializeParked(tiles, parked) → the WHOLE arrangement, visible and switched-off alike,
 * in one conflict-free row space. This is what a Layout save writes: a stored layout whose
 * rows already say which tile is above which, instead of two tiles sharing a row index and a
 * reader left to break the tie. (It was left to one, in the key order of the saved object —
 * and Postgres jsonb re-sorts object keys, so the tie broke the wrong way on the save's own
 * response. Review 2026-09-04, fix round 1.)
 *
 * The visible half comes back unchanged (unparkTile never moves a visible tile), so view
 * mode — which drops the switched-off tiles and closes the rows they leave empty — shows
 * exactly what Layout mode showed. And a stored map is a fixed point: splitting it and
 * putting it back together gives the same map, so re-entering Layout mode is clean.
 *
 * Nothing parked → `tiles` itself, so a memo over this cannot churn on a dashboard with
 * every switch on.
 */
export function materializeParked(tiles, parked) {
  const pending = new Map(Object.entries(parked || {}));
  if (!pending.size) return tiles || {};
  let out = tiles || {};
  const memo = { rows: new Map() };
  let moved = true;
  while (pending.size && moved) {
    moved = false;
    for (const [id, p] of [...pending]) {
      // A tile anchored to another PARKED tile waits for it: placed first, it would read
      // a row that is not there yet and the pair would land on two rows instead of one.
      const wait = p.beside != null ? p.beside : p.under;
      if (wait != null && !out[wait] && pending.has(wait)) continue;
      out = placeParked(out, parked, id, memo);
      pending.delete(id);
      moved = true;
    }
  }
  // Unreachable from a split's own anchors — they always name a tile EARLIER in (y, x)
  // order, so the loop drains. A hand-built map with a cycle lands at the bottom.
  for (const [id, p] of pending) {
    out = { ...out, [id]: { x: p.x, y: bottomRow(out), w: p.w, h: p.h } };
  }
  return out;
}

// ── groups: a set of tiles moves as one (widget-library phase 4, §6.4) ────────

/**
 * rowStretchIds(tiles) → the ids of sized tiles that FILL their row's height.
 *
 * A grid row is as tall as its tallest tile, and two tiles of one step still differ when
 * one carries a controls row or a subtitle — the shorter frame then stopped above the
 * row's bottom edge (owner, 2026-09-07). A tile fills the row when no neighbour has a
 * LARGER step: two M tiles level out, an M beside a deliberate L keeps its own height.
 * Content-sized ('auto') tiles and tiles alone on their row are never stretched.
 */
export function rowStretchIds(tiles) {
  const rows = new Map();
  for (const [id, t] of Object.entries(tiles || {})) {
    if (!t) continue;
    const row = rows.get(t.y) || (rows.set(t.y, []), rows.get(t.y));
    row.push({ id, px: H_PX[t.h] });
  }
  const out = new Set();
  for (const row of rows.values()) {
    if (row.length < 2) continue;
    const max = Math.max(...row.map((r) => r.px || 0));
    if (!max) continue;
    for (const r of row) if (r.px === max) out.add(r.id);
  }
  return out;
}

/**
 * resizeStepFor(opts) → the height step a dragged corner grip lands on (Layout mode).
 *
 * The step whose DRAWN bottom edge is nearest the pointer (owner, 2026-09-15). Reading the
 * pointer's distance from the top as a bare step ignored the title above a chart or a table,
 * so the first move after a pickup jumped a step, and it ignored a row that stretches the tile.
 *   offset       the pointer's distance from the top of the tile's cell
 *   from         the step the tile had when the grip was picked up
 *   natural      the tile's height at `from` when nothing stretches it, measured at pickup
 *   grows        whether that height follows the step (a chart's plot or a table's rows do;
 *                a set of numbers does not)
 *   rowNatural   the tallest such height among the other tiles on its row (0 when alone)
 *   stretchedAt  (step) → whether the tile fills its row at that step (rowStretchIds)
 * A tie keeps `from`, so a pickup without a move changes nothing.
 */
export function resizeStepFor({ steps, from, offset, natural, grows, rowNatural = 0, stretchedAt = () => false }) {
  const base = steps.includes(from) ? from : steps[0];
  const heightAt = (step) => {
    const own = natural + (grows ? H_PX[step] - H_PX[base] : 0);
    return stretchedAt(step) ? Math.max(own, rowNatural) : own;
  };
  let best = base;
  let gap = Math.abs(heightAt(base) - offset);
  for (const step of steps) {
    const d = Math.abs(heightAt(step) - offset);
    if (d < gap) { best = step; gap = d; }
  }
  return best;
}

/** The frame's rectangle: x/w in columns, y/rows in logical rows. Null when no
 *  member exists in the map — a frame with nothing under it draws nothing. */
export function groupBounds(tiles, ids) {
  let x1 = 12, y1 = Infinity, x2 = 0, y2 = -Infinity;
  for (const id of ids || []) {
    const t = tiles[id];
    if (!t) continue;
    x1 = Math.min(x1, t.x); y1 = Math.min(y1, t.y);
    x2 = Math.max(x2, t.x + t.w); y2 = Math.max(y2, t.y);
  }
  return y2 < y1 ? null : { x: x1, y: y1, w: x2 - x1, rows: y2 - y1 + 1 };
}

/** §6.4: grouping requires the selection's bounding box to contain only members.
 *  Geometry only — content rules (w_ ids, one-group-per-tile, caps) live in
 *  group-ops.canGroup, which calls this. */
export function selectionGroupable(tiles, ids) {
  const b = groupBounds(tiles, ids);
  if (!b) return { ok: false, reason: 'empty' };
  const set = new Set(ids);
  for (const [id, t] of Object.entries(tiles)) {
    if (set.has(id)) continue;
    const inRows = t.y >= b.y && t.y <= b.y + b.rows - 1;
    const inCols = t.x < b.x + b.w && b.x < t.x + t.w;
    if (inRows && inCols) return { ok: false, reason: 'bounds', blocker: id };
  }
  return { ok: true, bounds: b };
}

/** Groups that appeared while a layout session is open (a block Add behind it) —
 *  the mergeNewTiles contract: additive only, identity-preserving. */
export function mergeNewGroups(cur, saved) {
  const have = new Set((cur || []).map((g) => g.id));
  const newcomers = (saved || []).filter((g) => g && g.id && !have.has(g.id));
  if (!newcomers.length) return cur || [];
  return [...(cur || []), ...newcomers];
}

// ── pointer mapping ───────────────────────────────────────────────────────────

/**
 * Map viewport px → {x: column, y: row}. `rowTops` = ascending array of each row's
 * top edge in px (the renderer measures them); pointer below the last row maps to it.
 * (No app caller since Layout mode's own hit-test replaced it; kept because its test
 * pins it.)
 */
export function tileFromPointer(px, py, gridRect, cols, rowTops) {
  const colW = gridRect.width / cols;
  const x = Math.min(cols - 1, Math.max(0, Math.floor((px - gridRect.left) / colW)));
  let y = rowTops.length - 1;
  for (let i = 0; i < rowTops.length; i++) {
    const bottom = i + 1 < rowTops.length ? rowTops[i + 1] : Infinity;
    if (py < bottom) { y = i; break; }
  }
  return { x, y: Math.max(0, y) };
}

// ── seed / resolve / gc ───────────────────────────────────────────────────────

const maxRow = (tiles) => Math.max(-1, ...Object.values(tiles).map((t) => t.y));
const fullRow = (tiles, id, h) => { tiles[id] = { x: 0, y: maxRow(tiles) + 1, w: 12, h }; };
/** Slot order with a stable tie-break: a null slot sorts last, then by arrival. */
const bySlot = (a, b) => {
  const sa = a.slot == null ? Infinity : a.slot;
  const sb = b.slot == null ? Infinity : b.slot;
  return sa - sb || a.order - b.order;
};

/**
 * seedLayout(display, registry, widgets, kindOf, slotOf) → {tiles}
 *
 * With a slot resolver (spec §5, sections cutover 2026-09-07) every id that HAS a slot — the
 * flow blocks and the fixed-id Standard tiles — is placed in slot order on one scale, so a
 * pacing with no saved layout reads in the page order: Launch Plan, hero, Finance, Alerts,
 * Targets, Line Items, the charts two per row, then Breakdown, Daily Performance, Journal.
 * Unslotted widgets append after, by profile, as they always have. Without a resolver the
 * flow blocks keep their registry order and every widget appends — the pre-cutover rule,
 * which the grid tests pin.
 */
export function seedLayout(display, registry, widgets, kindOf = null, slotOf = null) {
  const tiles = {};
  const flowIds = registry.filter((r) => r.kind === 'flow').map((r) => r.id);
  const list = Array.isArray(widgets) ? widgets : [];
  const gridKind = (w) => (kindOf ? kindOf(w.id) : widgetGridKind(w));
  const slot = (id) => (slotOf ? slotOf(id) : null);

  const slotted = flowIds.map((id, i) => ({ id, kind: 'flow', slot: slot(id), order: i }));
  const rest = [];
  list.forEach((w, i) => {
    const s = slot(w.id);
    if (s == null) { rest.push(w); return; }
    slotted.push({ id: w.id, kind: gridKind(w), slot: s, order: flowIds.length + i });
  });
  slotted.sort(bySlot);

  const place = (id, kind) => {
    // Full-row kinds own the next row; sized kinds first-fit, which is how two charts share
    // one row and a third opens the next.
    if (kind === 'flow' || kind === 'section') fullRow(tiles, id, 'auto');
    else if (kind === 'table') fullRow(tiles, id, KIND_CONSTRAINTS.table.defH);
    else tiles[id] = placeNew(tiles, kind);
  };
  for (const e of slotted) place(e.id, e.kind);
  for (const w of rest) place(w.id, gridKind(w));
  return { tiles: compactVertical(tiles) };
}

/**
 * resolveLayout(display, registry, liveIds, kindOf, slotOf, { isOff }?)
 *   → ordered [{id, tile, kind}] by (y, x).
 * Rules (spec §1): saved geometry wins (re-clamped); unknown saved ids drop; live ids
 * missing from saved auto-place — a full-row id with a page slot inserts among its
 * default neighbours, sized tiles first-fit. layout:null ≡ seed. Without a slot
 * resolver only the registry's flow ids are anchored — the pre-cutover rule.
 *
 * `isOff` (display-blocks switchedOn, negated): a stored layout that still overlaps (saved
 * before 2026-09-04, or hand-edited) settles its VISIBLE tiles first and breaks ties by id,
 * so a switched-off tile never pushes a visible one and the key order Postgres jsonb hands
 * back decides nothing. DashGrid, Layout mode and currentTiles pass the same predicate, so
 * all three agree on the placement.
 */
export function resolveLayout(display, registry, liveIds, kindOf, slotOf = null, { isOff = null } = {}) {
  const widgets = (display?.widgets || []).filter((w) => liveIds.has(w.id));
  const saved = display?.layout?.tiles;

  let tiles;
  if (!saved) {
    tiles = seedLayout(display, registry, widgets, kindOf, slotOf).tiles;
  } else {
    tiles = {};
    for (const [id, t] of Object.entries(saved)) {
      if (!liveIds.has(id)) continue; // unknown/dead ids drop at render
      tiles[id] = clampTile(t, kindOf(id));
    }
    // Live ids missing from the saved layout. The anchored order is the slot scale (flow
    // blocks in registry order where they have no slot, fixed-id Standard tiles by their
    // catalogue slot); a full-row id inserts under the LAST placed predecessor in that order —
    // under the whole chart cluster, not under the first chart. Sized tiles first-fit.
    const flowOrder = registry.filter((r) => r.kind === 'flow').map((r) => r.id);
    const slot = (id) => (slotOf ? slotOf(id) : null);
    const anchored = [
      ...flowOrder.map((id, i) => ({ id, slot: slot(id), order: i })),
      ...[...liveIds].filter((id) => !flowOrder.includes(id) && slot(id) != null)
        .map((id, i) => ({ id, slot: slot(id), order: flowOrder.length + i })),
    ].sort(bySlot).map((e) => e.id);
    for (const id of [...liveIds]) {
      if (tiles[id]) continue;
      const kind = kindOf(id);
      const idx = anchored.indexOf(id);
      const fullRowKind = kind === 'flow' || kind === 'section' || kind === 'table';
      if (idx !== -1 && fullRowKind) {
        let anchorY = -1;
        for (let i = 0; i < idx; i++) {
          const prev = tiles[anchored[i]];
          if (prev && prev.y > anchorY) anchorY = prev.y;
        }
        // Never split a saved group: an insert that would land inside a frame's rows moves
        // below that frame (DashGrid hides a frame with a stranger inside it, silently).
        const groups = Array.isArray(display?.groups) ? display.groups : [];
        let insertY = anchorY + 1;
        for (let moved = true; moved;) {
          moved = false;
          for (const g of groups) {
            const b = groupBounds(tiles, g?.tileIds);
            if (b && b.y < insertY && insertY < b.y + b.rows) { insertY = b.y + b.rows; moved = true; }
          }
        }
        for (const t of Object.values(tiles)) if (t.y >= insertY) t.y += 1;
        tiles[id] = kind === 'table'
          ? { x: 0, y: insertY, w: 12, h: KIND_CONSTRAINTS.table.defH }
          : { x: 0, y: insertY, w: 12, h: 'auto' };
      } else {
        tiles[id] = placeNew(tiles, kind);
      }
    }
    tiles = compactVertical(isOff ? normalizeTiles(tiles, { isOff }) : normalizeTiles(tiles));
  }

  return Object.entries(tiles)
    .map(([id, tile]) => ({ id, tile, kind: kindOf(id) }))
    .sort((a, b) => a.tile.y - b.tile.y || a.tile.x - b.tile.x);
}

/**
 * gcLayout(layout, keepIds) — drop entries whose id is not in keepIds. Callers pass
 * keepIds = registry ids ∪ ALL known chart keys (a checkbox-disabled chart keeps its
 * geometry for re-enable) ∪ live widget ids.
 */
export function gcLayout(layout, keepIds) {
  const tiles = {};
  for (const [id, t] of Object.entries(layout?.tiles || {})) {
    if (keepIds.has(id)) tiles[id] = t;
  }
  return { ...(layout || { version: 1 }), tiles };
}

/**
 * buildKeepIds(display, registryIds) → Set — what a layout Save is allowed to
 * RETAIN. Deliberately wider than the set of tiles currently on screen: a tile
 * switched off through display.enabled keeps its geometry (widget-library spec
 * 2026-08-14 §5) — it is still a member of the arrangement, and re-enabling must
 * restore the EXACT spot. `display.enabled` is therefore never read here. That is
 * the behaviour, not an omission; tests/layout-grid-test.mjs pins it.
 *
 * Every Chart is a Widget instance, so the widgets term below preserves its geometry
 * like every other tile. Bare chart keys are not tile identity and receive no GC exception.
 */
export function buildKeepIds(display, registryIds) {
  return new Set([
    ...(registryIds || []),
    ...((display?.widgets || []).map((w) => w && w.id).filter(Boolean)),
  ]);
}
