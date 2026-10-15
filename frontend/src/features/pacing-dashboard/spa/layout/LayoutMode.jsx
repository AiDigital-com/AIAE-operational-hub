// workspace/src/pages/Dashboard/components/Layout/LayoutMode.jsx
//
// Layout mode (spec 2026-07-12 §7 + widget-library phase 4 §6.4): ONE pointer
// gesture rearranges everything — flow blocks and sized tiles alike. Local tile
// AND group state edit on top of resolveLayout() / display.groups; Save persists
// ONLY {display: {layout, groups}, display_rev} in ONE cas save (per-key merge —
// concurrent widget/checkbox edits survive); Cancel restores the entry snapshot
// of both; Reset = seed semantics (widgets always survive, spec §1; groups are
// removed — the seed has none).
//
// Interaction contract (owner decisions 2026-09-23, docs/2026-09-23-layout-drag.md):
//   drag      pointer-down anywhere on a tile (content is inert under an overlay) ARMS a
//             drag; it starts after 5px (touch on a tile body: a 250ms hold). From then
//             until the drop the page is FROZEN: the tile follows the hand as itself (a
//             transform), or as a labelled bar when it is taller than 380px or a full-row
//             block; a dashed slot / a horizontal insert bar shows where it lands
//             (DragOverlay); nothing else moves except, while the hand rests, the one swap
//             partner. The drop commits exactly what the slot showed (layout-grid.js
//             applyTarget) and every moved tile glides to its new cell.
//   rules     drop on a tile → the two swap cells (x and width, each clamped to its own
//             limits); in a gap or on free columns → a fresh row / a free place, snapped to
//             nearby edges; nothing is ever pushed, row-mates never slide.
//   resize    corner grip; width snaps to columns, height to the kind's steps, both from
//             the pickup (a pickup changes nothing); a neighbour gives way inside the row;
//             a size chip shows "w6 · M · 220px" (" · max" when capped).
//   select    Ctrl/Cmd/Shift-click toggles a tile in the selection; a drag on the
//             grid BACKGROUND draws a lasso and selects what it crosses; the hint
//             bar's Group turns 2+ selected tiles into a frame (spec §6.4).
//   frame     a group renders as a derived mat behind its members with a legend
//             strip: the strip carries the whole set as one (the group targets in
//             layout-grid.js), arrows on its ≡ nudge it, its ⋯ renames / tints /
//             ungroups, clicking it selects the group (tile selection clears).
//   keyboard  the ≡ handle is focusable; arrows move one step by the same rules
//             (arrowStep: a key never changes a width), the opposite arrow right after
//             undoes it exactly; changes commit per keypress and glide.
//   Esc       active drag/resize → cancel it; else lasso → selection → Cancel
//             (confirm when dirty).
//   autoscroll within 96px of the visible edges (under the hint bar), ramping up over
//             300ms from the moment the pointer enters the band.
//   data-hidden flow tiles (LaunchPlan post-start, …) render as placeholder rows
//             so they can be positioned; view mode still renders nothing for them.
//   switched off (spec 2026-09-03) — a tile the user turned off is NOT here: it
//             takes no row, pushes nothing and cannot be picked up. Its place waits
//             in `parked`, named by the tiles it sat next to rather than by a row
//             number the next drag would invalidate (layout-grid.js), and Save writes
//             the arrangement back whole — so switching the tile on returns it to the
//             spot it remembers when that spot is free, and otherwise to a row of its own
//             right under it: nothing visible ever moves for it (owner 2026-09-23). A live tile
//             still wears an "On" chip (owner 2026-09-04: it was convenient): one click
//             turns it off and the tile leaves the grid; turning a tile back ON lives
//             in view mode's tile ⋯ and in Settings → Widgets, since it is not here.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useParams } from 'react-router-dom';
import ConfirmModal from '../ConfirmModal.jsx';
import { useDashboardStore } from '../store.js';
import { useDisplay, useStoreActions, useResolvedWidgets } from '../store.js';
import { headingOf } from '../library-refs.js';
import {
  resolveLayout, gcLayout, groupBounds, buildKeepIds, mergeNewTiles, mergeNewGroups, widgetGridKind,
  splitSwitchedOff, materializeParked, KIND_CONSTRAINTS, H_PX, rowStretchIds, resizeStepFor,
  // the move engine (owner decisions 2026-09-23): targets in, arrangements out
  HOME, GRID_GAP, isBandKind, clampW, targetKey, groupOf, dragContext, pointerStep,
  applyTarget, previewRects, arrowTarget, arrowStep, frameMover, resizeTo, gripMove,
  groupContext, groupPointerStep, applyGroupTarget, groupPreviewRects, groupArrowTarget,
} from '../layout-grid.js';
import {
  DRAG_THRESHOLD_PX, GRIP_THRESHOLD_PX, TOUCH_HOLD_MS, TOUCH_SLOP_PX, PARTNER_DWELL_MS,
  carryStyle, anchorFor, referencePoint, cardTranslate, barRect, autoscrollVelocity,
  edgeOfPointer, scrollStep, handResting, partnersShown, edgeHint, flipDeltas,
  resizeFromPointer, playFlip,
} from '../layout-motion.js';
import DragOverlay from './DragOverlay.jsx';
import { switchedOn, hasSwitch, enabledPatch } from '../display-blocks.js';
import { tileSlot } from '../tile-slots.js';
import {
  canGroup, makeGroup, sweepGroups, ungroup, setGroupBg, renameGroup, setGroupHideTitle,
  buildBlockEntry, blockShareBlocked, GROUP_TINTS, GROUP_LIMITS,
} from '../group-ops.js';
import ShareEntryDialog from '../display/ShareEntryDialog.jsx';
import { buildLayoutEntry } from '../layout-ops.js';
// The v2 door: the dispatch predicates every surface forks on, and the sentences it
// says for the things a report widget cannot do yet.
import { isFutureWidget, FUTURE_VERSION } from '../report-v2.js';
import { api } from '../store.js';
// ONE translator for both writes in this file: the layout Save and the share dialog
// prefer the server's own sentence when it sent one, because either can be refused over
// a widget the server names.
import { saveErrorDetailText } from '../save-error.js';
import { FLOW_REGISTRY } from '../tile-registry.jsx';
import TileMenu from '../ui/TileMenu.jsx';
import ReportWidget from '../report/ReportWidget.jsx';
import WidgetFrame, { WidgetNeedsNewerApp } from '../report/WidgetFrame.jsx';
import { toast } from '../ui/Toast.jsx';

const GRID_REGISTRY = FLOW_REGISTRY.map((e) => ({ id: e.id, kind: 'flow' }));
const FLOW_BY_ID = Object.fromEntries(FLOW_REGISTRY.map((e) => [e.id, e]));
// The functional blocks take no props and read the store themselves, so a render of this
// mode (a pickup, a drop) has no reason to re-render Line Items or the Journal: memo'd once.
const FLOW_MEMO = Object.fromEntries(FLOW_REGISTRY.map((e) => [e.id, memo(e.Component)]));
const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const EDGE_WORDS = { left: 'the left edge', right: 'the right edge', top: 'the top', bottom: 'the bottom' };
// After a touch drag has started, the page must not scroll under the finger: a non-passive
// listener is the only way to stop the browser taking the gesture over (and cancelling it).
const preventTouchScroll = (e) => { if (e.cancelable) e.preventDefault(); };
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// The four functional blocks and nothing else: `block1` (the hero) and `block2`
// (Finance) left the registry in phase 3, and Targets / 3rd Party Data / Breakdown /
// Daily Performance in the sections cutover — they are widget instances now, so their
// label comes from the resolved library entry like every other tile's.
const FLOW_TITLES = {
  launchPlan: 'Launch Plan',
  alerts: 'Alerts', lineItems: 'Line Items', journal: 'Journal',
};
const H_ORDER = { chart: ['S', 'M', 'L', 'XL'], table: ['L', 'XL', 'XXL'] };

function tilesEqual(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const x = a[k], y = b[k];
    if (!y || x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h) return false;
  }
  return true;
}

/** tilesEqual's sibling for the session's groups: id, member order, bg, title
 *  and the hide-name flag (owner 2026-08-16) are the five things a group edit
 *  can change (§6.4) — order-sensitive on both levels, because the list order
 *  IS the entry snapshot's order. */
function groupsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.id !== y.id || x.bg !== y.bg || (x.title || '') !== (y.title || '')) return false;
    if (!!x.hideTitle !== !!y.hideTitle) return false;
    if (x.tileIds.length !== y.tileIds.length) return false;
    for (let j = 0; j < x.tileIds.length; j++) {
      if (x.tileIds[j] !== y.tileIds[j]) return false;
    }
  }
  return true;
}

