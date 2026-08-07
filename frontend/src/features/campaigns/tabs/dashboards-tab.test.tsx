import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../shared/ui/toast/toast";
import {
  createDashboard,
  createDashboardDataSource,
  deleteDashboard,
  duplicateDashboard,
  listDashboardDatasetDistinctValues,
  listDashboardDatasetRows,
  listDashboards,
  previewDashboardDataset,
  removeDashboardDataSource,
  updateDashboard,
} from "../api";
import type { CampaignTabContext } from "../campaign-workspace";
import type { CampaignV1, DashboardDatasetRowsPageResponseV1, DashboardPageResponseV1, DashboardV1 } from "../types";
import { DashboardsTab } from "./dashboards-tab";

/** The types the reference lists as coming soon, in its order. */
const SOON_TYPES = [
  "Conversions",
  "Geo",
  "Keywords",
  "Business outcomes",
  "Live Sports",
  "Device",
  "Genre",
  "Demographics",
];

vi.mock("../api", () => ({
  listDashboards: vi.fn(),
  createDashboard: vi.fn(),
  updateDashboard: vi.fn(),
  deleteDashboard: vi.fn(),
  duplicateDashboard: vi.fn(),
  previewDashboardDataset: vi.fn(),
  listDashboardDatasetRows: vi.fn(),
  listDashboardDatasetDistinctValues: vi.fn(),
  createDashboardDataSource: vi.fn(),
  removeDashboardDataSource: vi.fn(),
}));

function aCampaign(overrides: Partial<CampaignV1> = {}): CampaignV1 {
  return {
    id: 42,
    name: "Ourisman Ford 2026",
    status: "Live",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    budget: 1000000,
    channels: ["Display"],
    industry_vertical: "Automotive",
    ...overrides,
  };
}

function aDashboard(overrides: Partial<DashboardV1> = {}): DashboardV1 {
  return {
    id: 7,
    campaignId: 42,
    name: "Client dashboard",
    type: "basic",
    status: "draft",
    optionalColumns: ["creative", "cpa"],
    filters: [],
    created: "2026-08-01T10:00:00",
    edited: null,
    ...overrides,
  };
}

function aPage(content: DashboardV1[]): DashboardPageResponseV1 {
  return {
    content,
    pageNumber: 1,
    pageSize: 25,
    totalElements: content.length,
    totalPages: content.length === 0 ? 0 : 1,
  };
}

function aDatasetPage(): DashboardDatasetRowsPageResponseV1 {
  return {
    content: [
      {
        values: {
          Date: "2026-08-01",
          line_item_description: "Prospecting",
          Tactic: "Display",
          Channel: "Meta",
          Impressions: 1200,
          Clicks: 34,
          Cost: 56.78,
          Conversions: 4,
          CPA_cost: 56.78,
          CPA_conversions: 4,
        },
      },
    ],
    pageNumber: 1,
    pageSize: 25,
    totalElements: 1,
    totalPages: 1,
  };
}

