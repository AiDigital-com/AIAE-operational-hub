/**
 * The widget-TILE rules, in one place: which ids exist, which tiles are switched on, and how a tile
 * is copied or removed.
 *
 * Everything here that Pacing also runs comes from `../vendor/dash-blocks.js` — the byte-identical
 * copy of `AIAE-paicing/shared/dash-blocks.js` (see `../vendor/SOURCE.md`) — rather than being
 * re-typed. Before this module there were three hand-written restatements of that file living in
 * `pacing-dashboard-library.tsx`: `newWidgetId`'s copy of `WIDGET_INSTANCE_RE`, `newGroupId`'s copy
 * of `GROUP_ID_RE`, and `removeWidget`'s copy of `sweepGroups`. Each was correct when written and
 * each would have gone quietly wrong the day Pacing changed its side, because nothing compares them.
 *
 * `WIDGET_CAP`, `newWidgetId` and `copyWidget` were hand-ports of Pacing's `widget-ops.js` while
 * that file lived only in the retired SPA. It now lives here too, under `../spa/`, so they are
 * re-exported from it instead — a hand-port and its original in the same repository is a copy
 * waiting to drift.
 */
import { getDashBlocks, type DashBlocksGroup } from "../vendor/loader";
// Moved JS from Pacing's SPA — `allowJs` types it by inference (see ../spa/SOURCE.md).
import { WIDGET_CAP as SPA_WIDGET_CAP, copyWidget as spaCopyWidget, newWidgetId as spaNewWidgetId } from "../spa/widget-ops.js";
import type { PacingWidgetGroup, PacingWidgetInstance } from "../types";

const DashBlocks = getDashBlocks();

/**
 * The widget cap. The SERVER enforces it (`widgets-validate.mjs` `LIMITS.widgets`); a client copy
 * that drifts high turns a click into a rejected save of everything else in the drawer. The 400 KB
 * display budget remains the binding protection — this is the sanity rail.
 */
export const WIDGET_CAP: number = SPA_WIDGET_CAP;

/** `widgets-validate.mjs` `LIMITS.title`. A title over this is truncated server-side, so a copy's
 *  "(copy)" suffix is clipped here instead of silently disappearing after the save. */
export const TITLE_CAP = 80;

/** What a tile with no name of its own is called. One word for it, so the card, the board and a
 *  copy's minted title cannot disagree. */
export const UNTITLED_WIDGET = "Untitled widget";

/** The name a widget shows when there is nothing to resolve it against. */
export function widgetTitle(widget: Pick<PacingWidgetInstance, "title">): string {
  return widget.title?.trim() || UNTITLED_WIDGET;
}

/**
 * The name a TILE prints, in one place, so the card, the duplicate it mints and anything else that
 * needs a name cannot disagree.
 *
 * A linked instance's own `title` is an OVERRIDE on top of its library entry's name, not a copy of
 * it: renaming a linked tile never detaches it. So the instance wins where it has one, and the
 * resolved definition answers where it does not. Reading only the instance calls every unrenamed
 * linked tile "Untitled widget" even though its entry is perfectly well named; reading only the
 * resolution throws the user's own rename away.
 *
 * @param instance the stored `display.widgets[]` entry
 * @param drawn    what the tile actually draws (`resolveWidget`), or null when the entry is gone
 */
export function tileTitle(
  instance: Pick<PacingWidgetInstance, "title">,
  drawn: Pick<PacingWidgetInstance, "title"> | null
): string {
  return instance.title?.trim() || drawn?.title?.trim() || UNTITLED_WIDGET;
}

/**
 * The title an EDIT starts from - the same instance-over-definition precedence as `tileTitle`, but
 * for STORAGE rather than for display, which differs in two ways that both matter.
 *
 * It does not fall back to "Untitled widget": that string is a label for a widget with no name, and
 * writing it into the widget would turn it into the name. And it does not trim. The editor writes
 * through this on every keystroke, so a trim here deletes a trailing space the instant it is typed -
 * which is every space, at the moment you type it, making a multi-word title impossible to enter.
 *
 * `undefined` means "no title on either side"; an empty string means someone cleared it, and that is
 * kept rather than resolved back to the definition's name.
 */
export function editSeedTitle(
  instance: Pick<PacingWidgetInstance, "title">,
  drawn: Pick<PacingWidgetInstance, "title"> | null
): string | undefined {
  return instance.title ?? drawn?.title ?? undefined;
}

