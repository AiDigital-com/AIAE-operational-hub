import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "../../style/cn";
import { ExpandIcon, FilterIcon, SortIcon } from "../icons/icons";
import { COLUMN_RESIZE_STEP } from "./data-table-hooks";
import type { ColumnDragProps } from "./data-table-hooks";
import "./data-table.css";

/** How tall one row is assumed to be before it has been measured. Matches the density set in
 *  data-table.css (6px vertical padding + one 13.5px line), so nothing needs correcting unless a cell
 *  wraps. */
const DEFAULT_ROW_HEIGHT = 30;

/** How many rows beyond the visible window stay mounted, so a fast scroll does not show blank space. */
const ROW_OVERSCAN = 8;

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
  /** The row's `<td>`s - cells, not a row: the `<tr>` carries the virtualizer's measurement ref. */
  renderCells: (row: T, index: number) => ReactNode;
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

  /** From `useColumnDrag`. Both must be supplied for reordering to be offered at all. */
  draggingColumnId?: string | null;
  columnDragProps?: (columnId: string) => ColumnDragProps;

  /** The pinned first body row - totals, typically. Its height is measured, so it is rendered here
   *  rather than handed over as opaque markup: the virtualizer's coordinate space starts below it. */
  renderPinnedCells?: () => ReactNode;

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
  draggingColumnId = null,
  columnDragProps,
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
              {columns.map((column) => {
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
                      draggingColumnId === column.id && "data-table__col--dragging"
                    )}
                    style={columnStyle(width)}
                    {...columnDragProps?.(column.id)}
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
                {renderPinnedCells()}
              </tr>
            )}
            {paddingTop > 0 && (
              <tr className="data-table__spacer" aria-hidden="true">
                <td style={{ height: paddingTop }} colSpan={columnCount} />
              </tr>
            )}
            {virtualRows.map((virtualRow) => (
              <tr key={virtualRow.key} ref={rowVirtualizer.measureElement} data-index={virtualRow.index}>
                {renderCells(rows[virtualRow.index], virtualRow.index)}
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
