// Block-library read helpers (spec §2.2). ONE visibility rule for every tile on the
// dashboard — `switchedOn` below — and the two questions built on it.
//
// `effectiveHero` and `sectionShown` lived here and are RETIRED (phase 3, spec §9):
// display.hero and display.sections no longer exist. The hero is a widget instance
// linked to std:hero-standard / std:hero-verdict (or simply absent), Finance is one
// linked to std:finance, and both are switched through enabled{} like everything else.

import DashBlocks from '@shared/dash-blocks';

// Nothing in the workspace imports the UMD directly — this file stays the ONE
// place the app reads block visibility from (spec §4/§5). The gallery's two
// pieces are re-exported; the raw read primitives stay private behind
// `switchedOn` below, so there is exactly one visibility rule to import.
export const { FUNCTIONAL_BLOCK_IDS, enabledPatch, FLOW_SLOTS } = DashBlocks;
const { isEnabledKey, tileEnabled } = DashBlocks;

/**
 * The Settings drawer's draft does not own `enabled` (spec 2026-08-14 §4: a switch
 * saves alone, immediately, through the merge lane). Three places push the WHOLE
 * display object from that draft into the store — the debounced live preview,
 * Reset, and the discard-on-close restore — and each carries the map as it was
 * when the drawer OPENED. Without this, flipping a switch in the gallery and then
 * typing one character in the drawer un-flipped it on screen until reload.
 * Everything from the draft, `enabled` from the live store.
 *
 * Both spreads are fresh objects on purpose: the store's saveSettings copies
 * INITIAL's `enabled` reference when a response lacks the key, so mutating a map
 * in place would bleed across pacings.
 *
 * `groups` + `layoutFrom` (phase 4) deliberately get NO such live-read: no groups
 * writer runs behind an open drawer. Verified against the wiring (phase-4 T5):
 * the drawer itself never edits or sends them (SettingsDrawer buildConfig omits
 * both), gallery switches travel the enabled{} lane alone, DashGrid's widget-set
 * writes are disabled while the drawer is open (setWritesBlocked), and Layout
 * mode — which stays MOUNTED under a drawer opened via its "+ Add"
 * (DashboardView keeps both up; they are NOT mutually exclusive states) — has no
 * pointer path to its {layout, groups} Save: the drawer's full-viewport .settings-overlay
 * (fixed, inset 0, z-index 99, pointer-events:auto) covers the hint bar (z 40),
 * so a click aimed at "Save layout" closes the drawer instead, and Layout mode's
 * Esc ladder never saves. (Keyboard focus can still tab behind the overlay — the
 * exposure the layout half of that save always had; even then the drawer never
 * SENDS groups, so a draft push can only shadow the frames on screen until the
 * next server adoption, never roll them back in PG.) The Library's block-Add /
 * layout-Apply DO write groups from inside the drawer — rebasing what the drawer
 * holds is those call sites' concern, not this helper's.
 */
export function preserveEnabled(draft, live) {
  // `autoAdded` rides the same way: the one-shot receipts are never drawer content, and a
  // draft cloned at open time would otherwise rewind a receipt the auto-add wrote meanwhile
  // (sections cutover 2026-09-07) — the deleted tile would then come back on the next save.
  return {
    ...(draft || {}),
    enabled: { ...((live && live.enabled) || {}) },
    autoAdded: [...((live && Array.isArray(live.autoAdded)) ? live.autoAdded : [])],
  };
}

/**
 * THE visibility rule — view mode (DashGrid via dropDisabled) and Layout mode's
 * entry split read this and nothing else, so they cannot drift.
 *
 * It is the read-side half of the server's key-domain rule: `enabled{}` only
 * speaks for the ids it may CARRY — the 4 functional blocks and `w_` widget
 * instances (`isEnabledKey`). widgets-validate.mjs and the merge lane REFUSE
 * anything else on save; an invalid key is inert on read and has no renderer.
 */
export function switchedOn(display, id) {
  return !isEnabledKey(id) || tileEnabled(display, id);
}

/**
 * Does this id get an on/off control at all? `enabled{}` only speaks for the ids it
 * may CARRY — the 4 functional blocks and `w_` widget instances. This boolean probe
 * reads the domain predicate directly; `enabledPatch` is the asserting write helper
 * and deliberately throws for anything else. Every visible tile is either a
 * functional block or a `w_` Widget instance, so every tile has one.
 */
export function hasSwitch(id) {
  return isEnabledKey(id);
}

/** View-mode filter (spec §5): drop tiles the user switched off. Layout mode does not
 *  call this — it asks `switchedOn` once, at entry, and PARKS the off tiles
 *  (splitSwitchedOff) so their geometry survives the session (spec 2026-09-03). */
export function dropDisabled(entries, display) {
  return entries.filter((e) => switchedOn(display, e.id));
}

/**
 * Everything below the filter bar switched off (spec §5) — the quiet empty sheet.
 * This is ONE question asked twice: the 4 functional blocks, and every Widget instance
 * on the pacing.
 *
 * Deliberately NOT a check on what rendered: a dashboard whose tiles draw nothing for
 * lack of data has always been a normal, partially-empty dashboard. This state is
 * "the user turned everything off", and only that.
 */
export function allBlocksOff(display) {
  if (!display) return false;
  if (FUNCTIONAL_BLOCK_IDS.some((id) => switchedOn(display, id))) return false;
  // Array-guarded like every other reader: the store's display can be
  // drawer-draft-shaped, and a malformed key must not take the whole render down
  // with a TypeError.
  const widgets = Array.isArray(display.widgets) ? display.widgets : [];
  return widgets.every((w) => !switchedOn(display, w?.id));
}
