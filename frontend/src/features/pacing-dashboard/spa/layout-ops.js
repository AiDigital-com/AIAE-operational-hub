// workspace/src/lib/dashboard/layout-ops.js
//
// buildLayoutEntry — a whole arrangement becomes a `layout` library entry
// (widget-library spec 2026-08-14 §3.1/§6.4, phase 4 T8). The block half lives
// in group-ops.js (buildBlockEntry); this is its own module because a layout
// snapshots THREE things a group never carries: the functional blocks' flow
// geometry, every widget instance on the pacing, and the groups re-keyed by
// INDEX — a `g_`/`w_` id is per-pacing, and the materializer mints fresh ones
// at Apply (§3.4, T9).
//
// Every member is a snapshot of the resolved canonical Widget. Standard entries are
// templates, not identities that survive into a shared Layout.
import { stripForShare, UNTITLED_HEADING } from './library-refs.js';

export { materializeLayout } from '../vendor/layout-materialize.mjs';

/**
 * @param {object} display   the store's display — widgets order and groups
 * @param {object} tiles     the SESSION tile map. The Share button is gated on
 *                           !dirty, so session geometry ≡ persisted geometry —
 *                           what the team gets is what the author sees saved.
 * @param {Map} resolved     resolveWidgetMap — values carry {state, ref, widget}
 * @param {string[]} flowIds the functional-block ids (the grid registry)
 * @returns {{kind: 'layout', definition: object}} — name/description are the
 *          share dialog's to merge (the validator requires a non-empty name)
 */
export function buildLayoutEntry(display, tiles, resolved, flowIds) {
  // Flow geometry for every functional id the arrangement actually places —
  // the server drops unknown ids on ITS side (the enabled{} rule); this side
  // simply has nothing to say about a block with no tile.
  const flow = {};
  for (const id of flowIds || []) {
    if (tiles[id]) flow[id] = tiles[id];
  }
  const widgets = [];
  const indexById = new Map();
  for (const w of display?.widgets || []) {
    const t = tiles[w.id];
    if (!t) continue; // deleted mid-session — no tile, nothing to place
    const definition = stripForShare(resolved.get(w.id)?.widget || w);
    // A share must not store a render-time fallback as an author-chosen name.
    if (definition.title === UNTITLED_HEADING) definition.title = '';
    const member = { definition, tile: t };
    indexById.set(w.id, widgets.length);
    widgets.push(member);
  }
  // Groups ride as indices into the emitted widgets array. Dead members drop;
  // a group with nothing left drops whole — the same answer sweepGroups gives.
  const groups = (display?.groups || [])
    .map((g) => {
      const members = (g.tileIds || [])
        .filter((id) => indexById.has(id))
        .map((id) => indexById.get(id));
      if (!members.length) return null;
      const out = { bg: g.bg, members };
      if (g.title) out.title = g.title;
      // bg 'none' rode above as-is; the hidden-name state travels sparsely,
      // in the validator's own key order (owner 2026-08-16, = buildBlockEntry).
      if (g.hideTitle === true) out.hideTitle = true;
      return out;
    })
    .filter(Boolean);
  return { kind: 'layout', definition: { flow, widgets, groups } };
}
