// workspace/src/lib/dashboard/widget-ops.js
//
// The pure widget-SET edits, shared by the surfaces that make them: the Display
// tab's gallery (which folds them into the drawer's draft), a dashboard tile's ⋯
// menu (which saves them immediately under the display optimistic lock) and, from
// phase 2, the Library screen. They were written twice, and the copies had already
// drifted — only one of them checked the new id for a collision, and only one of
// them swept the layout slot. The widget CAP had drifted the same way, in two
// components, which is why it lives here now too.
//
// UUID identity comes through the library-refs door. Standard template identity comes
// through the exact catalog door; an arbitrary non-UUID key must never be treated as a
// template merely because it is not a user key.
import { newWidgetId } from '../vendor/layout-materialize.mjs';
import { isUserKey } from './library-refs.js';
import { isStdKey, stdEntry } from './std-catalog.js';
// The group sweep comes through the group-ops door, not from a second copy of the
// rule: the server runs the SAME sweepGroups in its dead-member sweep (db.mjs),
// and two definitions of "which members survive a delete" is how the UI and the
// stored row stop agreeing.
import { sweepGroups } from './group-ops.js';

/**
 * The widget cap, in ONE place. It was three copies — the gallery's "+ Add
 * widget", the tile menu's Duplicate, and now the Library's Add — of a number the
 * SERVER enforces (widgets-validate LIMITS.widgets). A client copy that drifts
 * high turns a click into a rejected save of everything else on the drawer.
 *
 * Raised 40 → 100 with the server's LIMITS.widgets for the canonical cutover; the
 * 400 KB display budget remains the binding protection.
 */
export const WIDGET_CAP = 100;

/**
 * What a widget KIND is called on screen. `composite` was called "block" until
 * the post-release UX round (2026-08-16): phase 4 made "block" the LIBRARY
 * kind — a shared group of tiles — so one word named two different things
 * across one drawer. The owner resolved the collision by calling the widget
 * kind by its stored word: the pick card, the kind pills and the tile badge all
 * say "composite" now, and BLOCK belongs to the library entries alone.
 *
 * Here rather than in any component because every surface has to answer the
 * same way, and a second copy is how they stop.
 */
const KIND_WORD = { __proto__: null, composite: 'composite' };
export function kindLabel(kind) {
  if (typeof kind !== 'string') return '';
  return Object.prototype.hasOwnProperty.call(KIND_WORD, kind) ? KIND_WORD[kind] : kind;
}

/** A widget id no tile on this pacing is using. Random, so a collision is
 *  vanishingly unlikely — and would silently merge two tiles into one, which is
 *  why it is checked rather than assumed. */
export { newWidgetId } from '../vendor/layout-materialize.mjs';

/**
 * A copy of `widget` fit to live beside it: a fresh id, the gallery's "(copy)"
 * title clipped to the server's 80-char cap (no silent truncation later), and NO
 * provenance. Every definition is already canonical and editable.
 *
 * CALLER CONTRACT: pass what the tile DRAWS, not a bare library ref — a linked
 * instance carries no definition of its own, and the copy loses `lib` below, so
 * copying the ref would produce a widget with nothing in it. Both call sites
 * hand over `{ ...(resolved?.widget || instance), title }`.
 *
 * @param {object} widget the widget to copy
 * @param {Iterable<string>} usedIds ids already taken on this pacing.
 */
export function copyWidget(widget, usedIds) {
  const copy = structuredClone(widget);
  copy.id = newWidgetId(usedIds);
  copy.title = `${widget.title} (copy)`.slice(0, 80);
  // A copy is a private widget, not a second linked tile: the link and the
  // provenance both go, so editing it can never surprise the original's author
  // and usage does not count the same entry twice on one pacing.
  delete copy.lib;
  delete copy.from;
  return copy;
}

