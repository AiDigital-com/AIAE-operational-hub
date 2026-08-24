import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "../../style/cn";
import { ExpandIcon, FilterIcon, SortIcon } from "../icons/icons";
import { COLUMN_RESIZE_STEP } from "./data-table-hooks";
import "./data-table.css";

/** How tall one row is assumed to be before it has been measured. Matches the density set in
 *  data-table.css (6px vertical padding + one 13.5px line), so nothing needs correcting unless a cell
 *  wraps. */
const DEFAULT_ROW_HEIGHT = 30;

/** How many rows beyond the visible window stay mounted, so a fast scroll does not show blank space. */
const ROW_OVERSCAN = 8;

/** How near the scroll container's left/right edge a column drag has to get before the table starts
 *  autoscrolling under it - wide enough to find without hunting for a hairline, narrow enough that most
 *  of a wide table stays free to actually drop into. */
export const COLUMN_DRAG_AUTOSCROLL_ZONE_PX = 48;

/** The fastest the table autoscrolls during a column drag, reached only right at the scroll container's
 *  own edge - scaled down elsewhere in the zone above so the scroll doesn't lurch the moment it starts. */
export const COLUMN_DRAG_AUTOSCROLL_MAX_PX_PER_FRAME = 16;

/**
 * Which boundary between rendered columns a cursor at viewport x `x` is nearest, given each column's
 * current header rect in on-screen (left-to-right) order.
 *
 * The candidate column is whichever one's own horizontal span the cursor sits inside - clamped to the
 * last one once the cursor has scrolled past the table's own right edge - and the cursor's side of THAT
 * column's own midpoint decides whether the boundary lands before or after it. Only `x` matters: the
 * header cells span the same horizontal range the body cells beneath them do, so a cursor tracked over a
 * data row rather than the header resolves exactly the same boundary - which is the fix for a drag only
 * ever registering over the header row.
 *
 * @param rects the header cells' current bounding rects, in render order - the dragged column's own
 *              header still counted, so the boundary this returns is against that order, not it removed
 * @param x     the cursor's current viewport x
 * @returns a boundary in `[0, rects.length]`
 */
export function resolveDropBoundary(rects: readonly { left: number; right: number }[], x: number): number {
  if (rects.length === 0) return 0;
  let candidate = rects.length - 1;
  for (let i = 0; i < rects.length; i += 1) {
    if (x < rects[i].right) {
      candidate = i;
      break;
    }
  }
  const midpoint = (rects[candidate].left + rects[candidate].right) / 2;
  return x < midpoint ? candidate : candidate + 1;
}

/** How fast to autoscroll for a given depth into the edge zone - proportional, capped at
 *  {@link COLUMN_DRAG_AUTOSCROLL_MAX_PX_PER_FRAME} right at the scroll container's own edge. */
function columnDragAutoscrollSpeed(depthIntoZone: number): number {
  const depth = Math.min(depthIntoZone, COLUMN_DRAG_AUTOSCROLL_ZONE_PX);
  return (depth / COLUMN_DRAG_AUTOSCROLL_ZONE_PX) * COLUMN_DRAG_AUTOSCROLL_MAX_PX_PER_FRAME;
}

/** Scrolls the table's own horizontal scroll container when the cursor sits inside
 *  {@link COLUMN_DRAG_AUTOSCROLL_ZONE_PX} of either edge during a column drag, faster the closer to the
 *  edge - so a column can be dragged all the way from one end of a wide table to the other without
 *  letting go and starting over partway. */
function runColumnDragAutoscroll(container: HTMLElement, x: number): void {
  const rect = container.getBoundingClientRect();
  const fromLeft = x - rect.left;
  const fromRight = rect.right - x;
  if (fromLeft >= 0 && fromLeft < COLUMN_DRAG_AUTOSCROLL_ZONE_PX) {
    container.scrollLeft -= columnDragAutoscrollSpeed(COLUMN_DRAG_AUTOSCROLL_ZONE_PX - fromLeft);
  } else if (fromRight >= 0 && fromRight < COLUMN_DRAG_AUTOSCROLL_ZONE_PX) {
    container.scrollLeft += columnDragAutoscrollSpeed(COLUMN_DRAG_AUTOSCROLL_ZONE_PX - fromRight);
  }
}

