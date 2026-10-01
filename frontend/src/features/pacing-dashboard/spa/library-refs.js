// workspace/src/lib/dashboard/library-refs.js
//
// The workspace's door onto @shared/lib-refs (widget-library spec §3.3). Nothing
// in the app imports the UMD directly — this file is the one place the client
// reads library links from, exactly as display-blocks.js is for display.enabled.
//
// Everything here is re-exported, not re-implemented: the server validates the
// same shapes with the same module, and a second definition of "what a linked
// instance looks like" is how a save stores something the dashboard cannot draw.
import LibRefs from '@shared/lib-refs';

export const {
  normRef, isUserKey, usageRefs, stripForShare, hasPacingPins,
  resolveInstance, resolveWidgets, detachInstance, relinkInstance,
} = LibRefs;

/**
 * The refusals. One situation — the tile's library entry does not resolve — said
 * the same way wherever it is hit: the gallery card's ⋯, the dashboard tile's ⋯
 * and the edit door. They were two near-identical sentences before ("cannot be
 * detached" on the tile, "cannot be detached from it" on the card), which is a
 * user reading two error messages for one thing.
 *
 * Every one of these is a belt to a brace: the menus already hide an action whose
 * entry is gone, and these fire only when the entry disappears between the render
 * and the click.
 */
export const ENTRY_GONE = {
  detach: 'That library entry is unavailable, so this tile cannot be detached.',
  reset: 'That library entry is unavailable, so this tile cannot be reset to it.',
  edit: 'That library entry is unavailable, so this tile cannot be edited.',
  // Push is the odd one out on purpose: it is the only one that fails on the
  // ENTRY's account rather than the tile's — the tile is fine, there is simply
  // nothing left to write to.
  push: 'That library entry is unavailable, so there is nothing to push to.',
};

/**
 * The confirmations — the other half of the same vocabulary. Detach and Reset are
 * offered on BOTH surfaces (the gallery card's ⋯ and the dashboard tile's ⋯), and
 * they said it two ways: "this tile is now a private copy." on one, "this tile is
 * a private copy now" on the other. One act, one sentence, wherever it is done.
 *
 * The pending words ("Detaching…") stay in DashGrid: only the cas lane has a
 * pending state — a draft edit lands instantly and has nothing to say meanwhile.
 */
export const LINK_DONE = {
  detached: 'Detached: this tile is a private copy now.',
  reset: 'Reset: this tile follows the library entry again.',
};

/**
 * The badge a gallery card wears (spec §6.1: `linked` or `edited`). Returned as a
 * label + a title, so the two surfaces that show it (the card and, in Task 9, the
 * tile menu's header) cannot word it differently.
 * `plain` and `missing` get no badge — a hand-made widget has no library story,
 * and a broken ref explains itself inside the tile.
 *
 * `entry` is the resolution's provenance entry (phase 4, T8): `from` may now
 * point at a BLOCK entry — a block Add mints inline copies with block
 * provenance (§3.4) — and that copy is not "Edited": it never followed a widget
 * entry it could drift from, so non-widget provenance shows nothing. No entry
 * at all keeps the phase-2 answer: the tile's story exists, the row is just
 * unreadable right now, and the badge is about the story, not the row's health.
 */
export function linkBadge(state, entry) {
  if (state === 'edited' && entry && entry.kind !== 'widget') return null;
  if (state === 'linked') return { label: 'Linked', title: 'Follows a library entry; the author’s updates arrive automatically.' };
  if (state === 'edited') return { label: 'Edited', title: 'A private copy. It no longer follows the library entry it came from.' };
  return null;
}