/**
 * Add a library entry to a pacing. User Library entries stay linked so later author
 * updates arrive. Standard entries are templates: they materialize as private inline
 * canonical Widgets and retain no template identity.
 *
 * The key decides the operation: a UUID names a user Library row and stays linked;
 * an exact current `std:v2:*` key materializes the catalog's own definition inline.
 * Every other key is refused rather than silently becoming an untrusted template.
 * `profile` is denormalized for composites for the same reason `kind` is (§3.3) — the
 * grid sizes the tile before the entry is resolved, and without it a linked hero
 * renders as a 3-column card for a frame and then reflows the page.
 *
 * @param {object} entry a user Library row or a Standard catalog entry
 * @param {Iterable<string>} usedIds ids already taken on this pacing
 * @param {string} [id] a caller-chosen id — the migration's deterministic one (§9),
 *   which is what makes it idempotent. Every other caller passes two arguments.
 */
export function libraryInstance(entry, usedIds, id) {
  const key = entry?.key || entry?.id;
  const standard = isStdKey(key) ? stdEntry(key) : null;
  if (!isUserKey(key) && !standard) throw new Error('library entry key is neither a user UUID nor a Standard template');
  const def = standard?.definition || entry?.definition || {};
  if (def.kind !== 'composite' || def.schemaVersion !== 2
      || !def.profile || !['delivery', 'deliveryCm360'].includes(def.datasetType)) {
    throw new Error('library entry is not a canonical Widget');
  }
  const instanceId = id || newWidgetId(usedIds);
  if (isUserKey(key)) {
    return {
      id: instanceId,
      kind: 'composite',
      lib: { src: 'user', key },
      profile: def.profile,
      schemaVersion: 2,
      datasetType: def.datasetType,
    };
  }
  const out = { id: instanceId, ...structuredClone(def) };
  delete out.lib;
  delete out.from;
  return out;
}

/**
 * Rename an instance (spec §1a.2: renaming NEVER detaches). The title is
 * per-instance view state — for a linked tile it is an override on top of the
 * entry's name, for any other it is the widget's own title. Deliberately the only
 * writer that touches `title` without going through the editor, because the editor
 * rewrites the whole definition and that IS a detach.
 * An empty name clears the override rather than storing '': the tile then shows
 * the entry's name again, which is the only way back.
 */
export function renameWidget(widget, title) {
  const next = { ...widget };
  const t = String(title ?? '').trim().slice(0, 80);
  if (t) next.title = t; else delete next.title;
  return next;
}

/**
 * The four display keys a deleted widget lives in — the definition, its per-tile
 * period preference, its saved layout slot, and its group membership (phase 4).
 * Miss any of the last three and the tile's geometry haunts the grid, its range
 * entry rides every later save, or its frame keeps a ghost member.
 *
 * `enabled` is deliberately NOT here: a client never sends that map in a
 * widget-set patch (spec 2026-08-14 §4). The server sweeps the dead entry itself,
 * on the one save that can prove the widget is gone (db.mjs, dead-widget GC).
 * `groups` IS here even though the server sweeps it too: the group sweep is the
 * same shared rule on both sides (sweepGroups), so sending the swept list keeps
 * the UI consistent the moment the tile goes — the server's own sweep stays the
 * authority on what is stored.
 *
 * Returns only the changed keys, so a caller can spread it onto a draft or send it
 * as a patch. `layout` normalizes an absent layout to null — the same shape
 * cloneDisplay gives the drawer's draft.
 */
export function withWidgetRemoved(display, id) {
  const widgets = (Array.isArray(display?.widgets) ? display.widgets : []).filter((w) => w?.id !== id);
  const widgetRanges = { ...(display?.widgetRanges || {}) };
  delete widgetRanges[id];
  const projectionModes = structuredClone(display?.projectionModes || {});
  delete projectionModes[id];
  const layout = display?.layout
    ? {
      ...display.layout,
      tiles: Object.fromEntries(Object.entries(display.layout.tiles || {}).filter(([k]) => k !== id)),
    }
    : null;
  const groups = sweepGroups(display?.groups || [], widgets.map((w) => w && w.id).filter(Boolean));
  return { widgets, widgetRanges, projectionModes, layout, groups };
}
