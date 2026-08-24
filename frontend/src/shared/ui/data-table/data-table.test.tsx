import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable, DataTableChips, DataTableViewControls, columnStyle, resolveDropBoundary } from "./data-table";
import type { DataTableColumn, DataTableColumnReorder } from "./data-table";
import {
  MIN_COLUMN_WIDTH,
  useColumnWidths,
  useTableExpand,
  withShownColumns,
} from "./data-table-hooks";

/** Every registered observer's callback, so a test can make the scroll sentinel intersect on demand. */
let intersectionCallbacks: IntersectionObserverCallback[] = [];

class MockIntersectionObserver implements IntersectionObserver {
  root = null;
  rootMargin = "";
  thresholds = [];
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    intersectionCallbacks.push(callback);
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn(() => {
    intersectionCallbacks = intersectionCallbacks.filter((registered) => registered !== this.callback);
  });
  takeRecords = vi.fn(() => []);
}

/** Fires every live observer as if its sentinel had scrolled into view. */
function intersectSentinels() {
  for (const callback of [...intersectionCallbacks]) {
    callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  }
}

beforeEach(() => {
  intersectionCallbacks = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Row {
  id: string;
  name: string;
  spend: number;
}

const COLUMNS: DataTableColumn[] = [
  { id: "name", label: "Name", sortable: true, filterable: true },
  { id: "spend", label: "Spend", sortable: true, agg: "SUM", className: "data-table__num" },
];

function aRow(index: number): Row {
  return { id: `row-${index}`, name: `Line ${index}`, spend: index * 100 };
}

/** Wires the component to the same hooks a real consumer holds, so the tests exercise the pair. Passing
 *  `onReorder` is what offers reordering at all - a harness with none renders exactly as a consumer that
 *  never wires `columnReorder` would. */
function Harness({
  rows = [aRow(0), aRow(1)],
  columns = COLUMNS,
  onReorder,
  onNudge,
  reorderDisabled,
  ...rest
}: Partial<Parameters<typeof DataTable<Row>>[0]> & {
  onReorder?: DataTableColumnReorder["onReorder"];
  onNudge?: DataTableColumnReorder["onNudge"];
  reorderDisabled?: boolean;
} = {}) {
  const { columnWidths, resizeColumn } = useColumnWidths();
  return (
    <DataTable<Row>
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.id}
      renderCells={(row) => (
        <>
          {columns.map((column) => (
            <td key={column.id} className={column.className} style={columnStyle(columnWidths[column.id])}>
              {column.id === "name" ? row.name : row.spend}
            </td>
          ))}
        </>
      )}
      columnWidths={columnWidths}
      onResizeColumn={resizeColumn}
      columnReorder={onReorder ? { onReorder, onNudge, disabled: reorderDisabled } : undefined}
      {...rest}
    />
  );
}

/** Stubs the rendered header cells' bounding rects left-to-right at the given pixel widths, so the
 *  drag's geometry resolves against real x positions instead of jsdom's all-zero layout. */
function stubHeaderRects(widths: number[]) {
  const cells = screen.getAllByRole("columnheader");
  let left = 0;
  cells.forEach((cell, index) => {
    const width = widths[index] ?? 150;
    vi.spyOn(cell, "getBoundingClientRect").mockReturnValue({
      left,
      right: left + width,
      top: 0,
      bottom: 30,
      width,
      height: 30,
      x: left,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    left += width;
  });
}

/** Stubs `requestAnimationFrame` so a test can run the drag's geometry effect exactly once, on demand -
 *  jsdom never paints, so nothing would ever call the real one. The returned function runs the one
 *  pending frame (if any) inside `act`, so the resulting state update is flushed before the next
 *  assertion; calling it again after a fresh frame has been scheduled advances one more frame. */
function stubAnimationFrame(): () => void {
  let pending: (() => void) | null = null;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
    pending = () => callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  return () => {
    const run = pending;
    pending = null;
    if (run) act(run);
  };
}

/** The mounted body rows, ignoring the pinned, spacer, status and sentinel rows. */
function dataRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll("tbody tr[data-index]"));
}

describe("DataTable header", () => {
  it("should render one column header per column, in the order given", () => {
    render(<Harness />);
    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent ?? "");
    expect(headers[0]).toContain("Name");
    expect(headers[1]).toContain("Spend");
  });

  it("should keep a metric's aggregation inside its sort button, where the label is", () => {
    render(<Harness />);
    const sortButton = screen.getByRole("button", { name: /^Spend/ });
    expect(within(sortButton).getByText("SUM")).toBeInTheDocument();
  });

  it("should still state the aggregation on a column that does not sort", () => {
    // Given: a calculated column that aggregates but has no field to order by
    render(
      <Harness
        columns={[
          { id: "name", label: "Name", sortable: true },
          { id: "cpa", label: "CPA", agg: "AVG" },
        ]}
      />
    );

    // Then: the badge is in the header, and no sort button was offered with it
    const cpaHeader = screen.getAllByRole("columnheader")[1];
    expect(within(cpaHeader).getByText("AVG")).toBeInTheDocument();
    expect(within(cpaHeader).queryByRole("button", { name: /CPA/ })).not.toBeInTheDocument();
  });

  it("should report the clicked column to onSort", async () => {
    const onSort = vi.fn();
    render(<Harness onSort={onSort} />);
    await userEvent.click(screen.getByRole("button", { name: /^Name/ }));
    expect(onSort).toHaveBeenCalledWith("name");
  });

  it("should mark the sorted column active regardless of the case the consumer names it in", () => {
    render(<Harness sortColumnId="SPEND" sortDirection="desc" />);
    const sortButton = screen.getByRole("button", { name: /^Spend/ });
    expect(sortButton.className).toContain("data-table__sort--active");
  });

  it("should disable sorting without disabling filtering, since the two are gated separately", () => {
    render(<Harness sortDisabled onOpenFilter={() => {}} />);
    expect(screen.getByRole("button", { name: /^Name/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Filter Name" })).toBeEnabled();
  });

  it("should offer a filter button only on the columns marked filterable", () => {
    render(<Harness onOpenFilter={() => {}} />);
    expect(screen.getByRole("button", { name: "Filter Name" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filter Spend" })).not.toBeInTheDocument();
  });

  it("should hand the filter button itself up as the popover's anchor", async () => {
    const onOpenFilter = vi.fn();
    render(<Harness onOpenFilter={onOpenFilter} />);
    const button = screen.getByRole("button", { name: "Filter Name" });
    await userEvent.click(button);
    expect(onOpenFilter).toHaveBeenCalledWith("name", button);
  });

  it("should say which column's filter is open", () => {
    render(<Harness onOpenFilter={() => {}} openFilterColumnId="name" />);
    expect(screen.getByRole("button", { name: "Filter Name" })).toHaveAttribute("aria-expanded", "true");
  });

  it("should title the header label so a clipped name is still readable", () => {
    render(<Harness columns={[{ id: "name", label: "Name", title: "Name — the line item's name", sortable: true }]} />);
    expect(screen.getByTitle("Name — the line item's name")).toHaveTextContent("Name");
  });
});

describe("DataTable column width", () => {
  it("should let a widened column show its whole header name", () => {
    render(<Harness />);
    const label = screen.getByTitle("Name");
    expect(label.className).not.toContain("data-table__label--sized");

    const handle = screen.getByRole("separator", { name: "Resize Name" });
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowRight" });

    expect(screen.getByTitle("Name").className).toContain("data-table__label--sized");
  });

  it("should widen a column with the arrow keys, compounding one press onto the next", () => {
    render(<Harness />);
    const handle = screen.getByRole("separator", { name: "Resize Name" });
    const header = handle.closest("th") as HTMLElement;

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    const first = Number.parseFloat(header.style.width);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    const second = Number.parseFloat(header.style.width);

    expect(second).toBeGreaterThan(first);
  });

  it("should never let a column be dragged narrower than it can be read at", () => {
    render(<Harness />);
    const handle = screen.getByRole("separator", { name: "Resize Name" });
    const header = handle.closest("th") as HTMLElement;

    for (let press = 0; press < 40; press += 1) {
      fireEvent.keyDown(handle, { key: "ArrowLeft" });
    }

    expect(Number.parseFloat(header.style.width)).toBe(MIN_COLUMN_WIDTH);
  });

  it("should pin width, min-width and max-width together, or an auto-layout table ignores all three", () => {
    expect(columnStyle(140)).toEqual({ width: 140, minWidth: 140, maxWidth: 140 });
    expect(columnStyle(undefined)).toBeUndefined();
  });
});

describe("resolveDropBoundary", () => {
  // Name spans 0-150, Spend spans 150-300 - real geometry, not jsdom's zeros.
  const rects = [
    { left: 0, right: 150 },
    { left: 150, right: 300 },
  ];

  it("should land before a column when the cursor sits left of its own midpoint", () => {
    // Given/When: 200 is inside Spend (150-300), left of its midpoint (225)
    // Then: the boundary sits directly before Spend
    expect(resolveDropBoundary(rects, 200)).toBe(1);
  });

  it("should land after a column when the cursor sits right of its own midpoint", () => {
    // Given/When: 260 is inside Spend, right of its midpoint (225)
    // Then: the boundary sits past every rendered column
    expect(resolveDropBoundary(rects, 260)).toBe(2);
  });

  it("should clamp to the last column once the cursor has scrolled past the table's own right edge", () => {
    expect(resolveDropBoundary(rects, 500)).toBe(2);
  });

  it("should land at the only possible boundary when there are no columns to speak of", () => {
    expect(resolveDropBoundary([], 100)).toBe(0);
  });
});

describe("DataTable column reorder", () => {
  it("should report a drop naming the neighbour column and the side, resolved once per animation frame from cursor geometry", () => {
    // Given: Name (0-150) and Spend (150-300), and a drag in progress
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const runFrame = stubAnimationFrame();
    stubHeaderRects([150, 150]);
    const [, spendTh] = screen.getAllByRole("columnheader");

    // When: Spend is picked up and released left of Name's own midpoint (75)
    fireEvent.pointerDown(spendTh, { clientX: 200, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 10 });
    runFrame();
    fireEvent.pointerUp(window);

    // Then: it lands before Name, not "at" it - the boundary the geometry actually resolved
    expect(onReorder).toHaveBeenCalledWith("spend", "name", "before");
  });

  it("should land after a column when the cursor is released right of its own midpoint", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const runFrame = stubAnimationFrame();
    stubHeaderRects([150, 150]);
    const [nameTh] = screen.getAllByRole("columnheader");

    // When: Name is picked up and released right of Spend's own midpoint (225)
    fireEvent.pointerDown(nameTh, { clientX: 50, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 260, clientY: 10 });
    runFrame();
    fireEvent.pointerUp(window);

    expect(onReorder).toHaveBeenCalledWith("name", "spend", "after");
  });

  it("should still resolve a drop position while the cursor is tracked over the body rows, not only the header", () => {
    // Given: the same geometry as the first test, but the pointer never visits the header's own row
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const runFrame = stubAnimationFrame();
    stubHeaderRects([150, 150]);
    const [, spendTh] = screen.getAllByRole("columnheader");

    // When: tracked well below the header, over where a data row renders
    fireEvent.pointerDown(spendTh, { clientX: 200, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 400 });
    runFrame();
    fireEvent.pointerUp(window);

    // Then: only x ever mattered to the boundary
    expect(onReorder).toHaveBeenCalledWith("spend", "name", "before");
  });

  it("should abandon the move on Escape instead of committing it", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const runFrame = stubAnimationFrame();
    stubHeaderRects([150, 150]);
    const [, spendTh] = screen.getAllByRole("columnheader");

    fireEvent.pointerDown(spendTh, { clientX: 200, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 10 });
    runFrame();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window);

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("should change nothing on a press with no movement", () => {
    // Given: a drag started but no animation frame ever resolving a boundary (no `runFrame()` call)
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    stubAnimationFrame();
    stubHeaderRects([150, 150]);
    const [, spendTh] = screen.getAllByRole("columnheader");

    // When: picked up and released at once
    fireEvent.pointerDown(spendTh, { clientX: 200, clientY: 10 });
    fireEvent.pointerUp(window);

    // Then:
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("should move a column with alt+arrow, so reordering is not pointer-only", () => {
    const onNudge = vi.fn();
    render(<Harness onReorder={() => {}} onNudge={onNudge} />);
    const [, spendTh] = screen.getAllByRole("columnheader");

    fireEvent.keyDown(spendTh, { key: "ArrowLeft", altKey: true });

    expect(onNudge).toHaveBeenCalledWith("spend", -1);
  });

  it("should ignore an arrow press without alt, which belongs to the control that has focus", () => {
    const onNudge = vi.fn();
    render(<Harness onReorder={() => {}} onNudge={onNudge} />);
    const [, spendTh] = screen.getAllByRole("columnheader");

    fireEvent.keyDown(spendTh, { key: "ArrowLeft" });

    expect(onNudge).not.toHaveBeenCalled();
  });

  it("should fade the column being dragged", () => {
    render(<Harness onReorder={() => {}} />);
    const [, spendTh] = screen.getAllByRole("columnheader");

    fireEvent.pointerDown(spendTh, { clientX: 200, clientY: 10 });

    expect(spendTh.className).toContain("data-table__col--dragging");
  });

  it("should offer no reordering at all when the consumer supplies no columnReorder", () => {
    render(<Harness />);
    const [, spendTh] = screen.getAllByRole("columnheader");

    expect(spendTh).not.toHaveAttribute("tabindex");
  });
});

describe("DataTable pinned row", () => {
  it("should put the pinned row first in the body, above every data row", () => {
    render(
      <Harness
        renderPinnedCells={() => (
          <>
            <td>Total</td>
            <td>100</td>
          </>
        )}
      />
    );
    const firstBodyRow = document.querySelector("tbody tr") as HTMLElement;
    expect(firstBodyRow.className).toContain("data-table__totals");
    expect(within(firstBodyRow).getByText("Total")).toBeInTheDocument();
  });

  it("should render no pinned row at all for a table that has no totals", () => {
    render(<Harness />);
    expect(document.querySelector(".data-table__totals")).not.toBeInTheDocument();
  });
});

describe("DataTable virtualization", () => {
  it("should mount only a window of rows, not every row it was given", () => {
    const rows = Array.from({ length: 400 }, (_, index) => aRow(index));
    render(<Harness rows={rows} />);

    const mounted = dataRows();
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(rows.length);
  });

  it("should reserve the scrolled-past rows' height with spacer rows spanning every column", () => {
    const rows = Array.from({ length: 400 }, (_, index) => aRow(index));
    render(<Harness rows={rows} />);

    const spacers = Array.from(document.querySelectorAll(".data-table__spacer td"));
    expect(spacers.length).toBeGreaterThan(0);
    for (const spacer of spacers) {
      expect(spacer).toHaveAttribute("colspan", String(COLUMNS.length));
    }
  });

  it("should key rows by the consumer's identity, so a prepend does not remount the tail", () => {
    const { rerender } = render(<Harness rows={[aRow(1), aRow(2)]} />);
    const before = dataRows()[0];

    rerender(<Harness rows={[aRow(0), aRow(1), aRow(2)]} />);

    expect(dataRows()[0]).not.toBe(before);
    expect(dataRows()[0]).toHaveTextContent("Line 0");
  });

  it("should mount every row of a short table, leaving no spacer to scroll past", () => {
    render(<Harness rows={[aRow(0), aRow(1), aRow(2)]} />);
    expect(dataRows()).toHaveLength(3);
    expect(document.querySelector(".data-table__spacer")).not.toBeInTheDocument();
  });
});

describe("DataTable infinite scroll", () => {
  it("should show a scroll sentinel while more pages remain", () => {
    render(<Harness hasNextPage />);
    expect(document.querySelector(".data-table__load-more")).toBeInTheDocument();
  });

  it("should stop showing the sentinel once the last page has loaded", () => {
    render(<Harness hasNextPage={false} />);
    expect(document.querySelector(".data-table__load-more")).not.toBeInTheDocument();
  });

  it("should ask for the next page when the sentinel intersects", () => {
    const fetchNextPage = vi.fn();
    render(<Harness hasNextPage fetchNextPage={fetchNextPage} />);

    intersectSentinels();

    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("should not ask again while the page it already asked for is in flight", () => {
    const fetchNextPage = vi.fn();
    render(<Harness hasNextPage isFetchingNextPage fetchNextPage={fetchNextPage} />);

    intersectSentinels();

    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("should show what it is waiting for inside the sentinel row", () => {
    render(<Harness hasNextPage isFetchingNextPage loadingMoreSlot={<span>Loading more rows</span>} />);
    const sentinelCell = document.querySelector(".data-table__load-more") as HTMLElement;
    expect(within(sentinelCell).getByText("Loading more rows")).toBeInTheDocument();
  });
});

describe("DataTable status row", () => {
  it("should say why the table is empty as a row of the table, not as a bar across it", () => {
    render(<Harness rows={[]} statusRow="No rows match this filter." />);
    const status = document.querySelector(".data-table__status") as HTMLElement;
    expect(within(status).getByText("No rows match this filter.")).toBeInTheDocument();
    expect(status.querySelector("td")).toHaveAttribute("colspan", String(COLUMNS.length));
  });
});

describe("DataTableChips", () => {
  it("should list each narrowing as label and summary in one chip", () => {
    render(
      <DataTableChips
        chips={[
          { id: "date", label: "Date", summary: "Mar 10, 2026 — Mar 20, 2026", clear: () => {} },
          { id: "platform", label: "Platform", summary: "2 values", clear: () => {} },
        ]}
      />
    );
    expect(screen.getByText("Date: Mar 10, 2026 — Mar 20, 2026")).toBeInTheDocument();
    expect(screen.getByText("Platform: 2 values")).toBeInTheDocument();
  });

  it("should clear one narrowing on demand", async () => {
    const clear = vi.fn();
    render(<DataTableChips chips={[{ id: "date", label: "Date", summary: "Mar 10, 2026", clear }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Clear the Date filter" }));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("should render nothing at all when the rows are not narrowed", () => {
    const { container } = render(<DataTableChips chips={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("should refuse to clear a narrowing while the table is being edited", () => {
    render(<DataTableChips chips={[{ id: "date", label: "Date", summary: "Mar 10, 2026", clear: () => {} }]} disabled />);
    expect(screen.getByRole("button", { name: "Clear the Date filter" })).toBeDisabled();
  });
});

describe("DataTableViewControls", () => {
  it("should say how many rows there are, and how many of them have loaded", () => {
    render(<DataTableViewControls totalRows={138} loadedRows={25} expanded={false} onToggleExpanded={() => {}} />);
    expect(screen.getByText("25 of 138 rows")).toBeInTheDocument();
  });

  it("should drop the loaded count once every row is in", () => {
    render(<DataTableViewControls totalRows={1} loadedRows={1} expanded={false} onToggleExpanded={() => {}} />);
    expect(screen.getByText("1 row")).toBeInTheDocument();
  });

  it("should say there are none rather than showing a zero", () => {
    render(<DataTableViewControls totalRows={0} loadedRows={0} expanded={false} onToggleExpanded={() => {}} />);
    expect(screen.getByText("No rows")).toBeInTheDocument();
  });

  it("should not claim a count it does not have yet", () => {
    render(<DataTableViewControls totalRows={0} loadedRows={0} isPending expanded={false} onToggleExpanded={() => {}} />);
    expect(screen.getByText("Loading rows…")).toBeInTheDocument();
  });
});

/** The minimum a page needs to drive the expand hook: a toggle and something to scroll back to. */
function ExpandHarness({ space }: { space?: { collapsed: boolean; setCollapsed: (collapsed: boolean) => void } }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const { expanded, toggleExpanded } = useTableExpand({ space, anchorRef });
  return (
    <div className={expanded ? "page page--expanded" : "page"}>
      <div ref={anchorRef}>anchor</div>
      <button type="button" aria-pressed={expanded} onClick={toggleExpanded}>
        {expanded ? "Collapse table" : "Expand table"}
      </button>
    </div>
  );
}

describe("useTableExpand", () => {
  it("should report expansion so the page can hide its own chrome, and stop reporting it on collapse", async () => {
    render(<ExpandHarness />);

    await userEvent.click(screen.getByRole("button", { name: "Expand table" }));
    expect(document.querySelector(".page--expanded")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Collapse table" }));
    expect(document.querySelector(".page--expanded")).not.toBeInTheDocument();
  });

  it("should take the shell's width while expanded and give back what it found", async () => {
    const setCollapsed = vi.fn();
    render(<ExpandHarness space={{ collapsed: false, setCollapsed }} />);

    await userEvent.click(screen.getByRole("button", { name: "Expand table" }));
    expect(setCollapsed).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByRole("button", { name: "Collapse table" }));
    expect(setCollapsed).toHaveBeenLastCalledWith(false);
  });

  it("should leave a sidebar the user had already collapsed collapsed", async () => {
    const setCollapsed = vi.fn();
    render(<ExpandHarness space={{ collapsed: true, setCollapsed }} />);

    await userEvent.click(screen.getByRole("button", { name: "Expand table" }));
    await userEvent.click(screen.getByRole("button", { name: "Collapse table" }));

    expect(setCollapsed).toHaveBeenLastCalledWith(true);
  });

  it("should bring the table back under the eye on both transitions", async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    render(<ExpandHarness />);

    await userEvent.click(screen.getByRole("button", { name: "Expand table" }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Collapse table" }));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "start" });

    scrollIntoView.mockRestore();
  });

  it("should get out of expanded on Escape, the only affordance left once the chrome is hidden", async () => {
    render(<ExpandHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Expand table" }));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByRole("button", { name: "Expand table" })).toBeInTheDocument();
  });

  it("should hand the shell's width back when the page is left mid-expand", async () => {
    const setCollapsed = vi.fn();
    const { unmount } = render(<ExpandHarness space={{ collapsed: false, setCollapsed }} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand table" }));
    setCollapsed.mockClear();

    unmount();

    expect(setCollapsed).toHaveBeenCalledWith(false);
  });
});

/** Guards the memo contract the Reporting tab's row component depends on. */
describe("DataTable render stability", () => {
  it("should keep one identity for the resize callback across unrelated renders", () => {
    const seen: unknown[] = [];
    function Probe({ tick }: { tick: number }) {
      const { resizeColumn } = useColumnWidths();
      seen.push(resizeColumn);
      return <span>{tick}</span>;
    }
    const { rerender } = render(<Probe tick={1} />);
    rerender(<Probe tick={2} />);

    expect(seen[1]).toBe(seen[0]);
  });
});

/** A consumer that holds its own flat order and reorders through it, the way Dashboards does - no
 *  dimension/metric grouping in sight, proving the shared mechanism needs none to work. */
describe("DataTable column reorder with consumer-held order", () => {
  it("should let a consumer with one flat column list reorder without modelling groups", () => {
    function Reorderable() {
      const [order, setOrder] = useState(["name", "spend"]);
      const onReorder: DataTableColumnReorder["onReorder"] = (fromId, toId, side) =>
        setOrder((current) => {
          const without = current.filter((id) => id !== fromId);
          const targetIndex = without.indexOf(toId);
          if (targetIndex === -1) return current;
          without.splice(side === "before" ? targetIndex : targetIndex + 1, 0, fromId);
          return without;
        });
      const columns = order.map((id) => ({ id, label: id }));
      return (
        <DataTable
          columns={columns}
          rows={[]}
          getRowKey={(row: { id: string }) => row.id}
          renderCells={() => null}
          columnWidths={{}}
          onResizeColumn={() => {}}
          columnReorder={{ onReorder }}
        />
      );
    }
    render(<Reorderable />);
    const runFrame = stubAnimationFrame();
    stubHeaderRects([150, 150]);
    const [, second] = screen.getAllByRole("columnheader");

    fireEvent.pointerDown(second, { clientX: 200, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 10 });
    runFrame();
    fireEvent.pointerUp(window);

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["spend", "name"]);
  });
});

describe("withShownColumns", () => {
  it("should keep a saved order that already covers every shown column", () => {
    // Given/When:
    const order = withShownColumns(["date", "impressions"], ["date", "impressions"]);

    // Then:
    expect(order).toEqual(["date", "impressions"]);
  });

  it("should append a shown column the saved order does not mention", () => {
    // Given: an order saved before Clicks was added, which is why Clicks could not be moved
    // When:
    const order = withShownColumns(["date", "impressions"], ["date", "impressions", "clicks"]);

    // Then: it lands where the table already draws it - behind the columns the order does mention
    expect(order).toEqual(["date", "impressions", "clicks"]);
  });

  it("should keep a saved column that is not shown right now", () => {
    // Given: a column switched off after the arrangement was saved
    // When:
    const order = withShownColumns(["date", "impressions", "clicks"], ["date", "clicks"]);

    // Then: it keeps its place, so switching it back on returns it where it was left
    expect(order).toEqual(["date", "impressions", "clicks"]);
  });

  it("should fall back to the render order when nothing was ever saved", () => {
    // Given/When:
    const order = withShownColumns([], ["date", "impressions"]);

    // Then:
    expect(order).toEqual(["date", "impressions"]);
  });
});
