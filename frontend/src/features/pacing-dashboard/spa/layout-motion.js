// workspace/src/lib/dashboard/layout-motion.js
//
// How Layout mode MOVES (owner decisions 2026-09-23, docs/2026-09-23-layout-drag.md). The rules
// of where a tile lands live in layout-grid.js; this file is the hand: when a press becomes a
// drag, what the hand carries, the point that decides the target, how far the carried thing may
// travel, autoscroll, when a swap partner slides, and the drop animation. Everything above the
// DOM helpers at the bottom is pure and host-tested by tests/layout-motion-test.mjs.
//
// Coordinates are grid-local content px: 0,0 is the top-left of .lm-grid, and they do not change
// when the page scrolls.

export const DRAG_THRESHOLD_PX = 5;      // mouse / pen: movement before a press becomes a drag
export const GRIP_THRESHOLD_PX = 3;      // the corner grip
export const TOUCH_HOLD_MS = 250;        // touch on a tile body: hold to lift (a swipe still scrolls)
export const TOUCH_SLOP_PX = 8;
export const CARRY_AS_BAR_PX = 380;      // a tile or group TALLER than this is carried as a bar
export const BAR_H = 44;                 // the carried bar's height
export const BAR_INSET = 24;             // a bar's reference point sits at least this deep in its box
export const PARTNER_DWELL_MS = 140;     // a target must hold this long before partners slide
export const REST_PX = 16;               // the hand "rests" when R moved less than this in the dwell
export const PARTNER_FAR = 0.6;          // partners farther than this x view height never slide
export const FLIP_MS = 200;              // drop, keyboard step, cancel glide
export const SLIDE_MS = 180;             // a partner sliding to its destination (CSS)
export const SLOT_MS = 120;              // the landing mark gliding between cells (CSS)
export const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
export const AUTOSCROLL_BAND_PX = 96;
export const AUTOSCROLL_MAX_PX_PER_MS = 1.5;
export const AUTOSCROLL_RAMP_MS = 300;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Card or bar. Fixed px, so the same tile is carried the same way on every screen; a
 *  full-row block is always a bar. */
export const carryStyle = (heightPx, band = false) => (band || heightPx > CARRY_AS_BAR_PX ? 'bar' : 'card');

/**
 * The anchor: the point of the carried thing that is the reference R, measured from the tile's
 * (or group box's) top-left at pickup. A card: its centre. A bar: the centre column, at the
 * height that was grabbed, clamped BAR_INSET into the box (a group's strip sits above its box,
 * so a strip grab starts inside the first row).
 */
export function anchorFor(style, W, H, grabX, grabY) {
  if (style === 'card') return { x: W / 2, y: H / 2 };
  return { x: W / 2, y: clamp(grabY, Math.min(BAR_INSET, H / 2), Math.max(H / 2, H - BAR_INSET)) };
}

/**
 * R = pointer - grab + anchor, clamped into the grid box, so a wide card pinned at the wall
 * still reaches the last columns and nothing outside the grid is ever addressed. At pickup R is
 * the anchor itself, inside the home cell: a pickup is always "home".
 */
export function referencePoint(pointer, grab, anchor, grid) {
  return {
    x: clamp(pointer.x - grab.x + anchor.x, 0, Math.max(0, grid.w - 1)),
    y: clamp(pointer.y - grab.y + anchor.y, -60, grid.h + 60),
  };
}

/**
 * The lifted card's translate. Clamped so the card stays inside the grid box measured at pickup:
 * a transformed child enlarges its scroller's scroll area, and an unclamped card let autoscroll
 * run on into blank space and grew a horizontal scrollbar.
 */
export function cardTranslate(pointer, pickupPointer, cell, grid) {
  const tx = pointer.x - pickupPointer.x;
  const ty = pointer.y - pickupPointer.y;
  return {
    x: clamp(tx, -cell.left, Math.max(-cell.left, grid.w - (cell.left + cell.width))),
    y: clamp(ty, -cell.top, Math.max(-cell.top, grid.h - (cell.top + cell.height))),
  };
}

/** The carried bar: the tile's width (at most the grid's), BAR_H tall, the pointer 12 px under
 *  its top edge, centred on R's column, clamped into the grid box. */
export function barRect(pointer, R, W, grid) {
  const w = Math.min(W, grid.w);
  return {
    left: clamp(R.x - w / 2, 0, Math.max(0, grid.w - w)),
    top: clamp(pointer.y - 12, 0, Math.max(0, grid.h - BAR_H)),
    width: w,
    height: BAR_H,
  };
}

/**
 * Autoscroll velocity in px/ms (negative = up). `top` is the visible content top UNDER the
 * sticky hint bar, `bottom` the scroller's visible bottom. `enteredAt` is when the pointer
 * entered THIS edge band (reset on leaving), so a long carry never arrives at an edge at full
 * speed. Speed = max x depth^2 x ramp, time-based so 60 Hz and 120 Hz screens behave alike.
 */