/**
 * THE heading a tile wears — one chain, every label site (tile title, aria-labels,
 * menu labels, confirm messages, toasts).
 *
 * `detachInstance` materializes a `title` only when the user actually renamed the
 * tile (§1a.2 — the entry's own name is not an instance override, and baking it in
 * would hand back a permanent override on Reset). So a detached copy usually has
 * NO title at all, and a heading read straight off `widget.title` would call a
 * perfectly good tile "Untitled widget". State 'edited' still carries its `entry`
 * precisely because provenance keeps resolving — that is where the name comes from.
 *
 * Returns '' when nothing anywhere knows the name; the CALLER picks the words for
 * that case ("Untitled widget" on a live tile, "Unavailable widget" on a broken
 * ref), because the two read differently to a reader.
 *
 * @param {object|null} r a resolution from resolveInstance / resolveWidgets
 * @param {object|null} instance the raw instance, for the `missing` case where
 *   there is no resolved widget and no entry — only what the tile was renamed to.
 */
export function headingOf(r, instance) {
  return r?.widget?.title
    || r?.entry?.definition?.title
    || r?.entry?.name
    || instance?.title
    || '';
}

/**
 * The heading WITH the words for the nameless cases — what a tile is called on
 * screen, in its ⋯ menu's aria-label, in the toast that confirms an action on it
 * and in the confirmation that deletes it. One function because those four are the
 * same tile: a frame headed "Unavailable widget" whose menu says "Untitled widget"
 * is two names for one thing on one screen.
 * Callers that fall back to something better than words (Layout mode names a tile
 * by its id) read `headingOf` directly instead.
 *
 * The nameless-but-live words are a named constant because the share BUILDERS
 * (buildBlockEntry / buildLayoutEntry) must recognize them: resolveWidgetMap
 * bakes this exact string onto an untitled widget, and a share that stored it
 * would turn a render-time fallback into an author-chosen name.
 */
export const UNTITLED_HEADING = 'Untitled widget';
export function tileTitle(r, instance) {
  return headingOf(r, instance)
    || (r?.state === 'missing' ? 'Unavailable widget' : UNTITLED_HEADING);
}

/**
 * The Display gallery's two widget sections (post-release UX round, 2026-08-16):
 * a tile that FOLLOWS a library entry untouched — state 'linked', `std:` and
 * user entries alike — sits under "From library"; everything else (edited
 * copies, hand-made widgets, broken refs) is "Custom". The split is DERIVED
 * from the resolution, so the moves the owner asked for fall out of state
 * changes on the next render: editing a linked tile detaches it and the card
 * drops below the divider; "Reset to library" re-links it and the card moves
 * back up. Order inside each half is the widgets' own — today's card order.
 *
 * @param {Array} widgets  the instance list (the drawer's DRAFT — the list the
 *   cards render from)
 * @param {Map} resolved   instance id → resolution (useResolvedWidgets)
 */
export function splitByLibraryState(widgets, resolved) {
  const linked = [];
  const custom = [];
  for (const w of widgets || []) {
    (resolved?.get(w.id)?.state === 'linked' ? linked : custom).push(w);
  }
  return { linked, custom };
}

/**
 * Every instance resolved, as a Map keyed by INSTANCE id (that is what the layout,
 * the ranges and enabled{} are keyed by). Pure — `useResolvedWidgets` is nothing
 * but a memo around this call.
 *
 * It also materializes the heading for the one shape that needs it: a detached
 * copy carries no `title` of its own (§1a.2), and the tile renderers read
 * `widget.title` — so without this a perfectly good tile would be headed
 * "Untitled widget". It happens HERE, inside the memoized build, and not at
 * render: the canonical View model is memoized on the Widget OBJECT, and minting
 * a titled copy per render would rebuild it on every unrelated re-render.
 *
 * A widget that already has a title is passed through UNTOUCHED — same object,
 * same identity — so a pacing that never touched the Library resolves to exactly
 * what it stores. The copies are shallow and READ-ONLY: they share the entry's
 * nested arrays with the store's map, and nothing may write through them.
 */
export function resolveWidgetMap(widgets, entries) {
  const map = new Map();
  for (const r of resolveWidgets(widgets, entries)) {
    map.set(r.id, (r.widget && !r.widget.title)
      ? { ...r, widget: { ...r.widget, title: tileTitle(r, r.widget) } }
      : r);
  }
  return map;
}
