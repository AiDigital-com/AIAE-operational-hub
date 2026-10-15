/**
 * The dashboard board: Pacing's own renderer on Pacing's own 12-column grid.
 *
 * The first version of this file stacked the tiles in document order and let each one size itself.
 * That is not what a pacing dashboard looks like: every widget carries a stored geometry (column,
 * span, height band) and a kind that CONSTRAINS it - a KPI is never full width, a section always is
 * - and the arrangement someone built is the whole point of the Layout work on the Pacing side.
 * Stacking threw all of it away, which is why the tiles came out the same width and ragged heights.
 *
 * So the pipeline here is the one `DashGrid.jsx` runs, through the modules that moved with it:
 *
 *   resolveLayout   - stored tiles + first-fit for anything new, clamped per kind
 *   switched-off    - dropped AFTER placement, so re-enabling restores the exact spot
 *   compactVertical - close the rows the dropped tiles left
 *   rowStretchIds   - which tiles fill their row's height
 *   groupBounds     - the frames, DERIVED from where the members actually landed
 *
 * The grid itself is CSS: `.dash-grid` with explicit `gridColumn`/`gridRow` per cell.
 *
 * ACTIONS. The ⋯ menu on a tile is the same set Pacing has, and it saves IMMEDIATELY - this
 * surface has no draft to fold into, unlike the settings drawer. Edit is the exception: it has a
 * draft to belong to, so it opens the drawer rather than an editor here.
 */
import type React from "react";
import { useMemo } from "react";
import { cn } from "../../../shared/style/cn";
// Moved JS from Pacing's SPA - typed by inference under `allowJs` (see ../spa/SOURCE.md).
import ReportWidgetUntyped from "../spa/report/ReportWidget.jsx";
import LineItemsTileUntyped, { SectionBoundary as SectionBoundaryUntyped } from "../spa/lineitems/LineItemsTile.jsx";
import LaunchPlanCardUntyped from "../spa/LaunchPlanCard.jsx";
import * as LaunchPlanUntyped from "../spa/launch-plan.js";
import { useDashboardStore } from "../spa/store.js";
import { WidgetTileMenu } from "./tile-menu";
import * as LayoutGridUntyped from "../spa/layout-grid.js";
import { tileSlot as tileSlotUntyped } from "../spa/tile-slots.js";
import { tileEnabled } from "./widget-tiles";
import type { PacingDisplayShape, PacingWidgetGroup, PacingWidgetInstance } from "../types";
import "./widget-engine.css";

/** Re-typed at the boundary: `allowJs` infers each parameter from its DEFAULT, so an optional
 *  callback declared `{ isOff = null }` infers as `null` and refuses the function it exists to take.
 *  The real contracts are in those modules' own docblocks. */
const { resolveLayout, compactVertical, widgetGridKind, H_PX, groupBounds, rowStretchIds } =
  LayoutGridUntyped as unknown as {
    resolveLayout: (
      display: unknown, registry: unknown[], liveIds: Set<string>,
      kindOf: (id: string) => string, tileSlot: (id: string) => number | null,
      opts: { isOff: (id: string) => boolean }
    ) => Array<{ id: string; tile: Tile; kind: string }>;
    compactVertical: (tiles: Record<string, Tile>) => Record<string, Tile>;
    widgetGridKind: (w: unknown, opts?: { futurePlaceholder?: boolean }) => string;
    H_PX: Record<string, number>;
    groupBounds: (tiles: Record<string, Tile>, ids: string[]) => (Tile & { rows: number }) | null;
    rowStretchIds: (tiles: Record<string, Tile>) => Set<string>;
  };
/**
 * Where an unplaced tile wants to sit on the page's one slot scale: a functional block's
 * `FLOW_SLOTS` entry (100 launchPlan · 400 alerts · 600 lineItems · 1100 journal), or the seed slot
 * behind a fixed Standard instance id. Pacing's own function, moved.
 */