export function autoscrollVelocity(y, top, bottom, now, enteredAt) {
  const ramp = enteredAt == null ? 0 : Math.min(1, Math.max(0, now - enteredAt) / AUTOSCROLL_RAMP_MS);
  const band = AUTOSCROLL_BAND_PX;
  if (y < top + band) {
    const d = Math.min(1, (top + band - y) / band);
    return -AUTOSCROLL_MAX_PX_PER_MS * d * d * ramp;
  }
  if (y > bottom - band) {
    const d = Math.min(1, (y - (bottom - band)) / band);
    return AUTOSCROLL_MAX_PX_PER_MS * d * d * ramp;
  }
  return 0;
}
/** Which edge band the pointer is in: 'top' | 'bottom' | null. */
export const edgeOfPointer = (y, top, bottom) => (y < top + AUTOSCROLL_BAND_PX ? 'top'
  : y > bottom - AUTOSCROLL_BAND_PX ? 'bottom' : null);
/** One autoscroll frame: the new scrollTop, kept inside [0, the maximum measured at pickup]. */
export const scrollStep = (scrollTop, v, dt, maxScroll) => clamp(scrollTop + v * dt, 0, Math.max(0, maxScroll));

/**
 * The hand rests when the reference point has been sampled for at least PARTNER_DWELL_MS and
 * every sample of the last PARTNER_DWELL_MS is within REST_PX of the newest one.
 * `trail` = [{t, x, y}], oldest first.
 */
export function handResting(trail, now) {
  if (!trail.length || now - trail[0].t < PARTNER_DWELL_MS) return false;
  const recent = trail.filter((p) => now - p.t <= PARTNER_DWELL_MS);
  if (!recent.length) return false;
  const last = recent[recent.length - 1];
  return recent.every((p) => Math.hypot(p.x - last.x, p.y - last.y) < REST_PX);
}
/**
 * Which partners SLIDE this frame. The landing slot and the partner's destination outline
 * follow the target at once; the partner tile itself slides only while the hand rests on a
 * target it has held PARTNER_DWELL_MS, so a sweep across the page moves nothing but outlines.
 * A partner whose trip runs more than PARTNER_FAR x the view height up or down never slides:
 * its outline shows where it goes and the drop animation moves it. Sideways trips are not
 * capped: they stay inside the grid's width, which is on screen, and a same-row swap on a
 * laptop is already a 700px trip that should still read as a swap.
 * `trips` = {id: {dx, dy}}.
 */
export function partnersShown(targetSince, now, trips, viewH, resting = true) {
  if (now - targetSince < PARTNER_DWELL_MS || !resting) return {};
  const out = {};
  for (const [id, trip] of Object.entries(trips)) {
    if (Math.abs(trip.dy) <= PARTNER_FAR * viewH) out[id] = trip;
  }
  return out;
}

/** A landing mark outside the visible content range gets a pill pinned to that edge. */
export function edgeHint(markTop, markBottom, visTop, visBottom) {
  if (markBottom < visTop) return 'above';
  if (markTop > visBottom) return 'below';
  return null;
}

/** FLIP: the translate each element starts from (old rect - new rect); tiny deltas skip. */
export function flipDeltas(before, after, minPx = 0.5) {
  const out = {};
  for (const [id, a] of Object.entries(after)) {
    const b = before[id];
    if (!b) continue;
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    if (Math.abs(dx) >= minPx || Math.abs(dy) >= minPx) out[id] = { dx, dy };
  }
  return out;
}

/**
 * Resize from the pointer with the grab offsets kept: the width from the PICKUP left edge, the
 * height offset from the pickup top. A pickup therefore reads exactly the tile's own size (no
 * step lost on the first pixel), and a width change can never feed back into its own reading.
 */
export function resizeFromPointer({ px, py, left0, top0, grabRight, grabBottom, colW, gap }) {
  const w = Math.round((px + grabRight - left0 + gap) / (colW + gap));
  return { w, offset: py + grabBottom - top0 };
}

// ── DOM helpers (the only two here that touch the page) ──────────────────────

/** The user asked the system for less motion: every duration is then 0 (the carried card still
 *  follows the hand, which is direct manipulation, not animation). */
export function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Plays a FLIP: each element glides from `deltas[id]` back to where it now is, translate only
 * (heights snap; a scaled chart would distort). `raise` = {id: z}: the stacking order while
 * anything glides, so a dropped card and its swap partner never pass under the tiles they cross.
 * A raised element holds its z-index for the whole glide even when it does not move itself (a
 * well-aimed drop lands in place while its partner glides past it). Returns the animations (to
 * cancel them when a new gesture starts); nothing at all under reduced motion.
 * `els` = {id: element}.
 */
export function playFlip(els, deltas, { duration = FLIP_MS, raise = {} } = {}) {
  if (prefersReducedMotion()) return [];
  const out = [];
  for (const [id, { dx, dy }] of Object.entries(deltas)) {
    const el = els[id];
    if (!el || typeof el.animate !== 'function') continue;
    const z = raise[id];
    const from = { transform: `translate(${dx}px, ${dy}px)` };
    const to = { transform: 'translate(0px, 0px)' };
    if (z != null) { from.zIndex = z; to.zIndex = z; }
    out.push(el.animate([from, to], { duration, easing: EASE }));
  }
  if (!out.length) return out;
  for (const [id, z] of Object.entries(raise)) {
    const el = els[id];
    if (deltas[id] || !el || typeof el.animate !== 'function') continue;
    out.push(el.animate([{ zIndex: z }, { zIndex: z }], { duration }));
  }
  return out;
}
