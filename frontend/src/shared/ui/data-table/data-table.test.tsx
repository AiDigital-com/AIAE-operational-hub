import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable, DataTableChips, DataTableViewControls, columnStyle } from "./data-table";
import type { DataTableColumn } from "./data-table";
import {
  MIN_COLUMN_WIDTH,
  useColumnDrag,
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

/** Wires the component to the same hooks a real consumer holds, so the tests exercise the pair. */
function Harness({
  rows = [aRow(0), aRow(1)],
  columns = COLUMNS,
  onReorder = () => {},
  onNudge = () => {},
  ...rest
}: Partial<Parameters<typeof DataTable<Row>>[0]> & {
  onReorder?: (fromId: string, toId: string) => void;
  onNudge?: (columnId: string, offset: -1 | 1) => void;
} = {}) {
  const { columnWidths, resizeColumn } = useColumnWidths();
  const { draggingColumnId, columnDragProps } = useColumnDrag({ onReorder, onNudge });
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
      draggingColumnId={draggingColumnId}
      columnDragProps={columnDragProps}
      {...rest}
    />
  );
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

describe("DataTable column reorder", () => {
  it("should report a drop as a move from the dragged column to the dropped-on one", () => {
    const onReorder = vi.fn();
    render(<Harness onReorder={onReorder} />);
    const [nameTh, spendTh] = screen.getAllByRole("columnheader");

    fireEvent.dragStart(spendTh);
    fireEvent.dragOver(nameTh);
    fireEvent.drop(nameTh);

    expect(onReorder).toHaveBeenCalledWith("spend", "name");
  });

  it("should move a column with alt+arrow, so reordering is not pointer-only", () => {
    const onNudge = vi.fn();
    render(<Harness onNudge={onNudge} />);
    const [, spendTh] = screen.getAllByRole("columnheader");

    fireEvent.keyDown(spendTh, { key: "ArrowLeft", altKey: true });

    expect(onNudge).toHaveBeenCalledWith("spend", -1);
  });

  it("should ignore an arrow press without alt, which belongs to the control that has focus", () => {
    const onNudge = vi.fn();
    render(<Harness onNudge={onNudge} />);
    const [, spendTh] = screen.getAllByRole("columnheader");

    fireEvent.keyDown(spendTh, { key: "ArrowLeft" });

    expect(onNudge).not.toHaveBeenCalled();
  });

  it("should fade the column being dragged", () => {
    render(<Harness />);
    const [, spendTh] = screen.getAllByRole("columnheader");

    fireEvent.dragStart(spendTh);

    expect(spendTh.className).toContain("data-table__col--dragging");
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
  it("should keep one identity for the resize and drag callbacks across unrelated renders", () => {
    const seen: Array<{ resize: unknown; drag: unknown }> = [];
    function Probe({ tick }: { tick: number }) {
      const { resizeColumn } = useColumnWidths();
      const { columnDragProps } = useColumnDrag({ onReorder: () => {} });
      seen.push({ resize: resizeColumn, drag: columnDragProps });
      return <span>{tick}</span>;
    }
    const { rerender } = render(<Probe tick={1} />);
    rerender(<Probe tick={2} />);

    expect(seen[1].resize).toBe(seen[0].resize);
    expect(seen[1].drag).toBe(seen[0].drag);
  });
});

/** A consumer that holds its own order, the way Dashboards will. */
describe("useColumnDrag with consumer-held order", () => {
  it("should let a consumer with one flat column list reorder without modelling groups", () => {
    function Reorderable() {
      const [order, setOrder] = useState(["name", "spend"]);
      const { columnDragProps } = useColumnDrag({
        onReorder: (fromId, toId) =>
          setOrder((current) => {
            const next = [...current];
            next.splice(next.indexOf(toId), 0, ...next.splice(next.indexOf(fromId), 1));
            return next;
          }),
      });
      return (
        <table>
          <thead>
            <tr>
              {order.map((id) => (
                <th key={id} {...columnDragProps(id)}>
                  {id}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      );
    }
    render(<Reorderable />);
    const [first, second] = screen.getAllByRole("columnheader");

    fireEvent.dragStart(second);
    fireEvent.dragOver(first);
    fireEvent.drop(first);

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