/**
 * Where a dragged column should land, named by one of the OTHER columns rather than by a raw position -
 * so a caller matching it back to its own (possibly differently-scoped) id list always means the same
 * thing: land next to this id, on this side of it.
 *
 * A boundary sitting on either side of the dragged column's own current slot names the dragged column
 * itself as the neighbour, which every caller reads back as a no-op (its own id is never among "the
 * columns other than it").
 *
 * @param ids          every rendered column's id, in on-screen order - the same order `boundary` was
 *                     resolved against
 * @param draggedIndex the dragged column's own index within `ids`
 * @param boundary     the boundary from {@link resolveDropBoundary}, against that same order
 */
function columnDropTarget(
  ids: readonly string[],
  draggedIndex: number,
  boundary: number
): { neighborId: string; side: "before" | "after" } {
  const before = boundary <= draggedIndex;
  const neighborIndex = before ? boundary : boundary - 1;
  return { neighborId: ids[neighborIndex], side: before ? "before" : "after" };
}

/** Whether the column at `colIndex` - its position in a rendered order - is the one currently being
 *  dragged, so its cell should fade. Applied identically to a column's header cell, its pinned/totals
 *  cell and every visible body cell, so the eye can find the column being carried wherever it renders,
 *  not only in the header it was picked up from. `draggedColumnIndex` is `-1` while no drag is in
 *  progress, which this can never equal a real `colIndex`. */
export function columnDragCellClass(colIndex: number, draggedColumnIndex: number): string | false {
  return colIndex === draggedColumnIndex && "data-table__col--dragging";
}

/** Whether the column at `colIndex` carries the insertion line marking where the dragged column would
 *  land if released now - drawn on the leading edge of the column the boundary sits before, except for
 *  the one boundary with no column of its own to sit before (past every rendered column), which draws on
 *  the trailing edge of the last column instead. `dropBoundaryIndex` is `-1` while no drag is in
 *  progress. Derived from `colIndex`/`columnCount` rather than any fixed ceiling, so it holds for however
 *  many columns a table actually renders. */
export function columnDropCellClass(colIndex: number, dropBoundaryIndex: number, columnCount: number): string | false {
  if (dropBoundaryIndex < 0) return false;
  if (dropBoundaryIndex >= columnCount) return colIndex === columnCount - 1 && "data-table__col--drop-after";
  return colIndex === dropBoundaryIndex && "data-table__col--drop-before";
}

/** The reorder callbacks a table offers through its column headers. Both `onReorder` and this option
 *  bundle are optional - a table with no arrangement to persist offers no reordering at all. */
export interface DataTableColumnReorder {
  /** Moves a column to sit immediately before or after another, named by id. The caller decides whether
   *  the move is allowed - a two-group table may refuse a metric dropped among its dimensions - and
   *  where the resulting order is kept; this component holds no order of its own. */
  onReorder: (fromId: string, toId: string, side: "before" | "after") => void;
  /** Keyboard equivalent of dragging one slot left or right. */
  onNudge?: (columnId: string, offset: -1 | 1) => void;
  /** Off while the table is being edited: a table full of inputs is not a table to rearrange, and a
   *  stray drag mid-edit would move a column out from under a half-typed value. */
  disabled?: boolean;
}

/**
 * One column of a data table.
 *
 * Everything past `id` and `label` is optional on purpose: the two current consumers describe their
 * columns very differently - one has dimensions and metrics with aggregations, the other a fixed
 * template schema with a calculated column that has no source field at all - and a descriptor that
 * insisted on more would force one of them to invent values it does not have.
 */
export interface DataTableColumn {
  /** Identity for widths, order, sort and cell keys. */
  id: string;
  label: string;
  /** Tooltip on the header label, when the label alone does not say enough. */
  title?: string;
  /** The consumer's own class for this column, applied identically to the header, the pinned row and -
   *  by the consumer, from the same `column.className` - its body cells. This is where per-column
   *  alignment and min-widths live, because what a column holds is the consumer's knowledge. */
  className?: string;
  /** A short badge inside the sort button, after the label - an aggregation, typically. */
  agg?: string;
  /** Whether this column's header offers sorting. */
  sortable?: boolean;
  /** Whether this column's header offers a filter button. */
  filterable?: boolean;
  /** Whether this column's filter is currently narrowing the rows, which lights its button. */
  filtered?: boolean;
}