function renderTab(campaign: CampaignV1 = aCampaign()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/campaigns/42/dashboards"]}>
          <Routes>
            <Route
              path="/campaigns/:campaignId"
              element={<Outlet context={{ campaign } satisfies CampaignTabContext} />}
            >
              <Route path="dashboards" element={<DashboardsTab />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

/** Opens the "?" beside the table controls, which is where the dataset's own facts live now. */
async function openDatasetHint() {
  // findBy, not getBy: several callers open it as the first thing after render, before the dashboard the
  // detail panel describes has loaded.
  await userEvent.hover(await screen.findByRole("button", { name: "What this dataset preview shows" }));
}

/** Opens the published source's menu, which is where its actions live. */
async function openSourceMenu() {
  await userEvent.click(await screen.findByRole("button", { name: /ClicData source/ }));
}

/** The dataset table's own header cells. The dashboards list above it is a table too, so a query by role
 *  alone would return its headers first. */
function datasetHeaders(): HTMLElement[] {
  const table = document.querySelector(".data-table__tbl") as HTMLElement;
  return Array.from(table.querySelectorAll("thead th"));
}

let intersectionCallbacks: IntersectionObserverCallback[] = [];

// The dataset table pages by scrolling, so mounting it registers an observer. jsdom has none; without this
// stub every render of the tab throws before a single assertion runs. disconnect() drops the callback so a
// re-registered sentinel does not leave a stale one behind.
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

describe("DashboardsTab", () => {
  beforeEach(() => {
    intersectionCallbacks = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.clearAllMocks();
    vi.mocked(previewDashboardDataset).mockResolvedValue({
      rowCount: 12345,
      optionalColumns: ["creative", "cpa"],
      sourceTable: "silken-quasar-376417.gs_templates.ourisman_ford_2026_report_basic_dash_client_dashboard",
    });
    vi.mocked(listDashboardDatasetRows).mockResolvedValue(aDatasetPage());
    vi.mocked(listDashboardDatasetDistinctValues).mockResolvedValue(["Meta", "Google Search"]);
  });

  it("should show a spinner while the dashboards load", async () => {
    // Given: a list that has not answered yet
    vi.mocked(listDashboards).mockReturnValue(new Promise(() => {}));

    // When:
    renderTab();

    // Then:
    expect(await screen.findByRole("status", { name: "Loading dashboards" })).toBeInTheDocument();
  });

  it("should surface the error when the dashboards cannot be loaded", async () => {
    // Given:
    vi.mocked(listDashboards).mockRejectedValue(new Error("Dashboards unavailable"));

    // When:
    renderTab();

    // Then:
    expect(await screen.findByText(/Dashboards unavailable/)).toBeInTheDocument();
  });

  it("should invite the first dashboard when the campaign has none", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([]));

    // When:
    renderTab();

    // Then: no dataset panel either, since there is nothing selected to describe
    expect(await screen.findByText("Create your first dashboard")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(previewDashboardDataset).not.toHaveBeenCalled();
  });

  it("should offer only Basic as a creatable type", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([]));
    renderTab();
    await screen.findByText("Create your first dashboard");

    // When:
    await userEvent.click(screen.getAllByRole("button", { name: "Create dashboard" })[0]);

    // Then: every other type is listed as coming soon, so nothing can be created that has no schema
    expect(await screen.findByRole("menuitem", { name: "Basic" })).toBeEnabled();
    expect(screen.getAllByText("Coming soon")).toHaveLength(8);
    SOON_TYPES.forEach((label) =>
      expect(screen.getByRole("menuitem", { name: new RegExp(`^${label}`) })).toBeDisabled()
    );
  });

  it("should create a Basic dashboard with both optional columns kept", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([]));
    vi.mocked(createDashboard).mockResolvedValue(aDashboard());
    renderTab();
    await screen.findByText("Create your first dashboard");
    await userEvent.click(screen.getAllByRole("button", { name: "Create dashboard" })[0]);

    // When:
    await userEvent.click(await screen.findByRole("menuitem", { name: "Basic" }));

    // Then: a new dashboard starts with everything the type offers, which is what "Fixed" implies
    await waitFor(() => expect(createDashboard).toHaveBeenCalledWith(42, {
      name: "Untitled Basic dashboard",
      type: "basic",
      optionalColumns: ["creative", "cpa"],
      filters: [],
    }));
  });

  it("should pick the next untitled name when the default dashboard name already exists", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([
      aDashboard({ name: "Untitled Basic dashboard" }),
      aDashboard({ id: 8, name: "Untitled Basic dashboard (1)" }),
    ]));
    vi.mocked(createDashboard).mockResolvedValue(aDashboard({ id: 9, name: "Untitled Basic dashboard (2)" }));
    renderTab();
    await screen.findByRole("button", { name: "Apply" });
    await userEvent.click(screen.getByRole("button", { name: "Create dashboard" }));

    // When:
    await userEvent.click(await screen.findByRole("menuitem", { name: "Basic" }));

    // Then:
    await waitFor(() => expect(createDashboard).toHaveBeenCalledWith(42, {
      name: "Untitled Basic dashboard (2)",
      type: "basic",
      optionalColumns: ["creative", "cpa"],
      filters: [],
    }));
  });

  it("should show the fixed schema with only the optional columns switchable", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));

    // When:
    renderTab();

    // Then: two checkboxes among 30 columns - the template owns the rest
    await screen.findByRole("button", { name: "Apply" });
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: /Creative$/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /CPA/ })).toBeChecked();
    expect(screen.getAllByText("Fixed")).toHaveLength(2);
  });

  it("should count the rows the data source would contain", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));

    // When:
    renderTab();

    // Then:
    await openDatasetHint();
    expect(await screen.findByText(/12,345 rows · 18 dimensions · 12 metrics/)).toBeInTheDocument();
    expect(previewDashboardDataset).toHaveBeenCalledTimes(1);
  });

  it("should say why a cell of the preview can be empty", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));

    // When:
    renderTab();

    // Then: behind the same "?" as the rest of the dataset's facts, because an empty cell is the
    // reporting tool's answer and not a fault - PDI_106 was a plan the table had no row for
    await openDatasetHint();
    expect(await screen.findByText(/Why a cell can be empty/)).toBeInTheDocument();
    expect(screen.getByText(/CPA needs the campaign's plan/)).toBeInTheDocument();
    expect(screen.getByText(/Goal, Campaign \(short\) and the benchmarks/)).toBeInTheDocument();
    expect(screen.getByText(/no CPC on CTV, DOOH or Live Sports/)).toBeInTheDocument();
  });

  it("should render dashboard dataset preview rows and filter them through BigQuery", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    renderTab();

    // Then: preview rows come from the dataset endpoint, not from a static placeholder.
    expect(await screen.findByText("Prospecting")).toBeInTheDocument();
    expect(screen.getByText("Meta")).toBeInTheDocument();
    expect(screen.getByText("$56.78")).toBeInTheDocument();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Filter Channel" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Meta" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    // Then:
    await waitFor(() => expect(listDashboardDatasetRows).toHaveBeenLastCalledWith(42, 7, 1, 25, {
      filters: [{ field: "Channel", values: ["Meta"] }],
      dateFrom: undefined,
      dateTo: undefined,
    }));
  });

  it("should cover the table with a loading overlay while the first page is read, as Reporting does", async () => {
    // Given: a dataset read that has not answered yet
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    let release: (page: DashboardDatasetRowsPageResponseV1) => void = () => {};
    vi.mocked(listDashboardDatasetRows).mockReturnValue(
      new Promise<DashboardDatasetRowsPageResponseV1>((resolve) => {
        release = resolve;
      })
    );

    // When:
    renderTab();

    // Then: an overlay over the whole table, not a single spinner row inside an empty one. `isRefetching`
    // would be false here, which is why it cannot be the condition.
    expect(await screen.findByRole("status", { name: "Loading rows" })).toBeInTheDocument();

    // When:
    release(aDatasetPage());

    // Then:
    expect(await screen.findByText("Prospecting")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading rows" })).not.toBeInTheDocument());
  });

  it("should keep the rows it is showing while a filter change is read", async () => {
    // Given: a loaded preview
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    renderTab();
    await screen.findByText("Prospecting");

    // When: a filter change mints a new query key, and the next read has not answered
    let release: (page: DashboardDatasetRowsPageResponseV1) => void = () => {};
    vi.mocked(listDashboardDatasetRows).mockReturnValue(
      new Promise<DashboardDatasetRowsPageResponseV1>((resolve) => {
        release = resolve;
      })
    );
    await userEvent.click(screen.getByRole("button", { name: "Filter Channel" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Meta" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    // Then: the old rows stay under the overlay rather than the table emptying to nothing.
    expect(await screen.findByRole("status", { name: "Loading rows" })).toBeInTheDocument();
    expect(screen.getByText("Prospecting")).toBeInTheDocument();

    release(aDatasetPage());
  });

  it("should say above the table which values are narrowing the preview, and clear one on demand", async () => {
    // Given: a dashboard whose preview is already filtered to one channel
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard({ filters: [{ field: "Channel", values: ["Meta"] }] })]));

    // When:
    renderTab();

    // Then: the funnel icon is not the only sign the rows have been reduced.
    expect(await screen.findByText("Channel: Meta")).toBeInTheDocument();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Clear the Channel filter" }));

    // Then:
    expect(screen.queryByText("Channel: Meta")).not.toBeInTheDocument();
    await waitFor(() => expect(listDashboardDatasetRows).toHaveBeenLastCalledWith(42, 7, 1, 25, {
      filters: [],
      dateFrom: undefined,
      dateTo: undefined,
    }));
  });

  it("should state the date window that is narrowing the preview", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(
      aPage([aDashboard({ dateFrom: "2026-03-10", dateTo: "2026-03-20" })])
    );

    // When:
    renderTab();

    // Then:
    expect(await screen.findByText("Date: Mar 10, 2026 — Mar 20, 2026")).toBeInTheDocument();
  });

  it("should state how each metric aggregates in its header", async () => {
    // Given: a dashboard whose schema sums some metrics and averages others
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    renderTab();
    await screen.findByText("Prospecting");

    // Then: the header says which, because a rate read over a week is not the sum of its days
    const headers = datasetHeaders().map((cell) => cell.textContent ?? "");
    expect(headers.find((text) => text.includes("Impressions"))).toContain("SUM");
    // WTD, not AVG: a week's CPM is total cost over total impressions, not the mean of its days
    expect(headers.find((text) => text.includes("CPM"))).toContain("WTD");
    // And a dimension has nothing to say about aggregation
    expect(headers.find((text) => text.includes("Channel"))).not.toContain("SUM");
  });

  it("should let a preview column be resized, pinning its body cells to the same width", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    renderTab();
    await screen.findByText("Prospecting");

    // When:
    const handle = screen.getByRole("separator", { name: "Resize Channel" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });

    // Then: the header and the cells below it move together, or an auto-layout table pushes it back open.
    const header = handle.closest("th") as HTMLElement;
    expect(Number.parseFloat(header.style.width)).toBeGreaterThan(0);
    expect((screen.getByText("Meta").closest("td") as HTMLElement).style.width).toBe(header.style.width);
  });

  it("should let a preview column be dragged to another column's place", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    renderTab();
    await screen.findByText("Prospecting");
    const headerOrder = () => datasetHeaders().map((cell) => cell.textContent ?? "");
    const before = headerOrder();
    const channelAt = before.findIndex((text) => text.includes("Channel") && !text.includes("short"));
    const dateAt = before.findIndex((text) => text.includes("Date"));
    expect(dateAt).toBeLessThan(channelAt);

    // When: Channel is dropped onto Date
    const headers = datasetHeaders();
    fireEvent.dragStart(headers[channelAt]);
    fireEvent.dragOver(headers[dateAt]);
    fireEvent.drop(headers[dateAt]);

    // Then:
    const after = headerOrder();
    expect(after.findIndex((text) => text.includes("Channel") && !text.includes("short")))
      .toBeLessThan(after.findIndex((text) => text.includes("Date")));
  });

  it("should save a rearrangement at once, without waiting for Apply", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    vi.mocked(updateDashboard).mockResolvedValue(aDashboard());
    renderTab();
    await screen.findByText("Prospecting");
    const headers = datasetHeaders();
    const columnCount = headers.length;

    // When: the second column is dropped onto the first
    fireEvent.dragStart(headers[1]);
    fireEvent.dragOver(headers[0]);
    fireEvent.drop(headers[0]);

    // Then: a whole arrangement is written, seeded from the columns on screen rather than the one pair
    // that moved - and Apply stays off, because rearranging is a way of reading the preview rather than a
    // change to what the dataset contains.
    await waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(updateDashboard).mock.calls[0][2];
    expect(saved.columnOrder?.[0]).toBe("line_item");
    expect(saved.columnOrder?.[1]).toBe("date");
    expect(saved.columnOrder).toHaveLength(columnCount);
    expect(saved.optionalColumns).toEqual(["creative", "cpa"]);
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("should move a column the saved order does not mention", async () => {
    // Given: a dashboard arranged when the order listed only three of its columns, as one saved before an
    // optional column was switched back on does
    vi.mocked(listDashboards).mockResolvedValue(
      aPage([aDashboard({ columnOrder: ["channel", "date", "line_item"] })])
    );
    vi.mocked(updateDashboard).mockResolvedValue(aDashboard());
    renderTab();
    await screen.findByText("Prospecting");
    const headers = datasetHeaders();
    const unmentioned = headers.length - 1;

    // When: the last column - one the saved order says nothing about - is dropped on the first
    fireEvent.dragStart(headers[unmentioned]);
    fireEvent.dragOver(headers[0]);
    fireEvent.drop(headers[0]);

    // Then: it moves, and the saved arrangement now covers every column. It used to sit still: the move
    // looked the column up in the saved order, found nothing, and returned the order unchanged.
    const movedLabel = headers[unmentioned].textContent ?? "";
    await waitFor(() => expect(datasetHeaders()[0].textContent).toBe(movedLabel));
    await waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateDashboard).mock.calls[0][2].columnOrder).toHaveLength(headers.length);
  });

  it("should step the keyboard nudge past a column that is switched off", async () => {
    // Given: a saved order that still mentions CPA, switched off since - so the order carries an id the
    // table does not draw, sitting between two it does
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard({
      optionalColumns: ["creative"],
      columnOrder: ["date", "cpa", "line_item"],
    })]));
    vi.mocked(updateDashboard).mockResolvedValue(aDashboard());
    renderTab();
    await screen.findByText("Prospecting");
    const before = datasetHeaders().map((cell) => cell.textContent ?? "");
    expect(before[0]).toContain("Date");
    expect(before[1]).toContain("Line item");

    // When: the first column is nudged one slot right
    fireEvent.keyDown(datasetHeaders()[0], { key: "ArrowRight", altKey: true });

    // Then: it swaps with the next column the user can see, not with the hidden one - which would have
    // moved nothing on screen and still spent a save
    await waitFor(() => {
      const after = datasetHeaders().map((cell) => cell.textContent ?? "");
      expect(after[0]).toContain("Line item");
      expect(after[1]).toContain("Date");
    });
    await waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(updateDashboard).mock.calls[0][2].columnOrder ?? [];
    expect(saved.indexOf("line_item")).toBeLessThan(saved.indexOf("date"));
  });

  it("should not re-read the dataset when a column is only rearranged", async () => {
    // Given: a dashboard whose preview rows and row count have already been read
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    vi.mocked(updateDashboard).mockResolvedValue(aDashboard({ columnOrder: ["line_item", "date"] }));
    renderTab();
    await screen.findByText("Prospecting");
    const rowReads = vi.mocked(listDashboardDatasetRows).mock.calls.length;
    const countReads = vi.mocked(previewDashboardDataset).mock.calls.length;

    // When: a column is dropped onto another
    const headers = datasetHeaders();
    fireEvent.dragStart(headers[1]);
    fireEvent.dragOver(headers[0]);
    fireEvent.drop(headers[0]);
    await waitFor(() => expect(updateDashboard).toHaveBeenCalledTimes(1));

    // Then: the order is saved, and neither BigQuery read is repeated - the rows are the same rows in a
    // different arrangement, so re-reading them would spend two query jobs to arrive at what is on screen.
    await waitFor(() => expect(datasetHeaders()[0].textContent).toContain("Line item"));
    expect(vi.mocked(listDashboardDatasetRows).mock.calls).toHaveLength(rowReads);
    expect(vi.mocked(previewDashboardDataset).mock.calls).toHaveLength(countReads);
  });

  it("should read the preview in the order it was last saved in", async () => {
    // Given: a dashboard whose saved order puts Channel first
    vi.mocked(listDashboards).mockResolvedValue(
      aPage([aDashboard({ columnOrder: ["channel", "date", "line_item"] })])
    );

    // When:
    renderTab();
    await screen.findByText("Prospecting");

    // Then: the columns the order does not mention fall in behind the ones it does
    const headers = datasetHeaders().map((cell) => cell.textContent ?? "");
    expect(headers[0]).toContain("Channel");
    expect(headers[1]).toContain("Date");
  });

  it("should save a filter at once, without waiting for Apply", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    vi.mocked(updateDashboard).mockResolvedValue(aDashboard());
    renderTab();
    await screen.findByText("Prospecting");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Filter Channel" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Meta" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    // Then: the filter is a question about the dataset, and the answer survives a reload
    await waitFor(() => expect(vi.mocked(updateDashboard).mock.calls[0][2]).toMatchObject({
      filters: [{ field: "Channel", values: ["Meta"] }],
      optionalColumns: ["creative", "cpa"],
    }));
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("should save a date window at once, without waiting for Apply", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    vi.mocked(updateDashboard).mockResolvedValue(aDashboard());
    renderTab();
    await screen.findByText("Prospecting");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Filter Date" }));
    fireEvent.change(await screen.findByLabelText("From"), { target: { value: "2026-03-10" } });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    // Then:
    await waitFor(() => expect(vi.mocked(updateDashboard).mock.calls[0][2]).toMatchObject({
      dateFrom: "2026-03-10",
    }));
  });

  it("should hide the page chrome when the preview is expanded, and bring it back on collapse", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    renderTab();
    await screen.findByText("Prospecting");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Expand table" }));

    // Then: the same mechanism the Reporting tab uses - a root modifier the stylesheet hides chrome with,
    // not a fixed overlay drawn on top of it.
    expect(document.querySelector(".dashboards-tab--expanded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse table" })).toHaveAttribute("aria-pressed", "true");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Collapse table" }));

    // Then:
    expect(document.querySelector(".dashboards-tab--expanded")).not.toBeInTheDocument();
  });

  it("should drop one column from the counted schema when it is switched off", async () => {
    // Given: a dashboard whose CPA column the user already switched off
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard({ optionalColumns: ["creative"] })]));

    // When:
    renderTab();

    // Then: 12 metrics minus CPA, and the checkbox reflects it
    await openDatasetHint();
    expect(await screen.findByText(/18 dimensions · 11 metrics/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /CPA/ })).not.toBeChecked();
  });

  it("should not write a column choice until it is applied", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    renderTab();
    await screen.findByRole("button", { name: "Apply" });
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();

    // When:
    await userEvent.click(screen.getByRole("checkbox", { name: /Creative$/ }));

    // Then: the panel's count follows the checkbox at once, while the row count keeps describing the dataset
    // that exists - it was measured under the saved selection, not the one being considered
    expect(await screen.findByRole("heading", { level: 4, name: /Dimensions 17/ })).toBeInTheDocument();
    await openDatasetHint();
    expect(screen.getByText(/18 dimensions · 12 metrics/)).toBeInTheDocument();
    expect(updateDashboard).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  it("should send the remaining columns when the choice is applied", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    vi.mocked(updateDashboard).mockResolvedValue(aDashboard({ optionalColumns: ["cpa"] }));
    renderTab();
    await screen.findByRole("button", { name: "Apply" });
    await userEvent.click(screen.getByRole("checkbox", { name: /Creative$/ }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then: the kept columns are sent, not the dropped one
    await waitFor(() => expect(updateDashboard).toHaveBeenCalledWith(42, 7, {
      name: "Client dashboard",
      optionalColumns: ["cpa"],
      columnOrder: [],
      filters: [],
      dateFrom: undefined,
      dateTo: undefined,
      displayCampaignName: undefined,
    }));
  });

  it("should write the data source with the confirmed campaign name", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    vi.mocked(createDashboardDataSource).mockResolvedValue(
      aDashboard({ status: "live", sourceTable: "p.gs_templates.acme_7_report_basic" })
    );
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: "Create data source for ClicData" }));

    // Then: the dialog names the exact BigQuery table before anything is written.
    expect(await screen.findByText(/ourisman_ford_2026_report_basic_dash_client_dashboard/)).toBeInTheDocument();

    // When: the pre-filled campaign name is edited before confirming
    const field = await screen.findByLabelText(/Campaign name shown on the dashboard/);
    await userEvent.clear(field);
    await userEvent.type(field, "Ourisman Ford");
    await userEvent.click(screen.getByRole("button", { name: "Create data source" }));

    // Then:
    await waitFor(() =>
      expect(createDashboardDataSource).toHaveBeenCalledWith(42, 7, "Ourisman Ford")
    );
  });

  it("should state a published source as one pill, with no standing call to action", async () => {
    // Given: a dashboard whose written table is in step with its definition
    vi.mocked(listDashboards).mockResolvedValue(
      aPage([aDashboard({ status: "live", sourceTable: "p.gs_templates.acme_7_report_basic", sourceRowCount: 18 })])
    );

    // When:
    renderTab();
    await screen.findByRole("button", { name: /ClicData source/ });

    // Then: nothing is urging a rewrite, and the table name is behind the pill rather than spelled across
    // the page - it matters when it is pasted into ClicData, not on every visit
    expect(screen.queryByRole("button", { name: /Update data source for ClicData/ })).not.toBeInTheDocument();
    expect(screen.queryByText("p.gs_templates.acme_7_report_basic")).not.toBeInTheDocument();

    // And the menu carries the detail and every action
    await openSourceMenu();
    expect(screen.getByText("p.gs_templates.acme_7_report_basic")).toBeInTheDocument();
    expect(screen.getByText(/18 rows written/)).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Copy table name/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Update data source" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Remove data source" })).toBeInTheDocument();
  });

  it("should keep the rewrite in the menu even once a saved change has left the table behind", async () => {
    // Given: a dashboard with a source whose definition has since changed, which the server records by
    // putting the dashboard back to draft while the table it wrote still exists
    vi.mocked(listDashboards).mockResolvedValue(
      aPage([aDashboard({ status: "draft", sourceTable: "p.gs_templates.acme_7_report_basic" })])
    );

    // When:
    renderTab();
    await screen.findByRole("button", { name: /ClicData source/ });

    // Then: one control, not two. A source that exists is spoken for by its own pill in every state, and
    // rewriting it stays where everything else about it lives.
    expect(screen.queryByRole("button", { name: /data source for ClicData/ })).not.toBeInTheDocument();
    await openSourceMenu();
    expect(screen.getByRole("menuitem", { name: "Update data source" })).toBeInTheDocument();
  });

  it("should offer the table name for copying once the source is live", async () => {
    // Given:
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    vi.mocked(listDashboards).mockResolvedValue(
      aPage([aDashboard({ status: "live", sourceTable: "p.gs_templates.acme_7_report_basic" })])
    );
    renderTab();

    // When:
    await openSourceMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /Copy table name/ }));

    // Then: the fully-qualified name, which is what ClicData needs - not the short one shown in the list
    expect(clipboard).toHaveBeenCalledWith("p.gs_templates.acme_7_report_basic");
    expect(await screen.findByRole("menuitem", { name: "Copied!" })).toBeInTheDocument();
  });

  it("should say so when the clipboard refuses rather than claiming a copy", async () => {
    // Given: an insecure context or a denied permission
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    vi.mocked(listDashboards).mockResolvedValue(
      aPage([aDashboard({ status: "live", sourceTable: "p.gs_templates.acme_7_report_basic" })])
    );
    renderTab();

    // When:
    await openSourceMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /Copy table name/ }));

    // Then: a silent "Copied!" would have the user paste their previous clipboard into ClicData
    expect(await screen.findByText(/Could not copy the table name/)).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Copied!" })).not.toBeInTheDocument();
  });

  it("should warn that the ClicData dashboard stops updating before removing a source", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(
      aPage([aDashboard({ status: "live", sourceTable: "p.gs_templates.acme_7_report_basic" })])
    );
    vi.mocked(removeDashboardDataSource).mockResolvedValue(aDashboard());
    renderTab();

    // When:
    await openSourceMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove data source" }));

    // Then: the warning names the consequence, and nothing is removed until it is accepted
    expect(await screen.findByText("Remove the ClicData data source?")).toBeInTheDocument();
    expect(removeDashboardDataSource).not.toHaveBeenCalled();
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove data source" })
    );
    await waitFor(() => expect(removeDashboardDataSource).toHaveBeenCalledWith(42, 7));
  });

  it("should confirm before deleting a dashboard that has a live source", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(
      aPage([aDashboard({ status: "live", sourceTable: "p.gs_templates.acme_7_report_basic" })])
    );
    vi.mocked(deleteDashboard).mockResolvedValue(undefined);
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Client dashboard" }));

    // When:
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    // Then: the dialog says a live source is at stake, which a draft's would not
    expect(await screen.findByText(/has a data source, and the ClicData dashboard reading it/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete dashboard" }));
    await waitFor(() => expect(deleteDashboard).toHaveBeenCalledWith(42, 7));
  });

  it("should duplicate a dashboard and select the copy", async () => {
    // Given:
    const copy = aDashboard({ id: 8, name: "Client dashboard (copy)" });
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard(), copy]));
    vi.mocked(duplicateDashboard).mockResolvedValue(copy);
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Client dashboard" }));

    // When:
    await userEvent.click(await screen.findByRole("menuitem", { name: "Duplicate" }));

    // Then:
    await waitFor(() => expect(duplicateDashboard).toHaveBeenCalledWith(42, 7));
    expect(screen.getByRole("textbox", { name: "Dashboard name" })).toHaveValue("Client dashboard (copy)");
  });

  it("should not count a dataset twice when the tab re-renders", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    const view = renderTab();
    await screen.findByRole("button", { name: "Apply" });

    // When:
    view.rerender(<div />);
    view.unmount();

    // Then: a BigQuery count is not free, so one open panel is one count
    expect(previewDashboardDataset).toHaveBeenCalledTimes(1);
  });

  it("should save the on-screen selection when writing without applying first", async () => {
    // Given: a column switched off and not applied
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    renderTab();
    await userEvent.click(await screen.findByRole("checkbox", { name: /Creative$/ }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: /create data source for clicdata/i }));

    // Then: the server writes the dashboard's stored selection, so writing has to save first - otherwise
    // the table would carry the previous columns while the screen showed the new ones
    expect(vi.mocked(updateDashboard).mock.calls[0]?.[2]).toMatchObject({ optionalColumns: ["cpa"] });
    expect(await screen.findByRole("dialog", { name: /create data source for clicdata/i })).toBeInTheDocument();
  });

  it("should not offer to rename a dashboard whose data source exists", async () => {
    // Given: a live dashboard, whose name is half of the BigQuery table name ClicData was pointed at
    vi.mocked(listDashboards).mockResolvedValue(
      aPage([aDashboard({ status: "live", sourceTable: "project.gs_templates.acme_report_basic_dash_client" })])
    );
    renderTab();

    // When:
    const nameInput = await screen.findByLabelText("Dashboard name");

    // Then: renaming would write a second table and leave ClicData on the first, so the field says so
    // instead of letting the user find out from a rejected save
    expect(nameInput).toHaveAttribute("readonly");
    expect(nameInput).toHaveAttribute("title", expect.stringContaining("Remove the data source"));
  });

  it("should expand the dataset table and give the width back on collapse", async () => {
    // Given:
    vi.mocked(listDashboards).mockResolvedValue(aPage([aDashboard()]));
    renderTab();
    const expand = await screen.findByRole("button", { name: /expand table/i });

    // When:
    await userEvent.click(expand);

    // Then: the same button is the only way back out, so it has to say so
    const collapse = await screen.findByRole("button", { name: /collapse table/i });
    expect(collapse).toHaveAttribute("aria-pressed", "true");

    // When:
    await userEvent.click(collapse);

    // Then:
    expect(await screen.findByRole("button", { name: /expand table/i })).toHaveAttribute("aria-pressed", "false");
  });
});