const tileSlot = tileSlotUntyped as unknown as (id: string) => number | null;
/**
 * The page's four code-rendered sections, as flow tiles on this board - Pacing's FLOW_REGISTRY, in
 * its order. Each is full width and auto height, placed on the same slot scale as the widgets and
 * moving with a saved arrangement like any other tile.
 *
 *   - Launch Plan, Pacing's «Launch recommendations», above the hero. On the board only while its own
 *     `launchPlanMode` says so: before the flight starts, or a running flight with nothing delivered.
 *   - Alerts, under the summary widgets. The page computes them (filters move them), and hands the
 *     block in through `blocks`; with no alert to show it is not on the board at all.
 *   - Line Items, between the summary widgets and the charts. Draws its own card, ⋯ in its header.
 *   - Journal, last. Handed in through `blocks` like Alerts.
 *
 * A tile that is not on the board is dropped BEFORE the rows are compacted, so it keeps no empty
 * row behind; one switched off keeps its geometry, so switching it back on restores its place.
 */
const LAUNCH_PLAN_ID = "launchPlan";
const ALERTS_ID = "alerts";
const LINE_ITEMS_ID = "lineItems";
const JOURNAL_ID = "journal";
const FLOW_REGISTRY = [LAUNCH_PLAN_ID, ALERTS_ID, LINE_ITEMS_ID, JOURNAL_ID].map((id) => ({ id, kind: "flow" }));
const FLOW_IDS = new Set(FLOW_REGISTRY.map((r) => r.id));
/** The name a section's ⋯ is announced by - the same words its Page sections card uses. */
const FLOW_MENU_TITLES: Record<string, string> = {
  [LAUNCH_PLAN_ID]: "Launch Plan",
  [ALERTS_ID]: "Alerts",
  [LINE_ITEMS_ID]: "Line Items",
  [JOURNAL_ID]: "Journal",
};
const LineItemsTile = LineItemsTileUntyped as unknown as React.ComponentType<{ menu?: React.ReactNode }>;
const SectionBoundary = SectionBoundaryUntyped as unknown as React.ComponentType<{
  name: string;
  children: React.ReactNode;
}>;
const LaunchPlanCard = LaunchPlanCardUntyped as unknown as React.ComponentType;
const { launchPlanMode } = LaunchPlanUntyped as unknown as {
  launchPlanMode: (campaign: unknown, rowCount: number, today?: string | null) => string | null;
};
const ReportWidget = ReportWidgetUntyped as unknown as React.ComponentType<{
  widget: PacingWidgetInstance;
  menu?: React.ReactNode;
  heightPx?: number;
}>;

interface Tile {
  x: number;
  y: number;
  w: number;
  h: string | number;
}

export interface BoardActions {
  /** Open the settings drawer on this widget's editor. */
  onEdit: (widgetId: string) => void;
  /** Copy it beside the original. Saves at once. */
  onDuplicate: (widgetId: string) => void;
  /** Hide a tile - a widget or a page section - from the board without removing it from the pacing.
   *  Saves at once, through the switch's own lane. */
  onTurnOff: (tileId: string) => void;
  /** Remove it from this pacing. Saves at once. */
  onRemove: (widgetId: string) => void;
  /** Open the settings drawer on the Line Items block's own settings (Pacing `85d353c`). */
  onCustomizeLineItems?: () => void;
  /** True while a save is in flight, so the menu can grey itself out rather than queue clicks. */
  saving: boolean;
}

