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
import LineItemsTileUntyped from "../spa/lineitems/LineItemsTile.jsx";
import { WidgetTileMenu } from "./tile-menu";
import * as LayoutGridUntyped from "../spa/layout-grid.js";
import * as StdCatalogUntyped from "../spa/std-catalog.js";
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
 * Where an unplaced tile wants to sit on the page's one slot scale.
 *
 * Pacing answers this from two halves - a functional block's `FLOW_SLOTS` entry, or the seed slot
 * behind a fixed Standard instance id. The Hub's board carries NO functional blocks (its alerts,
 * breakdown, journal and tables are fixed sections of the page, outside this grid), so only the
 * second half can ever answer, and `spa/tile-slots.js` is not used: its flow lookup reads
 * `FLOW_SLOTS`, which our `dash-blocks.js` does not carry - that constant arrived on the Pacing side
 * with the sections cutover we have deliberately not adopted.
 */
const { seedSlotOf } = StdCatalogUntyped as unknown as {
  seedSlotOf: (id: string) => number | null;
};
/**
 * The ONE functional block this board carries (2026-10-05).
 *
 * Line Items used to be a fixed section of the page, below the whole grid — so it sat under the
 * charts, with Breakdown and the journal, and there was no way to read a line item's figures next
 * to the summary widgets they roll up from. It is a `flow` tile now: full width, auto height,
 * placed on the same slot scale as everything else, and it moves with a saved arrangement like any
 * other tile.
 *
 * 600 is Pacing's own slot for it — the scale reads 200 hero · 300 Finance · 600 lineItems ·
 * 700+ charts — so with no saved layout it lands exactly where Pacing puts it: under the summary
 * widgets, above the charts.
 *
 * The rest of the page's sections (alerts, breakdown, journal, the daily table) stay outside the
 * grid. Nothing else about this board assumes a widget: `resolveLayout` already takes a registry of
 * flow ids and `clampTile` already sizes the kind — the Hub simply passed neither.
 */
const LINE_ITEMS_ID = "lineItems";
const FLOW_REGISTRY = [{ id: LINE_ITEMS_ID, kind: "flow" }];
const FLOW_SLOTS: Record<string, number> = { [LINE_ITEMS_ID]: 600 };
const tileSlot = (id: string) => (id in FLOW_SLOTS ? FLOW_SLOTS[id] : seedSlotOf(id));
const LineItemsTile = LineItemsTileUntyped as unknown as React.ComponentType;
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
  /** Hide it from the board without removing it from the pacing. Saves at once. */
  onTurnOff: (widgetId: string) => void;
  /** Remove it from this pacing. Saves at once. */
  onRemove: (widgetId: string) => void;
  /** True while a save is in flight, so the menu can grey itself out rather than queue clicks. */
  saving: boolean;
}

export function ReportBoard({
  display,
  actions,
}: {
  display: PacingDisplayShape;
  actions?: BoardActions;
}) {
  const widgets = useMemo(() => display.widgets ?? [], [display.widgets]);

  // Placement, then the switched-off drop, then the row remap - in that order, because a saved
  // layout is geometry for the WHOLE widget set: dropping first would let a hidden tile's
  // neighbours slide into its cell and never slide back when it is switched on again.
  const entries = useMemo(() => {
    const liveIds = new Set([...widgets.map((w) => w.id), LINE_ITEMS_ID]);
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
      if (id === LINE_ITEMS_ID) return "flow";
      try {
        return widgetGridKind(widgetById[id], { futurePlaceholder: true });
      } catch {
        return "unsupported";
      }
    };
    const placed = resolveLayout(display, FLOW_REGISTRY, liveIds, kindOf, tileSlot, {
      isOff: (id: string) => !tileEnabled(display, id),
    });

    const shown = placed.filter((e) => tileEnabled(display, e.id));
    const compacted = compactVertical(Object.fromEntries(shown.map((e) => [e.id, e.tile])));
    return shown
      .map((e) => ({ ...e, tile: compacted[e.id] as Tile }))
      .sort((a, b) => a.tile.y - b.tile.y || a.tile.x - b.tile.x);
  }, [display, widgets]);

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
        // The one flow tile draws its own block and carries no widget, no ⋯ menu and no stored
        // height: `flow` is always full width and auto height (layout-grid's SIZES table).
        if (!widget && id !== LINE_ITEMS_ID) return null;
        const explicitHeight = H_PX[String(tile.h)];
        return (
          <div
            key={id}
            data-tile-id={id}
            className={cn("dash-cell", stretch.has(id) && "dash-cell--stretch")}
            style={{ gridColumn: `${tile.x + 1} / span ${tile.w}`, gridRow: `${tile.y + 1}` }}
          >
            {id === LINE_ITEMS_ID ? (
              <LineItemsTile />
            ) : (
              <ReportWidget
                widget={widget as PacingWidgetInstance}
                menu={actions ? <WidgetMenu widget={widget as PacingWidgetInstance} actions={actions} /> : null}
                {...(explicitHeight === undefined ? {} : { heightPx: explicitHeight })}
              />
            )}
          </div>
        );
      })}
    </div>
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
