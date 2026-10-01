// workspace/src/lib/dashboard/group-ops.js
//
// The workspace's door onto the group half of @shared/dash-blocks (spec §4/§6.4)
// plus the pure group-list edits Layout mode makes. Nothing else in the app
// imports the group vocabulary directly — the display-blocks.js pattern.
import { newGroupId } from '../vendor/layout-materialize.mjs';
import DashBlocks from '@shared/dash-blocks';
import { selectionGroupable, groupBounds } from './layout-grid.js';
import { stripForShare, UNTITLED_HEADING } from './library-refs.js';
// The v2 door — the share gate asks it whether a member is a report widget (or a row
// past this build), and says the door's own sentence when one is (P2: authoring stays
// off).
import { isFutureWidget, FUTURE_VERSION } from './report-v2.js';
// Import cycle with widget-ops (it reads sweepGroups through this door) — safe:
// both sides bind at call time, nothing runs the other's export at module eval.
import { newWidgetId } from './widget-ops.js';

export const { GROUP_TINTS, GROUP_BGS, GROUP_LIMITS, sweepGroups } = DashBlocks;
const { WIDGET_INSTANCE_RE } = DashBlocks;

export { newGroupId } from '../vendor/layout-materialize.mjs';

/** Every refusal is a sentence the hint bar can show as the disabled reason. */
export function canGroup(ids, tiles, groups) {
  const list = [...(ids || [])];
  if (list.length < 2) return { ok: false, reason: 'Select at least two widget tiles.' };
  if (list.some((id) => !WIDGET_INSTANCE_RE.test(id))) {
    return { ok: false, reason: 'Only widget tiles can be grouped; page sections stay on their own.' };
  }
  // The TILES cap, client-side: the server's normGroups refuses a bigger group
  // loudly (400), so the Group button must refuse politely first.
  if (list.length > GROUP_LIMITS.tiles) {
    return { ok: false, reason: `A group holds at most ${GROUP_LIMITS.tiles} tiles.` };
  }
  const grouped = new Set((groups || []).flatMap((g) => g.tileIds));
  if (list.some((id) => grouped.has(id))) {
    return { ok: false, reason: 'A tile can be in only one group; ungroup it first.' };
  }
  if ((groups || []).length >= GROUP_LIMITS.groups) {
    return { ok: false, reason: `Group cap reached (${GROUP_LIMITS.groups}).` };
  }
  const sel = selectionGroupable(tiles, list);
  if (!sel.ok) return { ok: false, reason: 'The selection must form a clean rectangle; another tile sits inside its bounds.' };
  return { ok: true, bounds: sel.bounds };
}

/** A fresh group over the selection, members in (y, x) order, default tint. */
export function makeGroup(ids, tiles, groups) {
  const sorted = [...ids].sort((a, b) => tiles[a].y - tiles[b].y || tiles[a].x - tiles[b].x);
  return { id: newGroupId(groups), tileIds: sorted, bg: GROUP_TINTS[0] };
}

export const ungroup = (groups, gid) => (groups || []).filter((g) => g.id !== gid);
// GROUP_BGS, not GROUP_TINTS: the seventh background 'none' (owner 2026-08-16)
// passes the same door the six tints do.
export const setGroupBg = (groups, gid, bg) => (groups || [])
  .map((g) => (g.id === gid && GROUP_BGS.includes(bg) ? { ...g, bg } : g));
export function renameGroup(groups, gid, title) {
  const t = String(title ?? '').trim().slice(0, GROUP_LIMITS.title);
  return (groups || []).map((g) => {
    if (g.id !== gid) return g;
    const next = { ...g };
    // Removing the title also drops hideTitle: a title-less group has nothing
    // to hide, and a title given LATER must not arrive pre-hidden for no
    // visible reason (review note, 2026-08-16).
    if (t) next.title = t; else { delete next.title; delete next.hideTitle; }
    return next;
  });
}
/** Hide-name-on-dashboard toggle (owner 2026-08-16), the renameGroup idiom:
 *  on stores hideTitle:true, off DELETES the key — the stored shape is sparse
 *  (normGroups drops hideTitle:false), so the op never writes what the server
 *  would strip. */
export function setGroupHideTitle(groups, gid, hide) {
  return (groups || []).map((g) => {
    if (g.id !== gid) return g;
    const next = { ...g };
    if (hide) next.hideTitle = true; else delete next.hideTitle;
    return next;
  });
}

/**
 * May this group be shared as a `block` entry? Null = yes; else the refusal
 * sentence for the Share item's title (the canGroup idiom). Shared by Layout
 * mode's group ⋯ and the Display tab's Groups section (post-release UX round,
 * 2026-08-16) — one gate, one wording, wherever the share is offered.
 * The ≥2 gate closes a real gap: normGroups accepts a 1-member group (the
 * sweep can legitimately leave one), but the block validator needs ≥2 — so the
 * client refuses politely instead of letting the server 400 it. And a member
 * whose entry is `missing` has nothing to snapshot — stripForShare over a null
 * widget would share {}.
 *
 * The last two refusals are P2's (widget-builder v2, Task 11): a block INLINES its
 * members' definitions, so a report inside the group is a v2 library write — which
 * the library lane refuses (§7.6) — and a member a NEWER build stored would be
 * refused there for its version. Either way the refusal becomes a reason on the
 * disabled item, before the click, instead of a toast after it. Asked of what the
 * tile DRAWS, because a linked v2 instance and the v2 entry behind it are the same
 * widget.
 */
