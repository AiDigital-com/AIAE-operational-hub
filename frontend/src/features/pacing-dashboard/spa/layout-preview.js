// workspace/src/lib/dashboard/layout-preview.js
//
// The layout card's preview, as a PURE MODEL (spec 2026-09-03 layout-preview): what a
// layout library entry looks like at card size, before any CSS. The Library screen
// draws it as static spans; nothing here mounts a renderer.
//
// Why a model at all: the old preview mapped every row of a real layout (13 to 20 of
// them) into a 112 px box, so each row was a 6 px sliver, sections were 3 px bars, and
// widgets were same-colour boxes with no gaps — mush. This one gives every row the
// height its tallest tile deserves, keeps 3 px gaps, and draws only the rows that fit,
// with a fade to say there is more. No text: silhouettes tell the kinds apart.

/** Row height by the tile kind, in px — the page's own proportions at card scale. */
export const ROW_H = Object.freeze({
  flow: 11, layout: 15, kpi: 15, chart: 24, table: 20, pie: 20, compare: 16, box: 14,
});
export const ROW_GAP = 3;
/** Between neighbouring tiles on one row; none at the outer edges. */
export const GUTTER = 3;
/** The drawing area: a 160 px border-box minus 8 px of padding top and bottom and the
 *  1 px bottom border. */
export const AREA = 143;
/** How far a group frame reaches past its members' boxes. */
export const GROUP_OUTSET = 3;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const okTile = (t) => t && finite(t.x) && finite(t.y) && finite(t.w) && t.w > 0;

/**
 * The silhouette a stored widget gets: the first view's kind for a v2 report, `layout`
 * for the hero / Finance composites (their first view IS a layout), `box` for anything
 * this build cannot name. Flow entries are `flow` and never reach here.
 */
export function tileKind(definition) {
  const views = definition && definition.spec && Array.isArray(definition.spec.views) ? definition.spec.views : [];
  const kind = views[0] && views[0].kind;
  // A `layout` view on a CARD composite (the std:v2:card:* templates) is a KPI-sized
  // tile, not the page-wide hero band: it draws the KPI row's four blocks.
  if ((kind === 'layout' || kind === 'container') && definition && definition.profile === 'card') return 'kpi';
  if (kind === 'container') return 'layout';
  if (kind === 'atom') return 'kpi';
  return Object.prototype.hasOwnProperty.call(ROW_H, kind) && kind !== 'flow' && kind !== 'box' ? kind : 'box';
}

/**
 * layoutPreviewModel(definition) → { tiles, groups, overflow }
 *
 * `tiles[]`: { id, flow, kind, left, width, gutterLeft, gutterRight, top, height } — left
 * and width as percentages of the 12-column width, the two gutters in px to subtract
 * from them, top and height in px. Rows are laid top-down; a row with nothing on it
 * takes no height and no gap. Rows whose top is past AREA are not returned.
 * `groups[]`: { bg, left, width, gutterLeft, gutterRight, top, height } — the members'
 * bounding box, outset by GROUP_OUTSET on every side: top/height carry it in px, and the
 * two gutters are NEGATIVE so the render's one box() rule widens the frame past the
 * tiles' own edges; a group with no placeable member is dropped.
 * `overflow`: the content is taller than AREA (the render draws the fade).
 */
export function layoutPreviewModel(definition) {
  const def = definition && typeof definition === 'object' ? definition : {};
  const items = [];
  for (const [id, t] of Object.entries(def.flow || {})) {
    if (okTile(t)) items.push({ id, flow: true, kind: 'flow', x: t.x, y: t.y, w: t.w });
  }
  const widgets = Array.isArray(def.widgets) ? def.widgets : [];
  widgets.forEach((m, i) => {
    const t = m && m.tile;
    if (okTile(t)) items.push({ id: `w${i}`, index: i, flow: false, kind: tileKind(m.definition), x: t.x, y: t.y, w: t.w });
  });

  const rows = items.reduce((mx, t) => Math.max(mx, t.y), -1) + 1;
  const rowH = new Array(rows).fill(0);
  for (const t of items) rowH[t.y] = Math.max(rowH[t.y], ROW_H[t.kind] || ROW_H.box);
  const rowTop = new Array(rows).fill(0);
  let y = 0;
  for (let r = 0; r < rows; r++) {
    rowTop[r] = y;
    if (rowH[r] > 0) y += rowH[r] + ROW_GAP;
  }
  const contentHeight = y > 0 ? y - ROW_GAP : 0;

  const clampW = (x, w) => Math.max(0, Math.min(12, x + w)) - Math.max(0, x);
  const pct = (n) => (n / 12) * 100;
  const tiles = [];
  for (const t of items) {
    if (rowTop[t.y] >= AREA) continue;
    const x = Math.max(0, t.x);
    const w = clampW(t.x, t.w);
    if (w <= 0) continue;
    tiles.push({
      id: t.id, index: t.index, flow: t.flow, kind: t.kind,
      left: pct(x), width: pct(w),
      gutterLeft: x > 0 ? GUTTER / 2 : 0,
      gutterRight: x + w < 12 ? GUTTER / 2 : 0,
      top: rowTop[t.y], height: rowH[t.y],
    });
  }

  const groups = [];
  for (const g of Array.isArray(def.groups) ? def.groups : []) {
    const members = (g && Array.isArray(g.members) ? g.members : [])
      .map((ix) => widgets[ix] && widgets[ix].tile)
      .filter(okTile);
    if (!members.length) continue;
    let x1 = 12; let x2 = 0; let y1 = Infinity; let y2 = -Infinity;
    for (const t of members) {
      x1 = Math.min(x1, Math.max(0, t.x));
      x2 = Math.max(x2, Math.min(12, t.x + t.w));
      y1 = Math.min(y1, t.y); y2 = Math.max(y2, t.y);
    }
    if (x2 <= x1 || rowTop[y1] >= AREA) continue;
    const bottom = rowTop[y2] + rowH[y2];
    groups.push({
      bg: g.bg, left: pct(x1), width: pct(x2 - x1),
      gutterLeft: -GROUP_OUTSET, gutterRight: -GROUP_OUTSET,
      top: rowTop[y1] - GROUP_OUTSET, height: bottom - rowTop[y1] + GROUP_OUTSET * 2,
    });
  }

  return { tiles, groups, overflow: contentHeight > AREA };
}