export function ReportBoard({
  display,
  actions,
  blocks,
}: {
  display: PacingDisplayShape;
  actions?: BoardActions;
  /** What the Alerts and Journal sections draw - built by the page, which holds what they need. A
   *  section handed nothing is not on the board. */
  blocks?: { alerts?: React.ReactNode; journal?: React.ReactNode };
}) {
  const widgets = useMemo(() => display.widgets ?? [], [display.widgets]);
  // The two the Launch Plan's own visibility reads (Pacing's FLOW_REGISTRY `visible`).
  const campaign = useDashboardStore((s: { campaign: unknown }) => s.campaign);
  const rowCount = useDashboardStore(
    (s: { facts?: { factsDaily?: unknown[] } }) => s.facts?.factsDaily?.length || 0
  ) as number;
  const launchPlanShown = !!launchPlanMode(campaign, rowCount);
  const alertsShown = blocks?.alerts != null;
  const journalShown = blocks?.journal != null;

  // Placement, then the switched-off drop, then the row remap - in that order, because a saved
  // layout is geometry for the WHOLE widget set: dropping first would let a hidden tile's
  // neighbours slide into its cell and never slide back when it is switched on again.
  const entries = useMemo(() => {
    const liveIds = new Set([...widgets.map((w) => w.id), ...FLOW_IDS]);
    const widgetById = Object.fromEntries(widgets.map((w) => [w.id, w]));
    // The kind comes off the stored INSTANCE, never off a resolved library entry: the grid sizes a
    // tile before anything is resolved, and a kind that arrived late would clamp a KPI as a chart
    // for one frame and then reflow. That is what `profile`/`kind` are denormalized onto the ref for.
    //
    // `futurePlaceholder: true` unconditionally, which is a deliberate widening of what Pacing does
    // with it. There it is reserved for a widget stored by a NEWER build, because on that side every
    // other stored widget is guaranteed a valid profile - dash-gate refuses one without. The guarantee
    // holds here too, and the escape is still worth taking for the case it does not: a profile this
    // build cannot size throws, and a throw inside a `useMemo` takes the WHOLE page down over one
    // tile. `unsupported` is the kind the grammar already carries for "cannot be sized here", so the
    // tile gets placeholder geometry and draws its own unsupported state, and the other tiles are
    // unaffected.
    // The try/catch is the outer half of the same thing: `widgetGridKind` refuses an unknown KIND
    // before it ever reaches the profile branch `futurePlaceholder` guards, so a widget stored by a
    // newer build - the case the flag exists for - still throws without it.
    const kindOf = (id: string) => {
      if (FLOW_IDS.has(id)) return "flow";
      try {
        return widgetGridKind(widgetById[id], { futurePlaceholder: true });
      } catch {
        return "unsupported";
      }
    };
    const placed = resolveLayout(display, FLOW_REGISTRY, liveIds, kindOf, tileSlot, {
      isOff: (id: string) => !tileEnabled(display, id),
    });

    // Data-hidden first, then switched off - Pacing's DashGrid order.
    const dataShown = (id: string) =>
      id === LAUNCH_PLAN_ID ? launchPlanShown
        : id === ALERTS_ID ? alertsShown
          : id === JOURNAL_ID ? journalShown
            : true;
    const shown = placed.filter((e) => dataShown(e.id) && tileEnabled(display, e.id));
    const compacted = compactVertical(Object.fromEntries(shown.map((e) => [e.id, e.tile])));
    return shown
      .map((e) => ({ ...e, tile: compacted[e.id] as Tile }))
      .sort((a, b) => a.tile.y - b.tile.y || a.tile.x - b.tile.x);
  }, [display, widgets, launchPlanShown, alertsShown, journalShown]);

  const stretch = useMemo(
    () => rowStretchIds(Object.fromEntries(entries.map((e) => [e.id, e.tile]))) as Set<string>,
    [entries]
  );

  /**
   * The group frames, derived from where the members actually landed rather than stored as tiles of
   * their own. A frame is SUPPRESSED while a non-member sits inside its bounds: a mat that visually
   * claims a stranger is a lie about the group, and that arrangement is reachable (a widget added
   * from the library can first-fit into a free cell inside a saved group's box).
   */
  const frames = useMemo(() => {
    const groups: PacingWidgetGroup[] = Array.isArray(display.groups) ? display.groups : [];
    if (!groups.length) return [];
    const tileById = Object.fromEntries(entries.map((e) => [e.id, e.tile]));
    return groups
      // `bg: 'none'` means the group exists for arrangement but draws no mat, no border and - with
      // no mat edge for it to sit on - no name either.
      .filter((g) => g.bg !== "none")
      .map((g) => ({ g, b: groupBounds(tileById, g.tileIds) as Tile & { rows: number } }))
      .filter(
        ({ g, b }) =>
          b &&
          entries.every(({ id, tile }) => {
            if (g.tileIds.includes(id)) return true;
            const inRows = tile.y >= b.y && tile.y <= b.y + b.rows - 1;
            const inCols = tile.x < b.x + b.w && b.x < tile.x + tile.w;
            return !(inRows && inCols);
          })
      );
  }, [display.groups, entries]);

  if (!entries.length) return null;

  return (
    <div className="dash-grid">
      {/* Frames FIRST: an unpositioned grid item paints in document order, so every cell after it
          draws over the mat instead of under it. */}
      {frames.map(({ g, b }) => (
        <div
          key={g.id}
          className={cn("grp-frame", `grp-${g.bg}`)}
          aria-hidden="true"
          style={{ gridColumn: `${b.x + 1} / span ${b.w}`, gridRow: `${b.y + 1} / ${b.y + b.rows + 1}` }}
        >
          {g.title && !g.hideTitle && <span className="grp-title">{g.title}</span>}
        </div>
      ))}
      {entries.map(({ id, tile }) => {
        const widget = widgets.find((w) => w.id === id);
        if (!widget && !FLOW_IDS.has(id)) return null;
        // A flow tile draws its own block and carries no widget and no stored height: `flow` is
        // always full width and auto height (layout-grid's SIZES table). Line Items' ⋯ sits in its
        // own card header; the other three have no frame to hold one, so theirs is a corner control
        // on the cell (`.dash-cell--menu`, Pacing's DashGrid `flowMenuFor`).
        const cornerMenu = FLOW_IDS.has(id) && id !== LINE_ITEMS_ID && actions
          ? <SectionMenu id={id} actions={actions} />
          : null;
        const explicitHeight = H_PX[String(tile.h)];
        return (
          <div
            key={id}
            data-tile-id={id}
            className={cn("dash-cell", cornerMenu && "dash-cell--menu", stretch.has(id) && "dash-cell--stretch")}
            style={{ gridColumn: `${tile.x + 1} / span ${tile.w}`, gridRow: `${tile.y + 1}` }}
          >
            {id === LAUNCH_PLAN_ID ? (
              <SectionBoundary name="LaunchPlanCard">
                <LaunchPlanCard />
              </SectionBoundary>
            ) : id === ALERTS_ID ? (
              <SectionBoundary name="AlertsBlock">{blocks?.alerts}</SectionBoundary>
            ) : id === JOURNAL_ID ? (
              <SectionBoundary name="JournalPanel">{blocks?.journal}</SectionBoundary>
            ) : id === LINE_ITEMS_ID ? (
              <LineItemsTile menu={actions ? <LineItemsMenu actions={actions} /> : null} />
            ) : (
              <ReportWidget
                widget={widget as PacingWidgetInstance}
                menu={actions ? <WidgetMenu widget={widget as PacingWidgetInstance} actions={actions} /> : null}
                {...(explicitHeight === undefined ? {} : { heightPx: explicitHeight })}
              />
            )}
            {cornerMenu}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The Line Items block's ⋯: Pacing's flow-block menu, Customize… and Turn off. Turn off is undone
 * from the switch on the Line Items card in Settings → Widgets → Page sections.
 */
function LineItemsMenu({ actions }: { actions: BoardActions }) {
  return (
    <WidgetTileMenu
      label="Block actions: Line Items"
      items={[
        {
          key: "customize",
          label: "Customize…",
          disabled: !actions.onCustomizeLineItems,
          onSelect: () => actions.onCustomizeLineItems?.(),
        },
        {
          key: "off",
          label: "Turn off",
          disabled: actions.saving,
          onSelect: () => actions.onTurnOff(LINE_ITEMS_ID),
        },
      ]}
    />
  );
}

/** A page section's ⋯: the one action that is true for it, Turn off (Pacing's `flowMenuFor`). */
function SectionMenu({ id, actions }: { id: string; actions: BoardActions }) {
  return (
    <WidgetTileMenu
      label={`Block actions: ${FLOW_MENU_TITLES[id] ?? id}`}
      items={[
        {
          key: "off",
          label: "Turn off",
          disabled: actions.saving,
          onSelect: () => actions.onTurnOff(id),
        },
      ]}
    />
  );
}

/** The ⋯ menu Pacing puts on every tile: same four actions, same order, this app's chrome. */
function WidgetMenu({
  widget,
  actions,
}: {
  widget: PacingWidgetInstance;
  actions: BoardActions;
}) {
  const title = widget.title?.trim() || "Untitled widget";
  return (
    <WidgetTileMenu
      label={`Widget actions: ${title}`}
      items={[
        { key: "edit", label: "Edit…", onSelect: () => actions.onEdit(widget.id) },
        {
          key: "dup",
          label: "Duplicate",
          disabled: actions.saving,
          onSelect: () => actions.onDuplicate(widget.id),
        },
        {
          key: "off",
          label: "Turn off",
          disabled: actions.saving,
          onSelect: () => actions.onTurnOff(widget.id),
        },
        {
          key: "del",
          label: "Delete",
          danger: true,
          disabled: actions.saving,
          onSelect: () => actions.onRemove(widget.id),
        },
      ]}
    />
  );
}