export function blockShareBlocked(g, tiles, resolved) {
  const live = (g.tileIds || []).filter((id) => tiles[id]);
  if (live.length < 2) return 'A block needs at least two members';
  if (live.some((id) => resolved.get(id)?.state === 'missing')) {
    return 'A member’s library entry is unavailable; nothing to snapshot';
  }
  if (live.some((id) => isFutureWidget(resolved.get(id)?.widget))) return FUTURE_VERSION;
  return null;
}

/**
 * A group becomes a `block` library entry (spec §3.1/§6.4, phase 4 T8):
 * {kind, definition} only — the share dialog merges name/description into the
 * payload, because the validator requires a non-empty name and the builder has
 * none to offer. `resolved` is the resolveWidgetMap map — its values carry
 * {state, ref, widget}; every member snapshots the exact canonical definition the
 * tile draws. Geometry rides RELATIVE to the group's own
 * bounding box (dx/dy): absolute rows mean nothing on another pacing.
 */
export function buildBlockEntry(group, tiles, resolved) {
  const b = groupBounds(tiles, group.tileIds);
  const members = group.tileIds
    .filter((id) => tiles[id])
    .sort((p, q) => tiles[p].y - tiles[q].y || tiles[p].x - tiles[q].x)
    .map((id) => {
      const r = resolved.get(id);
      const t = tiles[id];
      const tile = { dx: t.x - b.x, dy: t.y - b.y, w: t.w };
      if (t.h != null) tile.h = t.h;
      // A shared Block is a snapshot, including a tile that originated from a Standard
      // template. It never carries a template link into another pacing.
      const definition = stripForShare(r?.widget);
      // resolveWidgetMap BAKES the render-time fallback heading onto an untitled
      // widget before this builder ever sees it — stored, that literal would read
      // as a name the author chose. '' is normWidget's canonical no-title
      // spelling (byte-stable through the validator). On the ADOPTER the copy is
      // NOT headed by the same words, though: it carries block `from`, resolves
      // 'edited' WITH the block entry, and headingOf then heads it from the
      // entry (its stored group title, else the block's name) rather than
      // "Untitled widget" — a render-time fallback either way, never a stored
      // title. (The layout builder's copies carry no `from`, so THERE the
      // same-words claim holds.) A USER-linked member's baked entry name stays:
      // the entry-name chain is severed by inlining, deliberately.
      if (definition.title === UNTITLED_HEADING) definition.title = '';
      return { definition, tile };
    });
  const definition = { bg: group.bg, members };
  if (group.title) definition.title = group.title;
  // Both owner additions (2026-08-16) ride the share: bg 'none' passes above
  // as-is, and the hidden-name state travels sparsely — key order matches the
  // validator's (bg, members, title, hideTitle), keeping the entry byte-stable.
  if (group.hideTitle === true) definition.hideTitle = true;
  return { kind: 'block', definition };
}

/**
 * materializeBlock(entry, display, curTiles) — fresh instances, a fresh group,
 * and the band's tiles (§6.2 Add, §1a.3 copy-on-add). `curTiles` is the CURRENT
 * placement as a tiles map: the caller resolves it FIRST (resolveLayout over the
 * live display — the same source DashGrid renders from) and passes the result.
 * NOT display.layout?.tiles: on a seed-null layout (the common case) that is
 * undefined, maxY would be -1 and the band would mint at y 0 — colliding with
 * the placement the user is looking at.
 */
export function materializeBlock(entry, display, curTiles) {
  const used = new Set((display.widgets || []).map((w) => w.id));
  const from = { src: 'user', key: entry.id };
  const widgets = [];
  const relTiles = [];
  for (const m of entry.definition.members) {
    // Every member is an inline canonical snapshot. The private copy carries Block
    // provenance, but never a Standard-template or nested Library link.
    const w = { id: newWidgetId(used), from, ...structuredClone(m.definition) };
    used.add(w.id);
    widgets.push(w);
    relTiles.push({ id: w.id, tile: m.tile });
  }
  // The band lands below everything currently placed — relative offsets
  // survive, columns clamp per member width.
  const maxY = Object.values(curTiles || {}).reduce((m2, t) => Math.max(m2, t.y), -1);
  const tiles = {};
  for (const { id, tile } of relTiles) {
    tiles[id] = { x: Math.min(12 - tile.w, tile.dx), y: maxY + 1 + tile.dy, w: tile.w, h: tile.h ?? null };
  }
  const group = { id: newGroupId(display.groups), tileIds: widgets.map((w) => w.id), bg: entry.definition.bg };
  if (entry.definition.title) group.title = entry.definition.title;
  // The adopter's group wears what the author set (owner 2026-08-16): a 'none'
  // bg already rode through `entry.definition.bg` above; the hidden-name state
  // materializes here.
  if (entry.definition.hideTitle === true) group.hideTitle = true;
  return { widgets, group, tiles };
}