/**
 * Pins a column to a dragged width.
 *
 * The stylesheet's own min/max have to be overridden together, or an auto-layout table keeps sizing the
 * column to its content and the drag appears to do nothing.
 *
 * @param width the width in px, or undefined to leave the column to the stylesheet
 * @return the style to spread onto the cell, or undefined
 */
export function columnStyle(width: number | undefined): CSSProperties | undefined {
  return width == null ? undefined : { width, minWidth: width, maxWidth: width };
}

interface ColumnResizerProps {
  columnId: string;
  label: string;
  /** The width already set for this column, if any - the base the next gesture moves from. */
  width: number | undefined;
  onResize: (columnId: string, width: number) => void;
}

/**
 * The drag handle on a column's trailing edge.
 *
 * Also a real `separator` the arrow keys move: a pointer drag is the obvious gesture but the only one a
 * mouse can make, and a column too narrow to read is exactly the situation a keyboard user is left stuck
 * in. Both paths resize by setting an absolute width measured from the header cell, so the two cannot
 * drift apart.
 */
function ColumnResizer({ columnId, label, width, onResize }: ColumnResizerProps) {
  const handleRef = useRef<HTMLSpanElement>(null);

  /** Where the next gesture starts from: the width already set, or the rendered one until then. */
  function baseWidth(): number | null {
    if (width != null) return width;
    const cell = handleRef.current?.closest("th");
    return cell == null ? null : cell.getBoundingClientRect().width;
  }

  function onPointerDown(event: React.PointerEvent<HTMLSpanElement>) {
    const startWidth = baseWidth();
    if (startWidth == null) return;
    event.preventDefault();
    const startX = event.clientX;
    const move = (moved: PointerEvent) => onResize(columnId, startWidth + (moved.clientX - startX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLSpanElement>) {
    const step = event.key === "ArrowRight" ? COLUMN_RESIZE_STEP : event.key === "ArrowLeft" ? -COLUMN_RESIZE_STEP : 0;
    if (step === 0) return;
    event.preventDefault();
    const from = baseWidth();
    if (from != null) onResize(columnId, from + step);
  }

  return (
    <span
      ref={handleRef}
      className="data-table__resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}

/** One narrowing currently in force, listed above the table. */
export interface DataTableChip {
  id: string;
  label: string;
  /** What the column was narrowed to, in as few words as it takes. */
  summary: string;
  clear: () => void;
}

interface DataTableChipsProps {
  chips: readonly DataTableChip[];
  /** Off while the table is being edited, when clearing a filter would re-read the rows under the edit. */
  disabled?: boolean;
}

/**
 * Every narrowing currently in force, listed above the table rather than only inside the column header it
 * was set from - so what the rows have been reduced to is legible without opening three popovers to find
 * out, and clearable without opening them either.
 *
 * A sibling of the table rather than part of it, because it sits above whatever the consumer puts between
 * its own controls and the table.
 */
export function DataTableChips({ chips, disabled = false }: DataTableChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div className="data-table__chips">
      <span className="data-table__chips-lead">Showing only</span>
      {chips.map((chip) => (
        <span key={chip.id} className="data-table__chip">
          {chip.label}: {chip.summary}
          <button
            type="button"
            className="data-table__chip-clear"
            aria-label={`Clear the ${chip.label} filter`}
            onClick={chip.clear}
            disabled={disabled}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

interface DataTableViewControlsProps {
  /** How many rows the table holds in total, across every page. */
  totalRows: number;
  /** How many of them have loaded so far. */
  loadedRows: number;
  /** Said instead of a count while the first page is still in flight. */
  pendingLabel?: string;
  isPending?: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
}

/**
 * How the table is shown, as opposed to what the page does to its data.
 *
 * A sibling of the table for the same reason as the chips: both consumers put it in a row of their own
 * alongside controls this component knows nothing about.
 */
export function DataTableViewControls({
  totalRows,
  loadedRows,
  pendingLabel = "Loading rows…",
  isPending = false,
  expanded,
  onToggleExpanded,
}: DataTableViewControlsProps) {
  return (
    <div className="data-table__controls">
      <span className="data-table__row-count">
        {isPending
          ? pendingLabel
          : totalRows === 0
            ? "No rows"
            : loadedRows < totalRows
              ? `${loadedRows.toLocaleString("en-US")} of ${totalRows.toLocaleString("en-US")} rows`
              : `${totalRows.toLocaleString("en-US")} row${totalRows === 1 ? "" : "s"}`}
      </span>
      <button type="button" className="button button--ghost button--sm" aria-pressed={expanded} onClick={onToggleExpanded}>
        <ExpandIcon />
        {expanded ? "Collapse table" : "Expand table"}
      </button>
    </div>
  );
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn[];
  rows: readonly T[];
  /** Identity of a row across renders. Required rather than defaulted to the index: a table that
   *  prepends rows would remount its whole tail mid-edit, and only the consumer knows what makes one of
   *  its rows the same row. */
  getRowKey: (row: T, index: number) => string;
  /** The row's `<td>`s - cells, not a row: the `<tr>` carries the virtualizer's measurement ref.
   *  `draggedColumnIndex`/`dropBoundaryIndex` are the same two numbers the header itself renders from
   *  (see `DataTableColumnReorder`), `-1` while no drag is in progress - passed as plain numbers, not an
   *  object, so a consumer's own memoized row component only re-renders on an actual boundary crossing
   *  (a handful of times per drag) rather than on every animation frame. */
  renderCells: (row: T, index: number, draggedColumnIndex: number, dropBoundaryIndex: number) => ReactNode;
  /** Column widths the user has dragged, from `useColumnWidths`. */
  columnWidths: Record<string, number>;
  onResizeColumn: (columnId: string, width: number) => void;

  /** The column the rows are sorted by, in the consumer's own vocabulary, compared case-insensitively
   *  against each column's id. */
  sortColumnId?: string | null;
  sortDirection?: "asc" | "desc";
  onSort?: (columnId: string) => void;
  /** Sorting is off while the rows are being re-read, and while the table is being edited. */
  sortDisabled?: boolean;

  onOpenFilter?: (columnId: string, anchor: HTMLElement) => void;
  /** Which column's filter popover is open, for the button's `aria-expanded`. */
  openFilterColumnId?: string | null;
  filterDisabled?: boolean;

  /** Offers drag-to-reorder (and its keyboard equivalent) on every column header. Absent means the table
   *  cannot be rearranged at all. */
  columnReorder?: DataTableColumnReorder;

  /** The pinned first body row - totals, typically. Its height is measured, so it is rendered here
   *  rather than handed over as opaque markup: the virtualizer's coordinate space starts below it.
   *  Receives the same `draggedColumnIndex`/`dropBoundaryIndex` pair `renderCells` does. */
  renderPinnedCells?: (draggedColumnIndex: number, dropBoundaryIndex: number) => ReactNode;

  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  /** Shown inside the sentinel row while the next page is in flight. */
  loadingMoreSlot?: ReactNode;

  /** A row shown in place of data - "loading", "nothing matched", an error. A row of the table rather
   *  than a block laid over it, which read as a stray bar drawn across an empty table. */
  statusRow?: ReactNode;

  /** Laid over the table while the rows on screen are being replaced. */
  overlay?: ReactNode;

  /** Widens the table to the content column's edges. The consumer stamps its own root modifier from the
   *  same flag to hide the chrome around it. */
  expanded?: boolean;
  className?: string;
  /** Assumed row height before measurement. Only worth setting for a table whose rows are not one line. */
  estimateRowHeight?: number;
}

/**
 * The scrollable data grid: a sticky header that sorts, filters, resizes and reorders, an optional
 * pinned totals row, windowed body rows, and a scroll sentinel that asks for the next page.
 *
 * It owns every element from the wrapper down to each `<tr>`, and none of the content inside them. That
 * seam is not a preference - ten of the thirteen props the Reporting tab's row component needs are its
 * own (staged edits, validation state, inherited dimensions), so a table that rendered cells would have
 * to know about all of them. The consumer keeps its own memoized row renderer and passes cells up.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  renderCells,
  columnWidths,
  onResizeColumn,
  sortColumnId = null,
  sortDirection = "asc",
  onSort,
  sortDisabled = false,
  onOpenFilter,
  openFilterColumnId = null,
  filterDisabled = false,
  columnReorder,
  renderPinnedCells,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
  loadingMoreSlot,
  statusRow,
  overlay,
  expanded = false,
  className,
  estimateRowHeight = DEFAULT_ROW_HEIGHT,
}: DataTableProps<T>) {
  const columnCount = columns.length;

  // The sticky <thead> and the pinned row sit above the windowed content inside the same scroll
  // container, so `scrollMargin` offsets the virtualizer's maths by their measured height. Getting this
  // wrong opens a gap exactly that tall under the pinned row and fires the sentinel at the wrong offset.
  const scrollRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const pinnedRowRef = useRef<HTMLTableRowElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // The header's measured height, published as a custom property so the pinned row sticks exactly
  // beneath it. It used to be a hardcoded 43px against a header that renders at 49px, which left the
  // pinned row's top 6px behind the header - measuring it is the only way the two cannot disagree.
  const [headHeight, setHeadHeight] = useState(0);
  useLayoutEffect(() => {
    const measuredHead = theadRef.current?.offsetHeight ?? 0;
    setHeadHeight(measuredHead);
    setScrollMargin(measuredHead + (pinnedRowRef.current?.offsetHeight ?? 0));
  }, [columns]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: ROW_OVERSCAN,
    scrollMargin,
    getItemKey: (index) => getRowKey(rows[index], index),
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start - scrollMargin : 0;
  const paddingBottom =
    virtualRows.length > 0 ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;

  // Read through a ref rather than as a dependency: `fetchNextPage` takes a new identity after every
  // fetch, so depending on it rebuilt the observer, which fired on an already-visible sentinel, which
  // fetched again.
  const fetchNextPageRef = useRef(fetchNextPage);
  fetchNextPageRef.current = fetchNextPage;
  const sentinelRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage || isFetchingNextPage) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchNextPageRef.current?.();
      },
      { root: scrollRef.current, rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage]);

  // The column the pointer is carrying, and the boundary it would land on - resolved from cursor
  // geometry each animation frame (see the effect below), against the full rendered order, rather than
  // from whichever header the pointer happens to be vertically over. That is the fix for a drag only
  // ever registering over the header row: vertical position stops mattering at all.
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);
  const [dropBoundary, setDropBoundary] = useState<number | null>(null);
  // "Latest value" refs, so the window listeners and the geometry effect below can each bind once per
  // drag instead of re-binding (or re-running their setup) on every frame or every pointer event.
  const draggingColumnIdRef = useRef<string | null>(null);
  draggingColumnIdRef.current = draggingColumnId;
  const dropBoundaryRef = useRef<number | null>(null);
  dropBoundaryRef.current = dropBoundary;
  const columnReorderRef = useRef(columnReorder);
  columnReorderRef.current = columnReorder;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  // The raw cursor position, written on every pointermove without touching React state at all - the
  // geometry effect below is what turns this into a render, once per animation frame rather than once
  // per event (pointermove fires far more often than the screen repaints).
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  /** Picks a column up. The drop boundary starts empty, so a press with no movement - no animation
   *  frame ever resolving one - changes nothing. */
  const startColumnDrag = useCallback((columnId: string, x: number, y: number) => {
    pointerRef.current = { x, y };
    setDraggingColumnId(columnId);
    setDropBoundary(null);
  }, []);

  /** Starts a drag from a header cell's own pointerdown, unless the press actually landed on one of the
   *  cell's interactive children - the sort button, the filter button, the resize handle - which have
   *  their own gestures and must not also pick the column up. */
  const onHeaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLTableCellElement>, columnId: string) => {
      if (!columnReorder || columnReorder.disabled) return;
      if ((event.target as HTMLElement).closest("button, input, .data-table__resizer")) return;
      event.preventDefault();
      startColumnDrag(columnId, event.clientX, event.clientY);
    },
    [columnReorder, startColumnDrag]
  );

  const onHeaderKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTableCellElement>, columnId: string) => {
      const onNudge = columnReorderRef.current?.onNudge;
      if (!columnReorder || columnReorder.disabled || !event.altKey || !onNudge) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      onNudge(columnId, event.key === "ArrowLeft" ? -1 : 1);
    },
    [columnReorder]
  );

  // Tracks the drag for as long as one is in progress: pointermove only ever updates the plain ref
  // above (see the geometry effect below for why), release commits whatever boundary that effect last
  // resolved, and Escape abandons the move instead of committing it. Bound on `window`, not the table,
  // because a pointerup or a released Escape the window never hears would leave a column stuck to the
  // cursor - the pointer is regularly outside the table by the time it lets go.
  useEffect(() => {
    if (draggingColumnId == null) return undefined;
    const move = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };
    const clear = () => {
      setDraggingColumnId(null);
      setDropBoundary(null);
      pointerRef.current = null;
    };
    const commit = () => {
      const boundary = dropBoundaryRef.current;
      const reorder = columnReorderRef.current;
      const fromId = draggingColumnIdRef.current;
      if (boundary != null && reorder && fromId != null) {
        const ids = columnsRef.current.map((column) => column.id);
        const draggedIndex = ids.indexOf(fromId);
        if (draggedIndex !== -1) {
          const target = columnDropTarget(ids, draggedIndex, boundary);
          if (target.neighborId !== fromId) reorder.onReorder(fromId, target.neighborId, target.side);
        }
      }
      clear();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", commit);
    window.addEventListener("pointercancel", clear);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", commit);
      window.removeEventListener("pointercancel", clear);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [draggingColumnId]);

  // The drag's own geometry, resolved once per animation frame rather than once per `pointermove` -
  // pointermove fires far more often than the screen repaints, and each resolution reads every header
  // cell's current bounding rect, which forces layout. Running from a frame rather than the event also
  // means the boundary keeps resolving while `runColumnDragAutoscroll` scrolls the table underneath an
  // otherwise-stationary cursor, which a purely event-driven read never would.
  useEffect(() => {
    if (draggingColumnId == null) return undefined;
    let frame = requestAnimationFrame(tick);
    function tick() {
      const container = scrollRef.current;
      const thead = theadRef.current;
      const pointer = pointerRef.current;
      if (container && thead && pointer) {
        const rects = Array.from(thead.querySelectorAll<HTMLElement>("th")).map((cell) =>
          cell.getBoundingClientRect()
        );
        const boundary = resolveDropBoundary(rects, pointer.x);
        if (boundary !== dropBoundaryRef.current) setDropBoundary(boundary);
        runColumnDragAutoscroll(container, pointer.x);
      }
      frame = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(frame);
  }, [draggingColumnId]);

  // The dragged column's own position in `columns`, and the resolved drop boundary against that same
  // order - both `-1` while no drag is in progress. Handed to the header below and out to the consumer's
  // `renderCells`/`renderPinnedCells` as plain `number`s rather than a fresh object each render: either
  // number only changes a handful of times per drag - when the cursor crosses a column boundary, not
  // once per animation frame - so reconciling a consumer's memoized row on that change is negligible.
  const draggedColumnIndex = useMemo(
    () => (draggingColumnId == null ? -1 : columns.findIndex((column) => column.id === draggingColumnId)),
    [columns, draggingColumnId]
  );
  const dropBoundaryIndex = dropBoundary ?? -1;

  return (
    <div
      className={cn("data-table", expanded && "data-table--expanded", className)}
      // Left to the stylesheet's own fallback until the header has been measured, so the first paint is
      // never a pinned row stuck at zero. Set here rather than on the table so the overlay beside it reads
      // the same figure.
      style={headHeight > 0 ? ({ "--data-table-head-height": `${headHeight}px` } as CSSProperties) : undefined}
    >
      <div className="data-table__scroll" ref={scrollRef}>
        <table className="data-table__tbl">
          <thead ref={theadRef}>
            <tr>
              {columns.map((column, columnIndex) => {
                const isSorted = sortColumnId != null && sortColumnId.toLowerCase() === column.id.toLowerCase();
                const width = columnWidths[column.id];
                const label = (
                  <span
                    className={cn("data-table__label", width != null && "data-table__label--sized")}
                    title={column.title ?? column.label}
                  >
                    {column.label}
                  </span>
                );
                const agg = column.agg ? <span className="data-table__agg">{column.agg}</span> : null;
                const sortSlot = column.sortable ? (
                  <button
                    type="button"
                    className={cn("data-table__sort", isSorted && "data-table__sort--active")}
                    onClick={() => onSort?.(column.id)}
                    disabled={sortDisabled}
                  >
                    {label}
                    {agg}
                    <SortIcon active={isSorted ? sortDirection : undefined} />
                  </button>
                ) : agg ? (
                  // A column may state how it aggregates without offering to sort - a rate the consumer
                  // computes from two other columns has no field the server could order by.
                  <span className="data-table__label-row">
                    {label}
                    {agg}
                  </span>
                ) : (
                  label
                );
                const filterSlot = column.filterable ? (
                  <div className="data-table__filter-wrap">
                    <button
                      type="button"
                      className={cn("data-table__filter-btn", column.filtered && "data-table__filter-btn--active")}
                      aria-label={`Filter ${column.label}`}
                      aria-expanded={openFilterColumnId === column.id}
                      disabled={filterDisabled}
                      onClick={(event) => onOpenFilter?.(column.id, event.currentTarget)}
                    >
                      <FilterIcon />
                    </button>
                  </div>
                ) : null;
                return (
                  <th
                    key={column.id}
                    className={cn(
                      "data-table__col",
                      column.className,
                      columnDragCellClass(columnIndex, draggedColumnIndex),
                      columnDropCellClass(columnIndex, dropBoundaryIndex, columnCount)
                    )}
                    style={columnStyle(width)}
                    // Focusable only once reordering is offered: Alt+Arrow needs a focus target to fire
                    // on, and a `<th>` carries none of its own.
                    tabIndex={columnReorder ? 0 : undefined}
                    onPointerDown={columnReorder ? (event) => onHeaderPointerDown(event, column.id) : undefined}
                    onKeyDown={columnReorder ? (event) => onHeaderKeyDown(event, column.id) : undefined}
                  >
                    {/* Wrapped only when there is something beside the label: a lone sort button sizes
                        itself against the cell, and a wrapper would change how its label ellipsizes. */}
                    {filterSlot ? (
                      <div className="data-table__head-inner">
                        {sortSlot}
                        {filterSlot}
                      </div>
                    ) : (
                      sortSlot
                    )}
                    <ColumnResizer
                      columnId={column.id}
                      label={column.label}
                      width={width}
                      onResize={onResizeColumn}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {renderPinnedCells && (
              <tr className="data-table__totals" ref={pinnedRowRef}>
                {renderPinnedCells(draggedColumnIndex, dropBoundaryIndex)}
              </tr>
            )}
            {paddingTop > 0 && (
              <tr className="data-table__spacer" aria-hidden="true">
                <td style={{ height: paddingTop }} colSpan={columnCount} />
              </tr>
            )}
            {virtualRows.map((virtualRow) => (
              <tr key={virtualRow.key} ref={rowVirtualizer.measureElement} data-index={virtualRow.index}>
                {renderCells(rows[virtualRow.index], virtualRow.index, draggedColumnIndex, dropBoundaryIndex)}
              </tr>
            ))}
            {paddingBottom > 0 && (
              <tr className="data-table__spacer" aria-hidden="true">
                <td style={{ height: paddingBottom }} colSpan={columnCount} />
              </tr>
            )}
            {statusRow != null && (
              <tr className="data-table__status">
                <td colSpan={columnCount}>{statusRow}</td>
              </tr>
            )}
            {hasNextPage && (
              <tr ref={sentinelRef}>
                <td colSpan={columnCount} className="data-table__load-more">
                  {isFetchingNextPage && loadingMoreSlot}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {overlay}
    </div>
  );
}