function randomSuffix(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/**
 * A widget id no tile on this pacing is using. Pacing's own minter, through the moved module, so the
 * id SHAPE comes from one place rather than from a regex retyped here.
 */
export function newWidgetId(usedIds: Iterable<string> = []): string {
  return spaNewWidgetId([...usedIds]) as string;
}

/** A group id, same rule as `newWidgetId`. */
export function newGroupId(usedIds: Iterable<string> = []): string {
  const used = new Set(usedIds);
  let id: string;
  do {
    id = `g_${randomSuffix(10)}`;
  } while (used.has(id));
  return id;
}

/** Does this id get an on/off control at all? `display.enabled` only speaks for the ids it may
 *  carry — the functional blocks and `w_` widget instances — and dash-gate refuses anything else on
 *  save rather than accepting it as a silent no-op. */
export function hasSwitch(id: string): boolean {
  return DashBlocks.isEnabledKey(id);
}

/**
 * THE visibility rule. Absent ≡ ON: only an explicit `false` hides a tile, so a pacing that has
 * never been switched shows everything, and the stored map stays the size of what someone actually
 * turned off.
 */
export function tileEnabled(display: { enabled?: unknown } | null | undefined, id: string): boolean {
  return DashBlocks.tileEnabled(display, id);
}

/**
 * The `display.enabled` map with one tile flipped.
 *
 * ON DELETES the key rather than storing `true` — the same sparseness `enabledPatch` expresses for
 * the per-entry lane. We build a whole map rather than a patch because the Hub saves `enabled`
 * inside the drawer's one full-display save, under its `displayRev` CAS, instead of the SPA's
 * instant per-entry lane (see `widgets-section.tsx` for why that difference is safe here).
 *
 * An id outside the domain is a caller bug and throws, exactly as `enabledPatch` does: pretending to
 * save a switch dash-gate would refuse is worse than failing here.
 */
export function setTileEnabled(
  enabled: Record<string, boolean> | undefined,
  id: string,
  on: boolean
): Record<string, boolean> {
  if (!hasSwitch(id)) throw new TypeError(`Cannot toggle unknown dashboard tile "${String(id)}"`);
  const next = { ...(enabled ?? {}) };
  if (on) delete next[id];
  else next[id] = false;
  return next;
}

/**
 * A copy of `widget` fit to live beside it: a fresh id, a "(copy)" title clipped to the server's cap,
 * and NO library link or provenance — a copy is a private widget, not a second linked tile, so
 * editing it can never surprise the original entry's author and usage does not count the same entry
 * twice on one pacing.
 *
 * Pacing's own `copyWidget`, not a re-implementation.
 *
 * CALLER CONTRACT: pass what the tile DRAWS. A linked instance carries no spec of its own — the
 * entry is the definition — so copying the ref would produce a widget with nothing in it.
 * `resolveWidget` answers that; this wrapper cannot.
 *
 * The title it CAN answer, and does: Pacing's own function builds `${widget.title} (copy)` and so
 * names a title-less widget "undefined (copy)". Every call site there hands it a widget with the
 * name the tile wears already filled in, so the case never arises; here the fallback is applied
 * instead of relied upon, because one forgetful caller is all it takes to store that string.
 */
export function copyWidget(
  widget: PacingWidgetInstance,
  usedIds: Iterable<string>
): PacingWidgetInstance {
  const named = widget.title?.trim() ? widget : { ...widget, title: widgetTitle(widget) };
  return spaCopyWidget(named, [...usedIds]) as PacingWidgetInstance;
}

/**
 * The display keys a deleted widget lives in: the definition, its group membership, and its on/off
 * entry.
 *
 * The SPA's twin (`widget-ops.js:withWidgetRemoved`) deliberately leaves `enabled` alone, because
 * its client never sends that map in a widget-set patch — dash-gate sweeps the dead entry itself on
 * the one save that can prove the widget is gone. That server sweep still runs for us, and stays the
 * authority on what is stored. We drop the entry here anyway because this client DOES carry the map
 * in its patch, so leaving it would show a stale off-switch in the drawer's own draft until the next
 * server adoption.
 *
 * Group membership goes through the vendored `sweepGroups` — the same rule dash-gate runs — so the
 * tile's frame cannot keep a ghost member, and the UI's answer to "which members survive a delete"
 * cannot differ from the stored row's.
 */
export function withWidgetRemoved(
  widgets: PacingWidgetInstance[],
  groups: PacingWidgetGroup[],
  enabled: Record<string, boolean> | undefined,
  id: string
): {
  widgets: PacingWidgetInstance[];
  groups: PacingWidgetGroup[];
  enabled: Record<string, boolean>;
} {
  const nextWidgets = widgets.filter((w) => w.id !== id);
  const nextEnabled = { ...(enabled ?? {}) };
  delete nextEnabled[id];
  const swept = DashBlocks.sweepGroups(
    groups,
    nextWidgets.map((w) => w.id)
  ) as DashBlocksGroup[];
  return { widgets: nextWidgets, groups: swept as PacingWidgetGroup[], enabled: nextEnabled };
}
