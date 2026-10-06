// workspace/src/lib/settings/display-norm.js
// Display-tab dirty-detection fingerprint + deep clone, extracted from DisplayTab.jsx
// so host tests import plain .js (same pattern as settings-norm.js — Slice 5 rule:
// no .jsx imports in tests). DisplayTab re-exports both for its consumers.

import { isDefault as lineItemsIsDefault, normLineItems } from '../dashboard/line-item-columns.js';

/** `display.lineItems` for the fingerprint (Line Items settings spec 2026-10-01): absent,
 *  null and the default object are ONE setting (today's render), so none of them can dirty
 *  the drawer against the other; any other readable value serialises in canonical key
 *  order; an unreadable one as itself. */
function normLineItemsKey(v) {
  if (lineItemsIsDefault(v)) return null;
  const r = normLineItems(v);
  return r.ok ? r.value : v;
}

/** Canonical serialization for dirty comparison. `rev` (optimistic-lock bookkeeping),
 *  `projectionModes` (per-viewer prefs saved through their own path), `enabled` (the block
 *  on/off map — spec 2026-08-14 §4: it travels alone through the merge lane and is
 *  never part of the drawer's Save) and `autoAdded` (the one-shot memory the LOAD-time
 *  hook owns — fingerprinting it would open the drawer dirty on every pacing whose rate
 *  type just changed) are EXCLUDED; the widget customization keys (2026-07-12) are
 *  fingerprinted deep + order-stable. `groups` and `layoutFrom` (phase 4 arrangement
 *  state) are EXCLUDED too: the drawer neither edits nor sends them — they ride the
 *  display-cas lane from Layout mode and the Library, and fingerprinting them would
 *  open the drawer dirty after every group save made behind it.
 *
 *  `kpis`, `charts`, `hero` and `sections` are gone from here because they are gone
 *  from the model (spec §9, phase 3): each is a display.widgets[] instance now. */
export function normDisplay(d) {
  return JSON.stringify([
    Object.keys(d.liNames || {}).sort().map((k) => [k, d.liNames[k] || '']),
    !!d.showDescription,
    // The Line Items block's settings (spec 2026-10-01): drawer draft content.
    normLineItemsKey(d.lineItems),
    // Widget defs: array order matters only as identity — fingerprint by sorted id
    // with the full def serialized (any content change flips the fingerprint).
    (d.widgets || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1)),
    // Layout: tiles keyed map serialized with sorted keys; null stays distinct from {}.
    d.layout
      ? Object.keys(d.layout.tiles || {}).sort().map((k) => [k, d.layout.tiles[k]])
      : null,
    Object.keys(d.widgetRanges || {}).sort().map((k) => [k, d.widgetRanges[k]]),
  ]);
}

/** Deep-clone a display config object (widget defs / layout / ranges included).
 *  There is no `rev` here by construction: the optimistic-lock stamp lives OUTSIDE
 *  the display object, in `dashboardStore.displayRev` (2026-07-28) — see the comment
 *  on INITIAL.displayRev for the 409 this shape prevents. */
export function cloneDisplay(d) {
  return {
    liNames:         { ...(d.liNames || {}) },
    showDescription: !!d.showDescription,
    // Deep-cloned when present; null (a pending reset) and absent are kept apart, because
    // buildConfig sends null and omits absent.
    lineItems:       d.lineItems && typeof d.lineItems === 'object' ? structuredClone(d.lineItems) : (d.lineItems === null ? null : undefined),
    projectionModes: structuredClone(d.projectionModes || {}),
    // enabled{} is view state, not draft content: the clone carries it so a
    // restore-on-discard cannot DELETE the map, while normDisplay above ignores
    // it so flipping a switch never marks the drawer dirty.
    enabled:         { ...(d.enabled || {}) },
    // autoAdded[] is carried for exactly the same reason, and it matters more: it is
    // the ONLY thing stopping a chart the user deleted from being auto-added again on
    // the next load. A discard-restore that dropped it would re-open that door.
    autoAdded:       [...(d.autoAdded || [])],
    widgets:         (d.widgets || []).map((w) => structuredClone(w)),
    layout:          d.layout ? structuredClone(d.layout) : null,
    widgetRanges:    { ...(d.widgetRanges || {}) },
    // groups[] + layoutFrom are carried for the same reason `enabled{}` is: the
    // drawer's live-preview push and its discard-restore both write this clone
    // into the store, and a clone that dropped them would blank every frame on
    // screen while the drawer is open. normDisplay above ignores both — the
    // drawer neither edits nor sends them (Layout mode's cas save does).
    groups:          (d.groups || []).map((g) => structuredClone(g)),
    layoutFrom:      d.layoutFrom ?? null,
  };
}