export default function LayoutMode({ onExit, onDirtyChange, editable = true, onOpenLibrary, onOpenSettings = null }) {
  const { slug } = useParams();
  const display = useDisplay();
  const { saveSettings, mergeLibraryEntries } = useStoreActions();
  // Only what a `visible()` predicate reads — `launchPlan`'s is the last one (DashGrid.jsx
  // carries the same pair for the same reason).
  const campaign = useDashboardStore((s) => s.campaign);
  const facts = useDashboardStore((s) => s.facts);

  const widgets = useMemo(() => display?.widgets || [], [display]);
  const widgetById = useMemo(() => Object.fromEntries(widgets.map((w) => [w.id, w])), [widgets]);
  // Library resolution (spec §3.3), keyed by INSTANCE id. It feeds RENDERING and
  // LABELS only — every geometry read below (kindOf, liveIds, buildKeepIds, the
  // GC) keeps reading the instance, because the arrangement is sized before a
  // single entry is resolved.
  const resolved = useResolvedWidgets();
  // The registry ids plus canonical Widget ids, and nothing else. No alternate display
  // root can contribute a ghost tile to this set.
  const liveIds = useMemo(() => new Set([
    ...GRID_REGISTRY.map((r) => r.id), ...widgets.map((w) => w.id),
  ]), [widgets]);
  // A Layout session deliberately keeps a tile after its Widget is deleted from the
  // drawer, until Save lets gcLayout remove it. Remember the last canonical kind so
  // that explicit orphan placeholder keeps its real geometry; the shared resolver can
  // then stay strict for genuinely unknown/absent Widget shapes.
  const rememberedKinds = useRef(new Map());
  // The same ONE mapping DashGrid uses (layout-grid.js): the instance's kind — and,
  // for a composite, its profile — decides the grid box, before any library entry is
  // resolved. Two copies of this ternary is how a tile sizes wrong on frame 1.
  const kindOf = useCallback(
    (id) => {
      if (FLOW_BY_ID[id]) return 'flow';
      const instance = widgetById[id];
      if (instance) {
        const kind = widgetGridKind(instance, {
          futurePlaceholder: isFutureWidget(instance),
        });
        rememberedKinds.current.set(id, kind);
        return kind;
      }
      if (rememberedKinds.current.has(id)) return rememberedKinds.current.get(id);
      return widgetGridKind(instance); // fail closed: this id was never a canonical Widget
    },
    [widgetById],
  );

  // ── local edit state ──────────────────────────────────────────────────────
  // Switched off is not here (spec 2026-09-03 §1): the resolved arrangement splits into
  // what the user arranges (`tiles`, compacted like view mode) and what is only
  // REMEMBERED (`parked` — x/w/h plus the two neighbour ids that name its place; see
  // layout-grid.js). Everything interactive below reads `tiles`; Save, the seed check,
  // the group sweep and both shares read `full`, so an invisible tile never loses its
  // place. ONE state object holds both halves: a park moves a tile from one to the other,
  // and two separate setters could be split apart by another effect's write in the same
  // commit — the newcomer merge above writes `tiles` too.
  const isOff = useCallback((id) => !switchedOn(display, id), [display]);
  const entrySplit = useMemo(() => {
    // `placed`, not `resolved`: the library resolution above owns that name in this
    // file (DashGrid draws the same distinction).
    const placed = resolveLayout(display, GRID_REGISTRY, liveIds, kindOf, tileSlot, { isOff });
    return splitSwitchedOff(Object.fromEntries(placed.map((e) => [e.id, e.tile])), isOff);
  }, []); // snapshot ONCE on mode entry
  const entryTiles = entrySplit.tiles;
  const entryParked = entrySplit.parked;
  const [session, setSession] = useState(entrySplit);
  const { tiles, parked } = session;
  // Every existing write stays `setTiles(next)` / `setTiles((cur) => …)`; it is the ONE
  // state object underneath that makes those compose with the park/unpark effect.
  const setTiles = useCallback((next) => setSession((s) => ({
    ...s, tiles: typeof next === 'function' ? next(s.tiles) : next,
  })), []);
  // ── groups + multi-select (widget-library phase 4, §6.4) ──────────────────
  // Same session semantics as entryTiles: snapshot ONCE on mode entry, edit
  // locally, persist on Save. Shallow copies are enough — every edit below
  // (makeGroup, the newcomer merge, Reset) returns fresh objects, never mutates.
  const entryGroups = useMemo(() => (display?.groups || []).map((g) => ({ ...g })), []);
  const [groups, setGroups] = useState(entryGroups);
  // Read by the window-level drag listeners, which are bound once and must see the live groups.
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  // The whole arrangement: the visible half with every parked tile put back where it
  // remembers, in ONE conflict-free row space. This is what Save writes, so the stored
  // rows themselves say which tile is above which — no reader is left breaking a tie on
  // key order, which Postgres jsonb re-sorts anyway (review 2026-09-04). A returning tile
  // yields: its cell if free, else a row of its own under its old row (owner 2026-09-23).
  const full = useMemo(() => materializeParked(tiles, parked), [tiles, parked]);
  // The selection feeding the Group action. Anything can enter (canGroup is the
  // gate that EXPLAINS a bad set); only grouped members stay out — see
  // toggleSelected below.
  const [selected, setSelected] = useState(() => new Set());
  // ── frame session state (T6) — all three are paint/dialog state, never saved:
  // the selected FRAME (mutually exclusive with the tile selection), the group
  // being renamed ({id, title} for the one-input dialog), and the group whose
  // swatch row is open.
  const [selGroup, setSelGroup] = useState(null);
  const [renaming, setRenaming] = useState(null); // { id, title } | null
  const [bgPick, setBgPick] = useState(null);     // group id | null
  // ── share (T8): a group becomes a block entry, the arrangement a layout ──
  // One dialog for both, in the WidgetLinkMenu Share idiom. Nothing on the
  // pacing changes on a share: block/layout entries are copy-on-add (§1a.3),
  // so the group is never linked to what it published.
  const [sharing, setSharing] = useState(null);   // {mode:'block',group,name,description} | {mode:'layout',name,description} | null
  const [busyShare, setBusyShare] = useState(false);
  // Reset pressed while the stored layout object already EQUALS the seed geometry:
  // tiles don't change, but Save must still be offered — it persists layout:null
  // (round 6.1: there was no way to convert a seed-identical object back to null).
  const [resetRequested, setResetRequested] = useState(false);
  // The whole arrangement is what Save writes, so it is what "changed" means. Comparing
  // the visible half alone would miss a tile that was switched off, moved while on and
  // switched off again — its remembered spot moved, and there would be no way to save it.
  // A plain switch flips nothing here: parking a tile does not move it, so off-and-on
  // leaves the session clean, which is exactly what it is.
  const entryFull = useMemo(
    () => materializeParked(entryTiles, entryParked), [entryTiles, entryParked],
  );
  const dirty = !tilesEqual(full, entryFull)
    || !groupsEqual(groups, entryGroups)
    || (resetRequested && display?.layout != null);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // Widgets added while this layout session is open (the Library's "+ Add",
  // spec §6.2) are placed into the LIVE snapshot — otherwise a tile added from
  // the drawer behind the session would appear only after Save and re-enter,
  // which reads as "+ Add did nothing". mergeNewTiles is additive and identity-
  // preserving (layout-grid.js): existing tiles keep their geometry, nothing is
  // removed here (a widget deleted elsewhere is gcLayout's job at Save), and a
  // push that adds no id returns the same object, so typing in the drawer cannot
  // flip `dirty` by itself. A genuine newcomer DOES mark the session dirty —
  // correct: the arrangement really did change, and Save is what persists it.
  // A parked widget is already IN this session — it is simply not on the grid — so it
  // must not look like a newcomer and be first-fit a second time. Read through a ref:
  // the merge is keyed on the widget ids alone, and re-running it whenever a switch
  // moved a tile between the two halves would re-place nothing and cost a render.
  const parkedRef = useRef(parked);
  parkedRef.current = parked;
  const widgetIdKey = widgets.map((w) => w.id).join(',');
  useEffect(() => {
    setTiles((cur) => mergeNewTiles(
      cur, widgets.filter((w) => !(w && parkedRef.current[w.id])), kindOf,
    ));
    // Keyed on the id STRING, not the array: `display.widgets` is a fresh array on
    // every draft push, and depending on it would re-run this on every keystroke
    // in the drawer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetIdKey]);

  // A switch flipped while this session is open (§4): the Settings drawer sits OVER
  // Layout mode, and another person's save reaches us the same way through the store.
  // ONE operation covers both directions — put the whole arrangement back together, then
  // split it again under the new switches. An id that turned off leaves the grid holding
  // the place it has RIGHT NOW (not the one it entered with: the user may have moved it)
  // and the rows it frees close up; an id that turned on comes back where it remembers,
  // or on a row of its own right under it when that place was taken (nothing visible moves). Doing it in two hand-rolled halves is right for one
  // tile and wrong for two, because the second one's anchors would still describe the
  // arrangement the first one has already left.
  //
  // Keyed on the off-id STRING for the reason the newcomer merge is keyed on ids:
  // `display` is a fresh object on every drawer keystroke, and preserveEnabled re-spreads
  // the map inside it, so an identity-keyed effect would run on every character typed.
  const offKey = useMemo(
    () => [...Object.keys(tiles), ...Object.keys(parked)].filter(isOff).sort().join(','),
    [tiles, parked, isOff],
  );
  useEffect(() => {
    const off = new Set(offKey ? offKey.split(',') : []);
    // Functional, and identity-returning when nothing moved: this effect and the newcomer
    // merge above both write `tiles`, and a plain value computed from a closure would drop
    // whichever of the two React committed first (review 2026-09-04).
    setSession((s) => {
      const settled = Object.keys(s.tiles).every((id) => !off.has(id))
        && Object.keys(s.parked).every((id) => off.has(id));
      if (settled) return s;
      return splitSwitchedOff(materializeParked(s.tiles, s.parked), (id) => off.has(id));
    });
    // A tile that left the grid cannot stay in a selection drawn on the grid: the Group
    // door reads geometry out of `tiles`, and an id with no tile there would name a
    // member nobody can see.
    setSelected((cur) => ([...cur].some((id) => off.has(id))
      ? new Set([...cur].filter((id) => !off.has(id))) : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offKey]);

  // Groups that appear while this session is open — the Library's block Add
  // saves {widgets, groups} behind it — merge into the LIVE session the way
  // newcomer tiles do above: additive, identity-preserving (mergeNewGroups),
  // keyed on the id STRING for the same keystroke reason.
  const groupIdKey = (display?.groups || []).map((g) => g.id).join(',');
  useEffect(() => {
    setGroups((cur) => mergeNewGroups(cur, display?.groups));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIdKey]);

  const [confirm, setConfirm] = useState(null); // 'reset' | 'cancel' | null
  const [saving, setSaving] = useState(false);
  const [liveMsg, setLiveMsg] = useState('');   // aria-live: keyboard move/resize feedback

  // ── multi-select mechanics ────────────────────────────────────────────────
  const toggleSelected = (id) => {
    // A tile already inside a group selects via its FRAME (T6): the frame is the
    // unit that moves as one, so its members stay out of the click/lasso set.
    if (groups.some((g) => g.tileIds.includes(id))) return;
    // Tile and group selection are mutually exclusive — picking a tile drops the
    // frame highlight (selectGroup clears `selected` the same way).
    setSelGroup(null);
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // The count reaches screen readers through the SAME live line keyboard moves
  // use. Zero is skipped: clearing a selection is silence, not an announcement.
  const selCount = selected.size;
  useEffect(() => {
    if (selCount) setLiveMsg(`${selCount} tile${selCount === 1 ? '' : 's'} selected`);
  }, [selCount]);

  // ── drag / resize machinery (docs/2026-09-23-layout-drag.md) ──────────────
  // A press only ARMS a gesture (pendingRef); it becomes one after a few pixels, or after a
  // touch hold. From then until the drop the page is FROZEN: `tiles` is not written, this
  // component does not re-render, and only the carried card (a transform), DragOverlay above
  // it and, while the hand rests, the one swap partner move. The drop commits the target the
  // last frame showed, through the same applyTarget that drew it, and every moved cell glides
  // to its new place (FLIP). Resize is the one gesture that updates the page live.
  const gridRef = useRef(null);
  const hintRef = useRef(null);
  const cellRefs = useRef({});
  const frameRefs = useRef({});
  const overlayRef = useRef(null);
  // Render state only: which cells wear the carried / dimmed classes, and the resize chip.
  const [drag, setDrag] = useState(null);       // {mode:'move'|'frame'|'resize', id, gid, ids, style, capped}
  const dragRef = useRef(null);                 // the live gesture (activate); never React state
  const pendingRef = useRef(null);              // an armed press that is not a drag yet
  const rafRef = useRef(null);
  const flipRef = useRef(null);                 // what the next commit animates: {before, clear, raise, skip, instant}
  const flipAnims = useRef([]);
  const keyStackRef = useRef([]);               // arrowStep's stack: the opposite key undoes a press
  const gripAnchorRef = useRef(null);           // {id, tiles, produced}: the map the grip was focused on
  const swallowClickRef = useRef(false);        // a gesture ended with the button still down
  // The window listeners are bound once, so everything they read goes through a ref.
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;
  const kindOfRef = useRef(kindOf);
  kindOfRef.current = kindOf;
  const editableRef = useRef(editable);
  editableRef.current = editable;

  /**
   * The app scrolls a CONTAINER (<main>), not the window — every coordinate below is
   * expressed in that container's CONTENT space so mid-drag scrolling (wheel or edge
   * autoscroll) can't skew the mapping (round-5 DnD fix).
   */
  const getScroller = useCallback(() => {
    let el = gridRef.current?.parentElement;
    while (el && el !== document.body) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) {
        const r = el.getBoundingClientRect();
        return {
          el,
          viewTop: r.top, viewBottom: Math.min(r.bottom, window.innerHeight),
          get scrollTop() { return el.scrollTop; },
          scrollBy(dy) { el.scrollTop += dy; },
          setScrollTop(v) { el.scrollTop = v; },
        };
      }
      el = el.parentElement;
    }
    return {
      el: null,
      viewTop: 0, viewBottom: window.innerHeight,
      get scrollTop() { return window.scrollY; },
      scrollBy(dy) { window.scrollBy(0, dy); },
      setScrollTop(v) { window.scrollTo(0, v); },
    };
  }, []);

  // ── lasso select (§6.4): a drag on the grid BACKGROUND draws a marquee ────
  // Same content-space discipline as the drag machinery below: the grid's
  // content-space top (rect.top + scrollTop) is constant mid-scroll, viewport
  // coords are not — so the anchor is taken once, at pointer-down.
  const [lassoRect, setLassoRect] = useState(null); // grid-local px, render only
  const lassoRef = useRef(null);                    // live session anchor
  const cancelLasso = useCallback(() => {
    lassoRef.current = null;
    setLassoRect(null);
  }, []);
  const startLasso = (e) => {
    if (!editable || e.button !== 0 || dragRef.current) return;
    // A true background hit only — a press on any tile is a press on its strip,
    // overlay or handle, never on the grid element itself.
    if (e.target !== gridRef.current) return;
    e.preventDefault();
    const rect = gridRef.current.getBoundingClientRect();
    const scroller = getScroller();
    lassoRef.current = {
      left: rect.left, // horizontal never scrolls here (snapshotGeometry's rule)
      contentTop: rect.top + scroller.scrollTop,
      scroller,
      ox: e.clientX - rect.left,
      oy: e.clientY - rect.top,
    };
    setLassoRect({ x: lassoRef.current.ox, y: lassoRef.current.oy, w: 0, h: 0 });
  };
  const lassoActive = lassoRect != null;
  useEffect(() => {
    if (!lassoActive) return undefined;
    const rectOf = (clientX, clientY) => {
      const l = lassoRef.current;
      const gx = clientX - l.left;
      const gy = clientY + l.scroller.scrollTop - l.contentTop;
      return {
        x: Math.min(l.ox, gx), y: Math.min(l.oy, gy),
        w: Math.abs(gx - l.ox), h: Math.abs(gy - l.oy),
      };
    };
    const onMove = (e) => { if (lassoRef.current) setLassoRect(rectOf(e.clientX, e.clientY)); };
    const onUp = (e) => {
      const l = lassoRef.current;
      if (!l) return;
      const r = rectOf(e.clientX, e.clientY);
      // Select every tile whose RENDERED cell the marquee crosses — the measured
      // cells (cellRefs), not the logical grid, so a half-covered tall tile
      // counts the way the eye says it should. Grouped members stay out (they
      // select via their frame, T6); a functional block may enter and is then
      // EXPLAINED by canGroup's reason rather than silently dropped. An empty
      // marquee (a background click) clears the selection.
      const grouped = new Set(groups.flatMap((g) => g.tileIds));
      const hits = new Set();
      for (const [id, el] of Object.entries(cellRefs.current)) {
        if (!el || !tiles[id] || grouped.has(id)) continue;
        const c = el.getBoundingClientRect();
        const cx = c.left - l.left;
        const cy = c.top + l.scroller.scrollTop - l.contentTop;
        if (cx < r.x + r.w && r.x < cx + c.width && cy < r.y + r.h && r.y < cy + c.height) {
          hits.add(id);
        }
      }
      setSelGroup(null); // a fresh tile selection drops the frame highlight
      setSelected(hits);
      cancelLasso();
    };
    const onCancel = () => cancelLasso();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [lassoActive, tiles, groups, cancelLasso]);

  /**
   * The frozen page, measured when a gesture ACTIVATES (and again only if the content height
   * changes under it): every cell's box relative to .lm-grid from offsetLeft/Top/Width/Height.
   * Those ignore transforms, so the carried card, a sliding partner or a running glide can
   * never skew the rows a target is computed from. Grid-local content px: they do not move
   * when the page scrolls, which keeps wheel and edge scrolling from skewing a drag.
   */
  const snapshotGeometry = (map) => {
    const grid = gridRef.current;
    const cells = {};
    const byRow = new Map();
    const stretched = [];
    for (const [id, el] of Object.entries(cellRefs.current)) {
      if (!el || !map[id]) continue;
      const r = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
      cells[id] = r;
      if (el.classList.contains('dash-cell--stretch')) stretched.push([id, el]);
      const cur = byRow.get(map[id].y) || { top: Infinity, bottom: -Infinity };
      byRow.set(map[id].y, { top: Math.min(cur.top, r.top), bottom: Math.max(cur.bottom, r.top + r.height) });
    }
    const rows = [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([y, r]) => ({ y, top: r.top, bottom: r.bottom }));
    // Each tile's height with nothing stretching it: what a row it swaps into is sized by
    // (previewRects). A stretched cell is read with its class off and put back in the same
    // task, so it is laid out for the reading and never painted without it; the row keeps
    // its height either way (it is as tall as its tallest tile).
    const natural = Object.fromEntries(Object.entries(cells).map(([id, r]) => [id, r.height]));
    for (const [, el] of stretched) el.classList.remove('dash-cell--stretch');
    for (const [id, el] of stretched) natural[id] = el.offsetHeight;
    for (const [, el] of stretched) el.classList.add('dash-cell--stretch');
    const w = grid.clientWidth;
    return { rows, cells, natural, colW: (w - 11 * GRID_GAP) / 12, gap: GRID_GAP, w, h: grid.clientHeight };
  };

  /** Every cell's and frame's VISUAL top-left, grid-local: transforms and running glides
   *  included, which is where the eye sees them just before a commit. */
  const captureRects = () => {
    const grid = gridRef.current;
    const out = {};
    if (!grid) return out;
    const g = grid.getBoundingClientRect();
    const read = (key, el) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      out[key] = { left: r.left - g.left, top: r.top - g.top };
    };
    for (const [id, el] of Object.entries(cellRefs.current)) read(id, el);
    for (const [gid, el] of Object.entries(frameRefs.current)) read(`frame:${gid}`, el);
    return out;
  };
  const flipTargets = () => {
    const els = {};
    for (const [id, el] of Object.entries(cellRefs.current)) if (el) els[id] = el;
    for (const [gid, el] of Object.entries(frameRefs.current)) if (el) els[`frame:${gid}`] = el;
    return els;
  };
  const cancelFlips = () => {
    for (const a of flipAnims.current) a.cancel();
    flipAnims.current = [];
  };

  // After a drop, a key press, a resize step or a cancel, whatever moved glides from where the
  // eye saw it to its new cell: translate only, heights snap (a scaled chart would distort).
  // Runs after every commit and does nothing unless one of those asked for it.
  useLayoutEffect(() => {
    const f = flipRef.current;
    if (!f) return;
    flipRef.current = null;
    for (const el of f.clear || []) {
      // The slide class goes first: with its transition still on, clearing the transform
      // would animate a partner away from the cell it has just been given.
      el.classList.remove('lm-cell--partner');
      el.style.transform = '';
    }
    cancelFlips();
    if (f.instant || !f.before) return;
    const deltas = flipDeltas(f.before, captureRects());
    if (f.skip) delete deltas[f.skip];
    flipAnims.current = playFlip(flipTargets(), deltas, { raise: f.raise || {} });
  });

  const cancelPending = () => {
    const p = pendingRef.current;
    if (p && p.holdTimer) clearTimeout(p.holdTimer);
    pendingRef.current = null;
  };
  /** The part of the scroller the user can see, in viewport px: from under the sticky hint bar
   *  to the scroller's bottom. The autoscroll bands and the edge pill are measured from it. */
  const visibleBand = (sc) => {
    const r = sc.el ? sc.el.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const hint = hintRef.current ? hintRef.current.getBoundingClientRect().bottom : r.top;
    return { top: Math.max(r.top, hint), bottom: Math.min(r.bottom, window.innerHeight) };
  };
  const scrollMax = (sc) => (sc.el
    ? sc.el.scrollHeight - sc.el.clientHeight
    : Math.max(0, document.documentElement.scrollHeight - window.innerHeight));

  /**
   * A press arms a gesture; nothing changes yet. It becomes a drag after DRAG_THRESHOLD_PX of
   * movement (GRIP_THRESHOLD_PX on the corner grip). A finger on a tile BODY must hold still
   * for TOUCH_HOLD_MS instead, so a swipe keeps scrolling the page; the handles and strips
   * (touch-action: none) start like a mouse. Released before that, it was a plain click.
   * `spec` = {mode:'move'|'frame'|'resize', id, kind, gid, ids, label}.
   */
  const arm = (e, spec, touchBody = false) => {
    const grid = gridRef.current;
    if (!grid || dragRef.current) return;
    cancelPending();
    const g = grid.getBoundingClientRect();
    const p = {
      ...spec,
      pointerId: e.pointerId,
      pointerType: e.pointerType || 'mouse',
      cx: e.clientX, cy: e.clientY, x: e.clientX, y: e.clientY,
      local: { x: e.clientX - g.left, y: e.clientY - g.top },
      touchBody: touchBody && e.pointerType === 'touch',
      holdTimer: null,
    };
    if (p.touchBody) {
      p.holdTimer = setTimeout(() => {
        if (pendingRef.current !== p) return;
        p.holdTimer = null;
        machine.current.activate(p, p.x, p.y);
      }, TOUCH_HOLD_MS);
    }
    pendingRef.current = p;
  };

  /** What the hand carries and the point that decides the target (layout-motion.js). A tile
   *  or group box up to 380px tall is carried as itself; a taller one, and every full-row
   *  block, stays in place dimmed while a bar with its name follows the hand. */
  const measureCarry = (d, p) => {
    const { geo, start } = d;
    const step = geo.colW + GRID_GAP;
    if (d.mode === 'move') {
      const cell = geo.cells[d.id];
      if (!cell || !start[d.id]) return false;
      const band = isBandKind(d.kind);
      d.box = cell;
      d.W = band ? geo.w : cell.width;
      d.style = d.style || carryStyle(cell.height, band);
      d.grab = d.grab || { x: p.local.x - cell.left, y: p.local.y - cell.top };
      d.anchor = anchorFor(d.style, d.W, cell.height, d.grab.x, d.grab.y);
      d.ctx = dragContext(start, d.id, d.kind, geo, {
        groups: groupsRef.current, kindOf: kindOfRef.current, halfW: d.anchor.x,
      });
      d.lifted = [cellRefs.current[d.id]];
      return true;
    }
    const members = ((p ? p.ids : d.members) || []).filter((i) => start[i]);
    const b = groupBounds(start, members);
    const r1 = b && geo.rows.find((r) => r.y === b.y);
    const r2 = b && geo.rows.find((r) => r.y === b.y + b.rows - 1);
    if (!r1 || !r2) return false;
    d.members = members;
    d.box = { left: b.x * step, top: r1.top, width: b.w * step - GRID_GAP, height: r2.bottom - r1.top };
    d.W = d.box.width;
    d.style = d.style || carryStyle(d.box.height);
    d.grab = d.grab || { x: p.local.x - d.box.left, y: p.local.y - d.box.top };
    d.anchor = anchorFor(d.style, d.W, d.box.height, d.grab.x, d.grab.y);
    d.gctx = groupContext(start, members, geo, { groups: groupsRef.current, halfW: d.anchor.x });
    d.lifted = [...members.map((m) => cellRefs.current[m]), frameRefs.current[d.gid]];
    return true;
  };

  /** The press became a drag: measure the frozen page once and lift the tile. */
  const activate = (p, clientX, clientY) => {
    const grid = gridRef.current;
    cancelPending();
    if (!grid || !editableRef.current || dragRef.current) return;
    // Offsets ignore a running glide, but its animation would override the card's transform.
    cancelFlips();
    const start = tilesRef.current;
    const geo = snapshotGeometry(start);
    const scroller = getScroller();
    const now = performance.now();
    const d = {
      mode: p.mode, id: p.id || null, kind: p.kind || null, gid: p.gid || null, label: p.label,
      pointerId: p.pointerId, pointerType: p.pointerType,
      start, geo, press: p.local, pointer: { x: clientX, y: clientY },
      gridBox: { w: geo.w, h: geo.h }, scroller, maxScroll: scrollMax(scroller),
      buttonDown: true, state: null, target: HOME, key: null, targetSince: now, trail: [],
      edge: null, enteredAt: null, lastT: now, scrollPos: null,
      trips: {}, slid: new Map(), touched: new Set(), lifted: [], view: null, pill: null, mark: null,
    };
    if (p.mode === 'resize') {
      const cell = geo.cells[p.id];
      if (!cell || !start[p.id]) return;
      d.cell = cell;
      d.grabRight = cell.left + cell.width - p.local.x;
      d.grabBottom = cell.top + cell.height - p.local.y;
      d.heights = rowHeightsAtPickup(p.id);
    } else if (!measureCarry(d, p)) {
      return;
    }
    dragRef.current = d;
    if (scroller.el) {
      d.anchorWas = scroller.el.style.overflowAnchor;
      scroller.el.style.overflowAnchor = 'none';
    }
    if (p.pointerType === 'touch') window.addEventListener('touchmove', preventTouchScroll, { passive: false });
    // ONE render at activation: the carried or dimmed classes land in the same frame as the
    // first transform and the first landing mark below, so nothing is drawn half-lifted.
    flushSync(() => setDrag({
      mode: d.mode, id: d.id, gid: d.gid, ids: d.members || null, style: d.style || null, capped: false,
    }));
    frame(d, now);
    rafRef.current = requestAnimationFrame(loop);
  };

  /** The content height changed under a carry (data arrived): measure the page again. */
  const remeasure = (d) => {
    d.geo = snapshotGeometry(d.start);
    d.gridBox = { w: d.geo.w, h: d.geo.h };
    d.maxScroll = scrollMax(d.scroller);
    if (!measureCarry(d, null)) {
      endDragNow(false);
      return;
    }
    d.state = null;
    d.key = null; // the next frame draws the mark again in the new geometry
  };

  /** The landing mark for the current target: DragOverlay's boxes, the partners' trips, and
   *  data-lm-target on the grid (what a browser gate compares the drop against). */
  const showTarget = (d) => {
    const heightOf = (k) => (d.geo.cells[k] ? d.geo.cells[k].height : null);
    // A swap between rows of different heights: the slot and the partner's destination are
    // drawn where the drop really puts them (layout-grid.js previewRects), so a partner that
    // slides early never moves a second time at the drop.
    const naturalOf = (k) => (d.geo.natural && d.geo.natural[k] != null ? d.geo.natural[k] : null);
    const pr = d.mode === 'move'
      ? previewRects(d.ctx, d.target, heightOf, naturalOf)
      : groupPreviewRects(d.gctx, d.target, heightOf);
    // A partner pre-slides only when it keeps its width: a transform cannot resize it, and a
    // tile wider than the cell it heads for would sit on a bystander there until the drop. A
    // partner that changes width shows its destination outline, and the drop glides it there.
    const trips = {};
    for (const [pid, dest] of Object.entries(pr.partners)) {
      const cur = d.geo.cells[pid];
      if (cur && Math.abs(dest.width - cur.width) < 1) trips[pid] = { dx: dest.left - cur.left, dy: dest.top - cur.top };
    }
    // A partner that is no longer one, or now goes somewhere else, slides back home.
    for (const [pid, el] of [...d.slid]) {
      const was = d.trips[pid];
      const will = trips[pid];
      if (was && will && was.dx === will.dx && was.dy === will.dy) continue;
      el.style.transform = '';
      d.slid.delete(pid);
    }
    d.trips = trips;
    // The fresh-row bar sits in the row gap; above the first row or under the last one it
    // is kept just inside the grid box, which the overlay clips to.
    const insert = pr.insert && {
      left: pr.insert.left, width: pr.insert.width,
      top: clampN(pr.insert.y - 2, 2, Math.max(2, d.gridBox.h - 6)),
    };
    d.mark = pr.slot ? { top: pr.slot.top, bottom: pr.slot.top + pr.slot.height }
      : insert ? { top: insert.top, bottom: insert.top + 4 } : null;
    d.view = {
      slot: pr.slot, insert, vacated: pr.vacated,
      partners: Object.entries(pr.partners).map(([id, r]) => ({ id, ...r })),
      carry: d.style === 'bar' ? { width: Math.min(d.W, d.gridBox.w), label: d.label } : null,
      pill: d.pill,
    };
    if (gridRef.current) gridRef.current.dataset.lmTarget = d.key;
    flushSync(() => overlayRef.current?.setView(d.view));
  };

  /** A landing mark scrolled out of view gets a pill pinned to that edge. */
  const placePill = (d, g, vis) => {
    const top = vis.top - g.top;
    const bottom = vis.bottom - g.top;
    const hint = d.mark ? edgeHint(d.mark.top, d.mark.bottom, top, bottom) : null;
    if (hint !== d.pill) {
      d.pill = hint;
      d.view = { ...d.view, pill: hint };
      flushSync(() => overlayRef.current?.setView(d.view));
      // Measured once when it appears, never per frame (a read after this frame's writes
      // would force a layout).
      d.pillH = hint ? (overlayRef.current?.pill.current?.offsetHeight || 26) : 0;
    }
    const el = hint && overlayRef.current?.pill.current;
    if (!el) return;
    const h = d.pillH || 26;
    const y = hint === 'above' ? top + 10 : bottom - 10 - h;
    el.style.transform = `translate3d(0, ${clampN(y, 0, Math.max(0, d.gridBox.h - h))}px, 0)`;
  };

  /** One frame of a carry (a tile or a group frame). It never writes `tiles`: the page stays
   *  frozen until the drop. */
  const stepCarry = (d, L, now, g, vis) => {
    const R = referencePoint(L, d.grab, d.anchor, d.gridBox);
    // 1. the target: each axis settles on its own, so a tremor under 12px changes nothing
    const r = d.mode === 'move'
      ? pointerStep(d.ctx, d.state, R.x, R.y)
      : groupPointerStep(d.gctx, d.state, R.x, R.y);
    d.state = r.state;
    const key = targetKey(r.target);
    if (key !== d.key) {
      d.key = key;
      d.target = r.target;
      d.targetSince = now;
      showTarget(d);
    }
    // 2. the carried thing follows the hand 1:1, kept inside the grid box (a transform past
    //    it would grow the page under autoscroll)
    if (d.style === 'card') {
      const t = cardTranslate(L, d.press, d.box, d.gridBox);
      const tf = `translate3d(${t.x}px, ${t.y}px, 0)`;
      for (const el of d.lifted) if (el) el.style.transform = tf;
    } else {
      const bar = overlayRef.current?.bar.current;
      if (bar) {
        const b = barRect(L, R, d.W, d.gridBox);
        bar.style.transform = `translate3d(${b.left}px, ${b.top}px, 0)`;
      }
    }
    // 3. the swap partner slides only while the hand rests on the target
    d.trail.push({ t: now, x: R.x, y: R.y });
    while (d.trail.length > 1 && now - d.trail[1].t >= PARTNER_DWELL_MS) d.trail.shift();
    const shown = partnersShown(d.targetSince, now, d.trips, vis.bottom - vis.top, handResting(d.trail, now));
    for (const [pid, trip] of Object.entries(shown)) {
      if (d.slid.has(pid)) continue;
      const el = cellRefs.current[pid];
      if (!el) continue;
      el.classList.add('lm-cell--partner');
      el.style.transform = `translate3d(${trip.dx}px, ${trip.dy}px, 0)`;
      d.slid.set(pid, el);
      d.touched.add(el);
    }
    // 4. a landing mark out of view gets a pill at that edge
    placePill(d, g, vis);
  };

  /** One frame of a resize, the one live gesture: the width from the PICKUP left edge and the
   *  step from the pickup top (a pickup changes nothing), the neighbour giving way in its row
   *  (layout-grid.js resizeTo), the rows below gliding with it. */
  const stepResize = (d, L) => {
    const t = d.start[d.id];
    const { w: asked, offset } = resizeFromPointer({
      px: L.x, py: L.y, left0: d.cell.left, top0: d.cell.top,
      grabRight: d.grabRight, grabBottom: d.grabBottom, colW: d.geo.colW, gap: GRID_GAP,
    });
    const w = clampW(asked, d.kind);
    let h = t.h;
    const steps = H_ORDER[d.kind];
    if (steps && d.heights) {
      // The row as it stood at pickup, with this tile at each candidate step.
      const row = Object.fromEntries(Object.entries(d.start).filter(([, other]) => other.y === t.y));
      h = resizeStepFor({
        steps, from: t.h, offset, ...d.heights,
        stretchedAt: (step) => rowStretchIds({ ...row, [d.id]: { ...t, h: step } }).has(d.id),
      });
    }
    const key = `${w}:${h}:${asked > w}`;
    if (key === d.key) return;
    d.key = key;
    const r = resizeTo(d.start, d.id, d.kind, w, h, kindOfRef.current, groupsRef.current);
    const capped = r.capped || asked > w;
    if (r.tiles !== tilesRef.current) {
      flipRef.current = { before: captureRects(), skip: d.id };
      d.written = r.tiles;
      setTiles(r.tiles);
    }
    setDrag((cur) => (cur && cur.capped !== capped ? { ...cur, capped } : cur));
  };

  /** One animation frame of any gesture: autoscroll, then the gesture's own step. */
  const frame = (d, now) => {
    const grid = gridRef.current;
    if (!grid) return;
    const dt = Math.min(64, Math.max(0, now - d.lastT));
    d.lastT = now;
    const sc = d.scroller;
    const vis = visibleBand(sc);
    // The ramp starts when the pointer ENTERS a band and resets when it leaves, so a long
    // carry never arrives at an edge at full speed.
    const edge = edgeOfPointer(d.pointer.y, vis.top, vis.bottom);
    if (edge !== d.edge) {
      d.edge = edge;
      d.enteredAt = edge ? now : null;
    }
    const v = autoscrollVelocity(d.pointer.y, vis.top, vis.bottom, now, d.enteredAt);
    if (v) {
      const cur = sc.scrollTop;
      if (d.scrollPos == null || Math.abs(d.scrollPos - cur) > 1.5) d.scrollPos = cur;
      // A resize grows the page on purpose; a carry never may, so it stops at the end the
      // page had at pickup.
      d.scrollPos = scrollStep(d.scrollPos, v, dt, d.mode === 'resize' ? scrollMax(sc) : d.maxScroll);
      if (Math.round(d.scrollPos) !== Math.round(cur)) sc.setScrollTop(d.scrollPos);
    } else {
      d.scrollPos = null;
    }
    const g = grid.getBoundingClientRect();
    const L = { x: d.pointer.x - g.left, y: d.pointer.y - g.top };
    if (d.mode === 'resize') stepResize(d, L);
    else stepCarry(d, L, now, g, vis);
  };
  const loop = (now) => {
    const d = dragRef.current;
    if (!d) {
      rafRef.current = null;
      return;
    }
    machine.current.frame(d, now);
    if (dragRef.current === d) rafRef.current = requestAnimationFrame(loop);
  };

  /** The z-index each tile rides during a glide: `movers` (the dropped tile, a group's members,
   *  a focused tile) on top, the group's frame just under its members, `target`'s swap
   *  partners under those, bystanders unraised. */
  const dropRaise = (movers, gid, target) => {
    const raise = {};
    for (const p of target && target.type === 'swap' ? [target.partner] : target && target.type === 'gswap' ? target.with : []) {
      raise[p] = 22;
    }
    for (const m of movers || []) raise[m] = 25;
    if (gid) raise[`frame:${gid}`] = 24;
    return raise;
  };

  /** A carry that ends over another tile must not also click it. */
  const suppressNextClick = () => {
    const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
  };

  /**
   * The end of a gesture. commit: the drop, which writes exactly the target the last frame
   * showed (pointerup computes nothing new) through applyTarget / applyGroupTarget from the
   * pickup map; a "home" target writes nothing. !commit: Esc, pointercancel, an outside
   * write, or the window narrowing under 900px (`instant`: no glide, the layout is a column
   * by then): nothing is written and the card glides home.
   */
  const endDragNow = (commit, { instant = false } = {}) => {
    cancelPending();
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    window.removeEventListener('touchmove', preventTouchScroll, { passive: false });
    if (d.scroller.el) d.scroller.el.style.overflowAnchor = d.anchorWas || '';
    if (gridRef.current) delete gridRef.current.dataset.lmTarget;
    let next = null;
    if (d.mode === 'resize') {
      // Live already. A cancel puts the pickup map back, unless someone else wrote since.
      if (!commit) next = (cur) => (cur === d.written || cur === d.start ? d.start : cur);
    } else if (commit && d.target && d.target.type !== 'home') {
      const out = d.mode === 'move'
        ? applyTarget(d.start, d.id, d.kind, d.target)
        : applyGroupTarget(d.start, d.members, d.target);
      // Only onto the map the carry started from: an outside write mid-carry cancels instead.
      if (out !== d.start) next = (cur) => (cur === d.start ? out : cur);
    }
    // Who is drawn on top while everything glides (review 2026-09-23: a partner moving up slid
    // UNDER every tile it crossed, and one moving down covered the tile just dropped): the
    // dropped tile or group first, even when it lands without moving, then its swap partners,
    // then the bystanders, which only follow their rows. A cancel raises the same way: a
    // partner that had slid glides back home above the tiles it crosses.
    const raise = d.mode === 'resize' ? {} : dropRaise(d.mode === 'move' ? [d.id] : d.members,
      d.mode === 'frame' ? d.gid : null, d.target);
    flipRef.current = {
      before: instant ? null : captureRects(),
      clear: [...d.lifted, ...d.touched].filter(Boolean),
      raise, instant,
    };
    overlayRef.current?.setView(null);
    setDrag(null);
    if (next) {
      setTiles(next);
      keyStackRef.current = [];
    }
    if (commit && d.mode !== 'resize') suppressNextClick();
    // Cancelled with the button still down (Esc, an outside write): the release that follows
    // must not click whatever it lands on either.
    else if (!commit && !instant && d.buttonDown) swallowClickRef.current = true;
  };

  const onPointerMove = (e) => {
    const p = pendingRef.current;
    if (p) {
      if (e.pointerId !== p.pointerId) return;
      p.x = e.clientX;
      p.y = e.clientY;
      const moved = Math.hypot(e.clientX - p.cx, e.clientY - p.cy);
      if (p.touchBody) {
        if (moved > TOUCH_SLOP_PX) cancelPending(); // a swipe: the page scrolls, nothing lifts
        return;
      }
      if (moved >= (p.mode === 'resize' ? GRIP_THRESHOLD_PX : DRAG_THRESHOLD_PX)) activate(p, e.clientX, e.clientY);
      return;
    }
    // pointermove only stores the pointer; the frame loop reads it once per frame.
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    // A mouse released outside the window sends no pointerup: with no button held any more,
    // the carry is over, and the safe ending is a cancel.
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      d.buttonDown = false;
      endDragNow(false);
      return;
    }
    d.pointer = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e) => {
    if (swallowClickRef.current) {
      swallowClickRef.current = false;
      suppressNextClick();
    }
    const p = pendingRef.current;
    if (p && e.pointerId === p.pointerId) {
      cancelPending(); // released before it became a drag: a plain click
      return;
    }
    const d = dragRef.current;
    if (d && e.pointerId === d.pointerId) endDragNow(true);
  };
  const onPointerCancel = (e) => {
    const p = pendingRef.current;
    if (p && e.pointerId === p.pointerId) cancelPending();
    const d = dragRef.current;
    if (d && e.pointerId === d.pointerId) {
      d.buttonDown = false; // the pointer is gone: no release will follow
      endDragNow(false);
    }
  };

  // Everything the once-bound listeners, the hold timer and the frame loop call, as of the
  // latest render. The functions read refs only, so the latest is always right.
  const machine = useRef(null);
  machine.current = { activate, frame, remeasure, endDragNow, cancelPending, onPointerMove, onPointerUp, onPointerCancel };
  const endDrag = useCallback((commit, opts) => machine.current.endDragNow(commit, opts), []);

  // Bound ONCE for the whole session (and only in Layout mode: view mode never mounts this).
  useEffect(() => {
    const move = (e) => machine.current.onPointerMove(e);
    const up = (e) => machine.current.onPointerUp(e);
    const cancel = (e) => machine.current.onPointerCancel(e);
    // A long press must not open the context menu under the finger.
    const menu = (e) => { if (dragRef.current || pendingRef.current?.touchBody) e.preventDefault(); };
    // The window lost focus mid-gesture (another app, a system dialog): cancel, never guess.
    const blur = () => {
      machine.current.cancelPending();
      if (dragRef.current) {
        dragRef.current.buttonDown = false; // the release may never reach this window
        machine.current.endDragNow(false);
      }
    };
    // A new press means any earlier release is long gone.
    const down = () => { swallowClickRef.current = false; };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('contextmenu', menu);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('contextmenu', menu);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointerdown', down, true);
      // The mode closed under a gesture: nothing of it may outlive the component.
      const p = pendingRef.current;
      if (p && p.holdTimer) clearTimeout(p.holdTimer);
      pendingRef.current = null;
      const d = dragRef.current;
      dragRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('touchmove', preventTouchScroll, { passive: false });
      if (d && d.scroller.el) d.scroller.el.style.overflowAnchor = d.anchorWas || '';
      for (const a of flipAnims.current) a.cancel();
    };
  }, []);

  // Data arriving mid-carry can change the content height: measure the frozen page again.
  const carrying = !!drag && drag.mode !== 'resize';
  useEffect(() => {
    const grid = gridRef.current;
    if (!carrying || !grid || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const d = dragRef.current;
      if (!d || d.mode === 'resize') return;
      if (Math.abs(grid.clientHeight - d.gridBox.h) < 1 && Math.abs(grid.clientWidth - d.gridBox.w) < 1) return;
      machine.current.remeasure(d);
    });
    ro.observe(grid);
    return () => ro.disconnect();
  }, [carrying]);

  // An outside write to the session's tiles during a gesture (a switch parked a tile, a
  // Library newcomer landed): the pickup map is stale, so a carry is cancelled, and a live
  // resize simply ends where it is (that write already includes it).
  useEffect(() => {
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === 'resize') {
      if (tiles !== d.start && tiles !== d.written) endDrag(true);
    } else if (tiles !== d.start) {
      endDrag(false);
    }
  }, [tiles, endDrag]);

  // Narrow-viewport pause interrupts an ACTIVE drag too (round 7): the window
  // listeners kept mutating invisible geometry after the handles disappeared. The page is a
  // single column by then, so nothing glides.
  useEffect(() => {
    if (editable) return;
    machine.current.cancelPending();
    if (dragRef.current) endDrag(false, { instant: true });
  }, [editable, endDrag]);

  // Esc ladder: drag → cancel drag; open confirm → dismiss; open swatch row →
  // close; live lasso → cancel; selection (tile OR frame) → clear; dirty →
  // confirm cancel; clean → exit. §6.4 added the selection rungs BEFORE the
  // dirty-cancel rung: Esc backs out of the newest thing first, and clearing a
  // selection must never threaten the session. (The rename dialog is absent on
  // purpose: ConfirmModal owns Escape while open, capture-phase.)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // A press that has not become a drag yet is the same rung: the gesture goes first.
      if (pendingRef.current) { machine.current.cancelPending(); return; }
      if (dragRef.current) { endDrag(false); return; }
      if (confirm) { setConfirm(null); return; }
      if (bgPick) { setBgPick(null); return; }
      if (lassoRef.current) { cancelLasso(); return; }
      if (selGroup) { setSelGroup(null); return; }
      if (selected.size) { setSelected(new Set()); return; }
      if (dirty) setConfirm('cancel');
      else onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, confirm, bgPick, selGroup, selected, endDrag, cancelLasso, onExit]);

  const announceTile = (id, next, extra = '') => {
    const t = next[id];
    if (!t) return;
    const total = new Set(Object.values(next).map((v) => v.y)).size;
    setLiveMsg(`${labelFor(id)}: row ${t.y + 1} of ${total}, column ${t.x + 1}, width ${t.w}${extra}`);
  };
  /** Why an arrow press did nothing, said on the live line (arrowTarget's `why`). */
  const tileRefusal = (id, r) => {
    const name = labelFor(id);
    if (r.why === 'fullrow') return `${name}: full-width blocks move up and down only`;
    if (r.why === 'group') {
      if (!r.other) return `${name}: cannot move there without breaking a group`;
      return groupOf(groups, r.other)
        ? `${name}: cannot trade places with ${labelFor(r.other)}: it belongs to a group`
        : `${name}: cannot trade places with ${labelFor(r.other)}: that would break a group`;
    }
    if (EDGE_WORDS[r.why]) return `${name}: already at ${EDGE_WORDS[r.why]}`;
    return `${name}: cannot move that way`;
  };
  /** A keyboard step: whatever it moved glides there, like a drop, stacked like a drop (the
   *  focused tile or group on top, then the partner it traded with). */
  const commitKeyed = (next, raise = {}) => {
    flipRef.current = { before: captureRects(), raise };
    setTiles(next);
  };
  // The partner of each keyed step, by the map that step produced: the opposite key undoes a
  // step by handing back the map from before it, and that glide needs the same partner raised.
  const keyTargets = useRef(new WeakMap());

  // Keyboard move on a focused handle: one press is one step by the pointer's own rules
  // (layout-grid.js arrowStep), a key never changes a width, and the opposite arrow right
  // after a press undoes it exactly (only while nothing else has written in between).
  const onHandleKey = (e, id, kind) => {
    if (!editable) return;
    const t = tiles[id];
    if (!t) return;
    if (e.key === 'Enter' || e.key === ' ') {
      // §7: Enter confirms the position — keyboard moves already committed per press.
      e.preventDefault();
      e.currentTarget.blur();
      setLiveMsg(`${labelFor(id)}: position set — row ${t.y + 1}`);
      return;
    }
    if (!ARROWS.includes(e.key)) return;
    e.preventDefault();
    if (dragRef.current) return;
    const res = arrowStep({ tiles, stack: keyStackRef.current }, id, kind, e.key, groups, kindOf);
    keyStackRef.current = res.stack;
    if (res.tiles === tiles) {
      setLiveMsg(tileRefusal(id, res));
      return;
    }
    // The partner, for the live line: what this press asked for, unless it was an undo.
    const asked = res.undone ? null : arrowTarget(tiles, id, kind, e.key, groups, kindOf).target;
    if (asked) keyTargets.current.set(res.tiles, asked);
    commitKeyed(res.tiles, dropRaise([id], null, asked || keyTargets.current.get(tiles) || null));
    announceTile(id, res.tiles, asked?.type === 'swap' ? `, swapped with ${labelFor(asked.partner)}` : '');
  };

  // Keyboard resize on a focused grip: ←/→ width by one column, ↑/↓ height by one step, each
  // recomputed from the map the grip was focused on (layout-grid.js gripMove). One focus is
  // one resize, exactly like a pointer resize from its pickup: Right×3 then Left×3 is exact.
  const onGripFocus = (id) => {
    gripAnchorRef.current = { id, tiles, produced: null };
  };
  const onGripKey = (e, id, kind) => {
    if (!editable) return;
    const t = tiles[id];
    if (!t) return;
    if (!ARROWS.includes(e.key)) return;
    e.preventDefault();
    if (dragRef.current) return;
    let anchor = gripAnchorRef.current;
    // Anything else wrote since the last grip key (a drag, a switch): start from here.
    if (!anchor || anchor.id !== id || (tiles !== anchor.tiles && tiles !== anchor.produced)) {
      anchor = { id, tiles, produced: null };
      gripAnchorRef.current = anchor;
    }
    const next = gripMove(tiles, id, kind, e.key, kindOf, groups, anchor.tiles);
    const same = tilesEqual(next, tiles);
    const rt = (same ? tiles : next)[id];
    const size = `${labelFor(id)}: width ${rt.w} of 12${rt.h ? `, height ${rt.h}` : ''}`;
    if (same) {
      setLiveMsg(`${size}, cannot go further`);
      return;
    }
    anchor.produced = next;
    commitKeyed(next, dropRaise([id], null, null));
    setLiveMsg(size);
  };

  // ── save / cancel / reset ─────────────────────────────────────────────────
  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    const t = toast('Saving layout…', 'pending');
    try {
      // GC keep-set ≠ liveIds — see buildKeepIds for what it retains and why
      // (enabled{}-switched-off tiles keep their geometry). The CHART-KEY term this
      // used to pass retired with display.charts[]: a chart is a widget instance, so
      // its geometry is kept by the widgets half like every other tile's, and a
      // saved entry still keyed by a raw chart key belongs to no tile at all.
      const keepIds = buildKeepIds(display, GRID_REGISTRY.map((r) => r.id));
      // Entry resolution only placed LIVE ids — carry saved entries for ids this
      // session holds in neither half through the save untouched (they re-normalize
      // if they ever come back).
      const carried = {};
      for (const [cid, ct] of Object.entries(display?.layout?.tiles || {})) {
        if (!full[cid] && keepIds.has(cid)) carried[cid] = ct;
      }
      // Spec §1 Reset contract: a layout identical to the seed persists as
      // layout:null (untouched-pacing invariant restored), not a 20+-tile object
      // that would freeze today's defaults against future releases. The seed needs no
      // split to compare against: `full` is the arrangement whole again, in the same one
      // row space resolveLayout hands back.
      const seedTiles = Object.fromEntries(
        resolveLayout({ ...display, layout: null }, GRID_REGISTRY, liveIds, kindOf, tileSlot)
          .map((e) => [e.id, e.tile]),
      );
      // `carried` and `full` are disjoint by construction, so this spread has no order to
      // get right — which is the point: what is stored is one conflict-free arrangement,
      // and the landing rule (§3) is baked into its rows, not into a key ordering that
      // Postgres jsonb re-sorts on the way back.
      const layout = tilesEqual(full, seedTiles)
        ? null
        : gcLayout({ version: 1, tiles: { ...carried, ...full } }, keepIds);
      const result = await saveSettings(slug, {
        // ONE cas save carries the WHOLE arrangement (§6.4): geometry and frames
        // land together or not at all. Groups are swept against the session's own
        // widget tiles so a group never persists a member the arrangement no
        // longer holds; the server runs the same shared sweep again on every
        // widget-carrying save (db.mjs).
        display: {
          layout,
          // Swept against the WHOLE arrangement: a member the user switched off is still
          // a member of its group, and the group must not shed it for being invisible.
          groups: sweepGroups(groups, Object.keys(full).filter((id) => FLOW_BY_ID[id] == null)),
        },
        // LIVE stamp, not a mode-entry snapshot: store.displayRev only ever advances
        // from OUR OWN knowledge (page load, or a save WE made — a concurrent editor's
        // rev is never learned until our save 409s). Snapshotting it meant a Settings
        // save made from inside Layout mode (the gear stays available) turned this
        // save into a self-inflicted 409 and DISCARDED the arrangement (2026-07-29).
        display_rev: Number(useDashboardStore.getState().displayRev ?? 0),
      });
      t.update('Layout saved', 'success');
      onExit();
    } catch (err) {
      // No writer marker rides this save — it carries {layout, groups} and never
      // `widgets`, so it cannot change a v2 widget, and a stale range it inherits is
      // cleaned rather than refused (db.mjs widgetRanges rule). The detail-preferring
      // translator all the same: nothing this lane can answer today carries a sentence,
      // and on the day one does, showing it beats showing the code beside it.
      t.update(saveErrorDetailText(err, 'Save failed'), 'error');
      setSaving(false);
    }
  }

  function handleReset() {
    // Seed semantics: layout:null → resolveLayout places everything at defaults —
    // custom widgets INCLUDED (they re-place, never disappear; spec §1). Split like
    // mode entry (§6): the seed places a switched-off tile too, and its default spot
    // is what it parks with.
    const placed = resolveLayout(
      { ...display, layout: null }, GRID_REGISTRY, liveIds, kindOf, tileSlot,
    );
    const split = splitSwitchedOff(Object.fromEntries(placed.map((e) => [e.id, e.tile])), isOff);
    setSession(split);
    // The default arrangement has no frames — Reset removes the groups too, and
    // the confirm copy says so. The frame session state goes with them: a
    // highlight or swatch row pointing at a removed group would dangle.
    setGroups([]);
    setSelGroup(null);
    setBgPick(null);
    setResetRequested(true);
    setConfirm(null);
  }

  // ── turn off, right here (owner 2026-09-04) ───────────────────────────────
  // A view preference: it saves ALONE and immediately through the per-entry merge
  // lane, never as part of the layout Save. The store adopts the server's answer,
  // the switch effect above sees the id turn off and parks the tile — so the chip
  // does not touch `tiles` itself. Only OFF exists here: a switched-off tile is not
  // drawn, so there is no chip to turn one back on.
  const [switching, setSwitching] = useState(null);
  const turnOff = useCallback(async (id) => {
    if (!hasSwitch(id)) {
      throw new TypeError(`Cannot toggle unknown dashboard tile "${String(id)}"`);
    }
    setSwitching(id);
    try {
      await saveSettings(slug, { display: { enabled: enabledPatch(id, false) } });
    } catch (err) {
      // The same translator and the same fallback the gallery's switch reads
      // (useEnabledSwitch.js): one refusal, one sentence.
      toast(saveErrorDetailText(err, 'Could not save the switch'), 'error');
    } finally {
      setSwitching((cur) => (cur === id ? null : cur));
    }
  }, [slug, saveSettings]);

  // ── render ────────────────────────────────────────────────────────────────
  const visCtx = { campaign, facts, display };
  // A flow block keeps its static FLOW_TITLES name; everything else takes the
  // RESOLVED title — a linked instance's name lives on its library entry unless the
  // instance overrides it, and Layout mode must not be the one surface that calls the
  // same tile something else. The hero's variant-dependent label went with block1:
  // the two heroes are separate library entries now, each with its own name.
  const labelFor = (id) => FLOW_TITLES[id] || headingOf(resolved.get(id), widgetById[id]) || id;
  const entries = Object.entries(tiles)
    .map(([id, tile]) => ({ id, tile, kind: kindOf(id) }))
    .sort((a, b) => a.tile.y - b.tile.y || a.tile.x - b.tile.x);
  // The tiles the dashboard stretches (DashGrid, same rule), off the session's live geometry so
  // a drag shows the height it will save.
  const stretch = rowStretchIds(Object.fromEntries(entries.map((e) => [e.id, e.tile])));

  // The Group action (§6.4): offered the moment TWO tiles are selected; the door
  // (group-ops.canGroup) is the ONE gate, and its refusal sentence is the
  // disabled button's title — the user is told why, never silently refused.
  const groupable = selected.size >= 2 ? canGroup([...selected], tiles, groups) : null;
  const doGroup = () => {
    if (!groupable?.ok) return;
    setGroups((cur) => [...cur, makeGroup([...selected], tiles, cur)]);
    setSelected(new Set());
  };

  const startMove = (e, id, kind) => {
    if (!editable) return;
    if (e.button !== 0) return;
    // §6.4 multi-select: a modifier-click TOGGLES the tile in the selection and
    // must not pick anything up — checked before any drag state is armed.
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      toggleSelected(id);
      return;
    }
    // A finger on the tile BODY must be free to scroll the page until it has held still
    // (arm), so only then is its default kept; everything else starts like a mouse.
    const body = e.currentTarget.classList.contains('lm-overlay');
    if (!(body && e.pointerType === 'touch')) e.preventDefault();
    arm(e, { mode: 'move', id, kind, label: labelFor(id) }, body);
  };
  /**
   * The heights resizeStepFor reads, measured once at pickup like snapshotGeometry: every tile
   * on the grabbed tile's row as it draws with nothing stretching it. The stretch class comes
   * off the row and goes back in the same task, so the row is laid out for the reading and
   * never painted without it.
   */
  const rowHeightsAtPickup = (id) => {
    const map = tilesRef.current;
    const y = map[id].y;
    const cells = Object.entries(cellRefs.current).filter(([other, el]) => el && map[other]?.y === y);
    const stretched = cells.filter(([, el]) => el.classList.contains('dash-cell--stretch'));
    for (const [, el] of stretched) el.classList.remove('dash-cell--stretch');
    const own = Object.fromEntries(cells.map(([other, el]) => [other, el.getBoundingClientRect().height]));
    for (const [, el] of stretched) el.classList.add('dash-cell--stretch');
    return {
      natural: own[id] || 0,
      rowNatural: Math.max(0, ...cells.filter(([other]) => other !== id).map(([other]) => own[other])),
      // A chart's plot and a table's rows take the step; a set of numbers does not.
      grows: !!cellRefs.current[id]?.querySelector('.rpt-view > .chart-panel__body, .rpt-scroll'),
    };
  };
  const startResize = (e, id, kind) => {
    if (!editable) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    arm(e, { mode: 'resize', id, kind, label: labelFor(id) });
  };

  // ── the frames (T6): derived overlays over the SESSION state ──────────────
  // Same derivation view mode runs over its compacted entries (DashGrid), here
  // over the session's tiles + groups: bounds from the members that still hold
  // tiles (all-dead → null → no frame), suppressed while any non-member sits
  // inside the recomputed box — a mat that visually claims a stranger lies
  // about the group. Dragging a member out of formation suppresses the frame
  // until the arrangement is clean again; the group itself never leaves the
  // session state, so Save still carries it.
  const frames = useMemo(() => {
    if (!groups.length) return [];
    const ids = Object.keys(tiles);
    return groups
      .map((g) => ({ g, b: groupBounds(tiles, g.tileIds), members: new Set(g.tileIds) }))
      .filter(({ b, members }) => b && ids.every((id) => {
        if (members.has(id)) return true;
        const t = tiles[id];
        const inRows = t.y >= b.y && t.y <= b.y + b.rows - 1;
        const inCols = t.x < b.x + b.w && b.x < t.x + t.w;
        return !(inRows && inCols);
      }))
      .map(({ g, b }) => ({ g, b }));
  }, [tiles, groups]);

  const groupLabel = (g) => g.title || 'Group';

  // Frame drag: the strip (or its ≡) arms a carry of the whole member SET, the same machine
  // as a tile (activate): the box is carried as one, card or bar by its height, and its
  // reference point starts inside the box's first row even though the strip sits above it,
  // so a pickup is always home. The drop goes through applyGroupTarget from the pickup map.
  const startFrameMove = (e, g) => {
    if (!editable || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!groupBounds(tiles, g.tileIds)) return;
    arm(e, { mode: 'frame', gid: g.id, ids: g.tileIds, label: groupLabel(g) });
  };

  /** Why a frame key did nothing (groupArrowTarget's `why`). */
  const frameRefusal = (g, why, key) => {
    const name = groupLabel(g);
    if (why === 'shape') {
      return `${name}: cannot move ${key === 'ArrowUp' ? 'up' : 'down'}: another widget sits between its rows. Move it sideways or ungroup it.`;
    }
    if (why === 'blocked') return `${name}: no free columns that way`;
    if (why === 'group') return `${name}: another group is in the way`;
    if (EDGE_WORDS[why]) return `${name}: already at ${EDGE_WORDS[why]}`;
    return `${name}: cannot move that way`;
  };
  // Keyboard on the frame handle: ArrowLeft / ArrowRight / ArrowUp / ArrowDown move the SET
  // one step through the same group targets the pointer path uses (frameMover), never a
  // per-member loop, and share the tiles' undo: the opposite arrow right after puts it back.
  const onFrameKey = (e, g) => {
    if (!editable) return;
    const b = groupBounds(tiles, g.tileIds);
    if (!b) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.currentTarget.blur();
      setLiveMsg(`${groupLabel(g)}: position set — row ${b.y + 1}`);
      return;
    }
    if (!ARROWS.includes(e.key)) return;
    e.preventDefault();
    if (dragRef.current) return;
    const res = arrowStep(
      { tiles, stack: keyStackRef.current }, g.id, 'frame', e.key, groups, null, frameMover(g.tileIds, groups),
    );
    keyStackRef.current = res.stack;
    if (res.tiles === tiles) {
      setLiveMsg(frameRefusal(g, res.why, e.key));
      return;
    }
    const asked = res.undone ? null : groupArrowTarget(tiles, g.tileIds, e.key, groups).target;
    if (asked) keyTargets.current.set(res.tiles, asked);
    commitKeyed(res.tiles, dropRaise(g.tileIds, g.id, asked || keyTargets.current.get(tiles) || null));
    const nb = groupBounds(res.tiles, g.tileIds);
    if (nb) setLiveMsg(`${groupLabel(g)}: row ${nb.y + 1}, column ${nb.x + 1}, width ${nb.w}`);
  };

  const selectGroup = (g) => {
    setSelGroup(g.id);
    setSelected(new Set()); // tile and group selection are mutually exclusive
    setLiveMsg(`Group “${groupLabel(g)}” selected`);
  };

  const doUngroup = (gid) => {
    // No confirm — nothing is destroyed, the tiles stay (§6.4). The frame
    // session state pointing at it clears with it.
    setGroups((cur) => ungroup(cur, gid));
    setSelGroup((cur) => (cur === gid ? null : cur));
    setBgPick((cur) => (cur === gid ? null : cur));
  };

  const doRenameGroup = () => {
    // renameGroup trims and caps (GROUP_LIMITS.title); an empty result removes
    // the title, which is a legal unlabeled frame.
    setGroups((cur) => renameGroup(cur, renaming.id, renaming.title));
    setRenaming(null);
  };

  // ── share (T8): the gates, the item and the one write ─────────────────────
  // The gate is group-ops' blockShareBlocked (shared with the Display tab's
  // Groups section since the post-release UX round): ≥2 live members, and no
  // member whose entry is `missing` — refusal sentences included.
  // Over the WHOLE arrangement, not the grid: a switched-off member is part of the group
  // and rides the shared block, exactly as it does from the drawer's Groups section
  // (which reads the same enabled-blind placement through currentTiles).
  const shareItemFor = (g) => {
    const blocked = blockShareBlocked(g, full, resolved);
    return {
      key: 'gshare', label: 'Share…',
      disabled: !!blocked, title: blocked || undefined,
      onSelect: () => setSharing({ mode: 'block', group: g, name: g.title || 'Group', description: '' }),
    };
  };

  // Share layout…: only what is PERSISTED may be shared — a snapshot of an
  // unsaved session would mislead the team — so the button disables while
  // dirty and says why. The missing-entry gate is blockShareBlocked's, applied
  // to every instance the arrangement places.
  // The last two clauses are the rule the group share follows (blockShareBlocked): a
  // shared arrangement INLINES every member's definition, so a report tile inside it is
  // a v2 library write — which the library lane refuses (§7.6) — and a tile a NEWER
  // build stored would be refused there for its version. Said as a reason on a disabled
  // button, before the click, instead of a toast after it.
  const shareMember = (w) => full[w.id] && (resolved.get(w.id)?.widget || w);
  const layoutShareBlocked = dirty
    ? 'Save the layout first; a shared layout is a snapshot of the saved arrangement'
    : widgets.some((w) => full[w.id] && resolved.get(w.id)?.state === 'missing')
      ? 'A widget’s library entry is unavailable; nothing to snapshot'
      : widgets.some((w) => isFutureWidget(shareMember(w)))
        ? FUTURE_VERSION
        : null;

  // The WidgetLinkMenu share order, minus the instance step (copy-on-add has
  // no instance to touch): create the ENTRY — the only irreversible half —
  // then merge it into the store so previews resolve at once, then toast.
  // The builders return only {kind, definition}; the validator REQUIRES a
  // non-empty name, so the dialog's fields merge into the payload here — the
  // visibility among them (spec 2026-09-04), which the dialog's pills own.
  const doShareEntry = async (visibility) => {
    const { mode, group, name, description } = sharing;
    setBusyShare(true);
    try {
      // The whole arrangement again: what is shared is everything the save holds,
      // switched-off tiles included — the adopter turns them on where the author left them.
      const built = mode === 'block'
        ? buildBlockEntry(group, full, resolved)
        : buildLayoutEntry(display, full, resolved, GRID_REGISTRY.map((r) => r.id));
      const res = await api.library.share({
        ...built, name: name.trim(), description: description.trim() || null, visibility,
      }, useDashboardStore.getState().capabilities);
      mergeLibraryEntries({ [res.entry.id]: res.entry });
      // What LANDED, not what was asked for: an older server that stored the
      // default must not be described as having stored the choice.
      toast(res.entry.visibility === 'private'
        ? `“${res.entry.name}” is in your library. Only you see it.`
        : `“${res.entry.name}” is in the team library.`, 'success');
      setSharing(null);
    } catch (err) {
      // The library write lane refuses a v2 entry the same way the display lane does,
      // and its refusal names the entry — so the server's sentence wins here too.
      toast(saveErrorDetailText(err, mode === 'block'
        ? 'Could not share this group' : 'Could not share this layout'), 'error');
    } finally {
      setBusyShare(false);
    }
  };
  return (
    <div className={`lm-root${drag ? (drag.mode === 'resize' ? ' lm-root--resizing' : ' lm-root--dragging') : ''}`}>
      {/* hint bar — takes the FilterBar's sticky slot */}
      <div className="lm-hintbar" ref={hintRef}>
        <span className="lm-hint-t">
          {/* With every block switched off there is nothing on the grid, and a bar that
              still said "drag anything" would be talking about a blank page. */}
          <span className="lm-dot" /> {!editable
            ? 'Layout editing is paused — the window is too narrow (single column). Save or Cancel below.'
            : entries.length ? 'Layout mode — drag anything' : 'Layout mode: nothing to arrange'}
        </span>
        <span className="lm-hint-actions">
          {dirty && <span className="sp-dirty">Unsaved layout</span>}
          {groupable && (
            <button
              type="button"
              className="sp-btn sp-btn-s"
              disabled={!groupable.ok}
              title={groupable.ok
                ? 'Group the selected tiles — they move and share as one'
                : groupable.reason}
              onClick={doGroup}
            >
              Group ({selected.size})
            </button>
          )}
          {/* Settings, from inside the session. The gear moved from the campaign
              header into the FilterBar (2026-09-11), and that bar is inert while
              this session runs — so the hint bar, which owns the sticky slot here,
              carries it. Same drawer-over-layout contract as the Library below. */}
          {onOpenSettings && (
            <button type="button" className="sp-btn sp-btn-s lm-hint-icon" onClick={onOpenSettings}
              title="Settings" aria-label="Settings">
              <i className="ri-settings-3-line" aria-hidden="true" />
            </button>
          )}
          {/* The Library, from inside the session (spec §6.2). The drawer opens
              OVER the layout mode — nothing here exits it — and what is added
              lands in the live arrangement through the newcomer merge above. */}
          {onOpenLibrary && (
            <button type="button" className="sp-btn sp-btn-s" onClick={onOpenLibrary}
              title="Add a widget from the library">
              + Add
            </button>
          )}
          {/* Share the whole arrangement as a layout entry (§3.1, T8) —
              disabled with the reason while the session is unsaved. */}
          <button
            type="button"
            className="sp-btn sp-btn-s"
            disabled={saving || !!layoutShareBlocked}
            title={layoutShareBlocked || 'Share this arrangement with the team'}
            onClick={() => setSharing({ mode: 'layout', name: '', description: '' })}
          >
            Share layout…
          </button>
          <button type="button" className="sp-btn sp-btn-s" onClick={() => setConfirm('reset')}>
            Reset to default
          </button>
          <button
            type="button"
            className="sp-btn sp-btn-s"
            onClick={() => (dirty ? setConfirm('cancel') : onExit())}
          >
            Cancel
          </button>
          <button
            type="button"
            className="sp-btn sp-btn-p"
            disabled={!dirty || saving}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save layout'}
          </button>
        </span>
      </div>

      <div className="dash-grid lm-grid" ref={gridRef} onPointerDown={startLasso}>
        {/* Frames FIRST (paint order — the .grp-frame comment in index.css).
            The mat is pass-through paint exactly as in view mode; the STRIP is
            the one interactive part: drag handle, title, swatches and the ⋯. */}
        {frames.map(({ g, b }) => (
          <div
            key={g.id}
            ref={(el) => { frameRefs.current[g.id] = el; }}
            className={`grp-frame grp-${g.bg}${selGroup === g.id ? ' grp-frame--sel' : ''}${drag?.mode === 'frame' && drag.gid === g.id ? (drag.style === 'card' ? ' grp-frame--lifted' : ' grp-frame--home') : ''}`}
            style={{ gridColumn: `${b.x + 1} / span ${b.w}`, gridRow: `${b.y + 1} / ${b.y + b.rows + 1}` }}
          >
            <div
              className="grp-lm-strip"
              onPointerDown={(e) => startFrameMove(e, g)}
              onClick={() => selectGroup(g)}
              title="Drag to move the group · click to select"
            >
              <button
                type="button"
                className="lm-strip-handle"
                aria-label={`Move group ${groupLabel(g)} — arrow keys, Enter to confirm`}
                title="Drag to move · arrows to nudge"
                onPointerDown={(e) => startFrameMove(e, g)}
                onKeyDown={(e) => onFrameKey(e, g)}
              >
                ≡
              </button>
              <span className="grp-lm-t">{groupLabel(g)}</span>
              {bgPick === g.id && (
                <span className="grp-swatches" role="group" aria-label="Frame background">
                  {GROUP_TINTS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`grp-swatch grp-${t}${g.bg === t ? ' grp-swatch--on' : ''}`}
                      aria-label={`${t.charAt(0).toUpperCase()}${t.slice(1)} tint`}
                      aria-pressed={g.bg === t}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setGroups((cur) => setGroupBg(cur, g.id, t));
                        setBgPick(null);
                      }}
                    />
                  ))}
                  {/* The seventh option (owner 2026-08-16): None — no mat, no
                      border on the dashboard; here it stays a dashed outline.
                      An outlined slashed square, same geometry as the tints. */}
                  <button
                    type="button"
                    className={`grp-swatch grp-swatch--none${g.bg === 'none' ? ' grp-swatch--on' : ''}`}
                    aria-label="None"
                    aria-pressed={g.bg === 'none'}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setGroups((cur) => setGroupBg(cur, g.id, 'none'));
                      setBgPick(null);
                    }}
                  />
                </span>
              )}
              {/* The ⋯ must not arm a frame drag or select on its own clicks. */}
              <span onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                <TileMenu
                  label={`Group actions: ${groupLabel(g)}`}
                  items={[
                    { key: 'grename', label: 'Rename…',
                      onSelect: () => setRenaming({ id: g.id, title: g.title || '' }) },
                    { key: 'gbg', label: 'Background',
                      onSelect: () => setBgPick(g.id) },
                    // Only a titled group can hide its name (owner 2026-08-16):
                    // the toggle phrases the ACTION, the strip keeps showing the
                    // name either way — it is the management surface.
                    ...(g.title ? [{ key: 'ghide',
                      label: g.hideTitle ? 'Show name on dashboard' : 'Hide name on dashboard',
                      onSelect: () => setGroups((cur) => setGroupHideTitle(cur, g.id, !g.hideTitle)) }] : []),
                    { key: 'gungroup', label: 'Ungroup',
                      onSelect: () => doUngroup(g.id) },
                    shareItemFor(g),
                  ]}
                />
              </span>
            </div>
          </div>
        ))}
        {entries.map(({ id, tile, kind }) => {
          const flow = FLOW_BY_ID[id];
          const isDragged = drag?.id === id && drag.mode === 'move';
          const isResized = drag?.id === id && drag.mode === 'resize';
          // Carried: as itself (lifted, moved by a transform) or, when it is taller than a card
          // or a full-row block, left in place dimmed while a bar follows the hand.
          const inHand = isDragged || (drag?.mode === 'frame' && !!drag.ids?.includes(id));
          const lifted = inHand && drag.style === 'card';
          const dimmed = inHand && drag.style === 'bar';
          const dataHidden = flow && flow.visible && !flow.visible(visCtx);
          // A FULL-ROW tile — a flow block, or a `section` composite (the converted hero
          // and Finance) — is a page-wide band, and it gets the band chrome: a grab
          // STRIP above its content, and a bar in the hand while it is carried. Not the
          // sized treatment: a corner handle over a viewport-tall hero would obscure the
          // page the moment it is dragged, and a `w12 · auto · undefinedpx` size chip is
          // not a size (a full-row tile has no height step).
          const fullRow = kind === 'flow' || kind === 'section';
          const sized = !fullRow;
          // The "On" chip: every switchable tile on the grid is on, and one click turns
          // it off (the tile then leaves the grid through the switch effect). Name
          // CONTAINS the visible text (WCAG 2.5.3); aria-pressed carries the state.
          const offChip = hasSwitch(id) ? (
            <button
              type="button"
              className={`lm-off lm-off--on${sized ? ' lm-off--abs' : ''}`}
              disabled={switching === id}
              aria-pressed="true"
              aria-label={`${labelFor(id)}: On`}
              title="Shown on the dashboard. Click to turn off."
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); turnOff(id); }}
            >
              On
            </button>
          ) : null;

          // Full-row tiles get a slim grab strip ABOVE their content: the handle lives
          // in the strip, not on top of the block's own inner cards (adops-audit
          // polish, 2026-07-12). The strip is part of the same drag surface.
          const bandStrip = () => (
            <div className="lm-flowstrip" onPointerDown={(e) => startMove(e, id, kind)}>
              <button
                type="button"
                className="lm-strip-handle"
                aria-label={`Move ${labelFor(id)} — arrow keys, Enter to confirm`}
                title="Drag to move · arrows to nudge"
                onPointerDown={(e) => startMove(e, id, kind)}
                onKeyDown={(e) => onHandleKey(e, id, kind)}
              >
                ≡
              </button>
              <span className="lm-strip-t">{labelFor(id)}</span>
              {offChip}
            </div>
          );

          // strip renders OUTSIDE the inert content wrapper and ABOVE the overlay —
          // its ≡ button must stay clickable/focusable (round-6: overlay swallowed it).
          let strip = null;
          let content;
          // A block in hand no longer collapses: it stays at full height, dimmed, so the page
          // does not jump under the pointer; the bar in the hand is DragOverlay's.
          if (kind === 'flow' && !dataHidden) {
            const C = FLOW_MEMO[id];
            strip = bandStrip();
            content = <C />;
          } else if (dataHidden) {
            strip = (
              <div className="lm-ph" onPointerDown={(e) => startMove(e, id, kind)}>
                <button
                  type="button"
                  className="lm-strip-handle"
                  aria-label={`Move ${labelFor(id)} — arrow keys, Enter to confirm`}
                  title="Drag to move · arrows to nudge"
                  onPointerDown={(e) => startMove(e, id, kind)}
                  onKeyDown={(e) => onHandleKey(e, id, kind)}
                >
                  ≡
                </button>
                <span className="lm-ph-t">{labelFor(id)}</span>
                {offChip}
                {/* Data-hidden only. A tile that is switched off is not rendered at
                    all (§1), so there is no second reason to spell here. */}
                — not currently shown (no data / out of window)
              </div>
            );
            content = null;
          } else {
            // Built-ins are ordinary canonical widget instances. A section-profile
            // widget is a band like a flow block, so it wears the same chrome — the
            // strip carries its name, its grip and its switch.
            if (kind === 'section') strip = bandStrip();
            const r = resolved.get(id);
            if (r?.state === 'missing') {
              // Layout mode arranges TILES; a tile whose library entry is gone is
              // still a member of the arrangement, so it keeps its slot and says
              // what it is instead of vanishing (which would silently move
              // everything below it). This is inert content like any other — the
              // cell's overlay stays the drag surface.
              content = (
                // --inline: the base .lm-ph is a STRIP and sits at z-index 6 to
                // clear the cell's drag overlay. This one is content INSIDE that
                // overlay's cell, so it drops back to auto — otherwise the tile
                // would refuse to drag exactly where its own text is.
                <div className="lm-ph lm-ph--inline">
                  <span className="lm-ph-t">{labelFor(id)}</span> — library entry unavailable
                </div>
              );
            } else {
              // The RESOLVED definition: a linked tile must arrange as the thing it
              // draws, not as an empty ref.
              const w = r?.widget || widgetById[id];
              if (!w) {
                // The widget left display.widgets while this session was open — a
                // drawer Discard after adding from the Library, or a delete from the
                // gallery. The TILE is still in the arrangement (the session owns its
                // geometry; gcLayout strips it at Save), so it says what it is, for
                // the same reason the `missing` branch above does. `null` content is
                // what it must NOT be: the cell collapses to zero height, its grip
                // and switch float over the tile below, and it cannot be dragged.
                content = (
                  <div className="lm-ph lm-ph--inline">
                    <span className="lm-ph-t">{labelFor(id)}</span> — no longer on this dashboard
                  </div>
                );
              } else {
                const explicitHeight = H_PX[tile.h];
                content = isFutureWidget(w) ? (
                  <WidgetFrame widget={w} preview><WidgetNeedsNewerApp /></WidgetFrame>
                ) : (
                  <ReportWidget
                    widget={w}
                    preview
                    {...(explicitHeight === undefined ? {} : { heightPx: explicitHeight })}
                  />
                );
              }
            }
          }

          const c = KIND_CONSTRAINTS[kind];
          // The chip states a HEIGHT STEP and its pixels. A tile whose height is 'auto'
          // (a KPI, a band) has neither, and H_PX has no entry for it — so it says the
          // width alone rather than "w12 · auto · undefinedpx".
          const sizeChip = sized && tile.h && H_PX[tile.h]
            ? `w${tile.w} · ${tile.h} · ${H_PX[tile.h]}px`
            : `w${tile.w}`;

          return (
            <div
              key={id}
              data-tile-id={id}
              ref={(el) => { cellRefs.current[id] = el; }}
              className={`dash-cell lm-cell${stretch.has(id) ? ' dash-cell--stretch' : ''}${selected.has(id) ? ' lm-cell--sel' : ''}${lifted ? ' lm-cell--lifted' : ''}${dimmed ? ' lm-cell--home' : ''}${isResized ? ' lm-cell--resizing' : ''}${editable ? '' : ' lm-cell--paused'}`}
              style={{
                gridColumn: `${tile.x + 1} / span ${tile.w}`,
                gridRow: `${tile.y + 1}`,
              }}
            >
              {strip}
              {content != null && <div className="lm-content" inert="">{content}</div>}
              {/* inert overlay = the drag surface (content can't be mis-clicked) */}
              <div
                className="lm-overlay"
                onPointerDown={(e) => startMove(e, id, kind)}
                title="Drag to move"
              />
              {/* Sized tiles have no strip: the chip is absolute, bottom-LEFT (the handle
                  owns top-right, the grip and size chip bottom-right). */}
              {sized && offChip}
              {/* A band's handle is in its strip; a second one here would be two grips
                  on one tile. */}
              {!fullRow && (
                <button
                  type="button"
                  className="lm-handle"
                  aria-label={`Move ${labelFor(id)} — arrow keys, Enter to confirm`}
                  title="Drag to move · arrows to nudge"
                  onPointerDown={(e) => startMove(e, id, kind)}
                  onKeyDown={(e) => onHandleKey(e, id, kind)}
                >
                  ≡
                </button>
              )}
              {sized && (
                <>
                  {(isResized || (isDragged && lifted)) && (
                    <span className="lm-sizechip">{sizeChip}{isResized && drag.capped ? ' · max' : ''}</span>
                  )}
                  {c.hSteps || c.maxW > c.minW ? (
                    <div
                      className="lm-grip"
                      role="button"
                      tabIndex={0}
                      aria-label={`Resize ${labelFor(id)} — left/right arrows change width, up/down height`}
                      title="Resize — width snaps to columns, height to steps · arrows resize"
                      onPointerDown={(e) => startResize(e, id, kind)}
                      onFocus={() => onGripFocus(id)}
                      onKeyDown={(e) => onGripKey(e, id, kind)}
                    />
                  ) : null}
                </>
              )}
            </div>
          );
        })}
        {/* Every block switched off: the grid draws nothing, and a blank page under a
            hint bar reads as a broken mode. View mode says the same thing through
            EmptySheet (DashGrid); this is the arranging half of it, so it points at the
            switch rather than at the library, and says the places are not lost. */}
        {!entries.length && (
          <div className="dash-empty lm-empty">
            <h2 className="dash-empty-t">Nothing is switched on</h2>
            {/* Non-breaking spaces hold "Settings → Display" together: with plain ones
                the line can break after the arrow, leaving it dangling. */}
            <div className="dash-empty-h">
              There is nothing to arrange. Switch blocks back on in
              Settings&nbsp;&rarr;&nbsp;Display and they return to the places they hold here.
            </div>
          </div>
        )}
        {lassoRect && (
          <div
            className="lm-lasso"
            aria-hidden="true"
            style={{ left: lassoRect.x, top: lassoRect.y, width: lassoRect.w, height: lassoRect.h }}
          />
        )}
        {/* The landing mark, the carried bar and the edge pill (docs/2026-09-23-layout-drag.md):
            one layer above the carried card, clipped to the grid, never taking the pointer. */}
        <DragOverlay ref={overlayRef} />
      </div>

      <div className="sr-only" aria-live="polite">{liveMsg}</div>

      {confirm === 'reset' && (
        <ConfirmModal
          title="Reset layout to default?"
          message="Everything returns to the standard order. Custom widgets stay — they just move back to their default spots. Groups are removed too. Nothing is saved until you press Save layout."
          confirmLabel="Reset"
          confirmColor="var(--accent)"
          onConfirm={handleReset}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'cancel' && (
        <ConfirmModal
          title="Discard layout changes?"
          message="The rearrangement you made in this session will be lost."
          confirmLabel="Discard"
          onConfirm={onExit}
          onCancel={() => setConfirm(null)}
        />
      )}
      {/* Rename a group — the WidgetLinkMenu "Rename tile" idiom: one input in a
          ConfirmModal, Enter commits. Local until Save, like every group edit. */}
      {renaming && (
        <ConfirmModal
          title="Rename group"
          message="The name shows on the frame’s legend. Leave it empty for an unlabeled frame."
          confirmLabel="Rename"
          confirmColor="var(--accent)"
          onConfirm={doRenameGroup}
          onCancel={() => setRenaming(null)}
        >
          <input
            className="sp-inp sp-inp--sans" type="text" autoFocus maxLength={GROUP_LIMITS.title}
            value={renaming.title}
            placeholder="A name for this group"
            onChange={(e) => setRenaming((cur) => ({ ...cur, title: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doRenameGroup(); } }}
          />
        </ConfirmModal>
      )}
      {/* Share a group as a block / the arrangement as a layout (§6.4, T8) —
          the ONE dialog (ShareEntryDialog, shared with the Display tab's Groups
          section): name + optional description, the note always present, Share
          disabled while the name is blank, Enter commits under the same guard. */}
      {sharing && (
        <ShareEntryDialog
          mode={sharing.mode}
          name={sharing.name}
          description={sharing.description}
          busy={busyShare}
          onChange={(patch) => setSharing((cur) => ({ ...cur, ...patch }))}
          onShare={doShareEntry}
          onCancel={() => setSharing(null)}
        />
      )}
    </div>
  );
}
