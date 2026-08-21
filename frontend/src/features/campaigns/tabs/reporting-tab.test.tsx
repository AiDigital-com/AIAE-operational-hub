import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADJUSTMENT_KEY_DIM_IDS, DEFAULT_DIMS, DEFAULT_METRICS } from "../../pacing/mock/reports";
import { ToastProvider } from "../../../shared/ui/toast/toast";
import { SidebarCollapseContext } from "../../layout/app-shell/sidebar-collapse";
import type { SidebarCollapse } from "../../layout/app-shell/sidebar-collapse";
import {
  createReportView,
  deleteReportView,
  downloadBulkAdjustmentTemplate,
  downloadConversionAdjustmentTemplate,
  duplicateReportView,
  exportReportRows,
  listCampaignReportRows,
  listConversionBreakdown,
  listReportRowDistinctValues,
  listReportViews,
  saveReportRowAdjustments,
  updateReportView,
  uploadBulkAdjustments,
  uploadConversionAdjustments,
} from "../api";
import type {
  CampaignV1,
  ReportRowV1,
  ReportRowsPageResponseV1,
  ReportViewPageResponseV1,
  ReportViewV1,
} from "../types";
import type { CampaignTabContext } from "../campaign-workspace";
import { ReportingTab } from "./reporting-tab";

vi.mock("../api", () => ({
  listCampaignReportRows: vi.fn(),
  listReportRowDistinctValues: vi.fn(),
  saveReportRowAdjustments: vi.fn(),
  exportReportRows: vi.fn(),
  downloadBulkAdjustmentTemplate: vi.fn(),
  downloadConversionAdjustmentTemplate: vi.fn(),
  uploadBulkAdjustments: vi.fn(),
  uploadConversionAdjustments: vi.fn(),
  listConversionBreakdown: vi.fn(),
  applyConversionAdjustments: vi.fn(),
  listReportViews: vi.fn(),
  createReportView: vi.fn(),
  updateReportView: vi.fn(),
  deleteReportView: vi.fn(),
  duplicateReportView: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let intersectionCallbacks: IntersectionObserverCallback[] = [];

// Mirrors real IntersectionObserver semantics: disconnect() stops future notifications. Without this,
// a sentinel effect that re-registers its observer more than once (e.g. because its own enabled-state
// only settles a render or two after mount) would leave stale, disconnected callbacks in
// `intersectionCallbacks` that `intersectSentinels()` would still invoke.
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
    intersectionCallbacks = intersectionCallbacks.filter((cb) => cb !== this.callback);
  });
  takeRecords = vi.fn(() => []);
}

async function intersectSentinels() {
  await act(async () => {
    for (const callback of intersectionCallbacks) {
      callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  });
}

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

function aRow(overrides: Partial<ReportRowV1> = {}): ReportRowV1 {
  return {
    date: "2026-03-10",
    line_item_id: "LI-1",
    impressions: 5000,
    spend: 90,
    ...overrides,
  };
}

const SHARED_TOTALS: ReportRowsPageResponseV1["totals"] = {
  impressions: 60000,
  clicks: 400,
  spend: 3000,
};

function aPage(overrides: Partial<ReportRowsPageResponseV1> = {}): ReportRowsPageResponseV1 {
  return {
    content: [aRow()],
    pageNumber: 1,
    pageSize: 25,
    hasNext: true,
    totals: SHARED_TOTALS,
    min_date: "2026-03-01",
    max_date: "2026-03-31",
    distinct_line_item_count: 2,
    total_rows: 1,
    ...overrides,
  };
}

function aReportView(overrides: Partial<ReportViewV1> = {}): ReportViewV1 {
  return {
    id: 1,
    campaignId: 42,
    name: "All data",
    type: "basic",
    status: "saved",
    created: "2026-01-01T00:00:00",
    edited: null,
    dimensions: ["date", "line_item_id"],
    metrics: ["impressions", "spend"],
    filters: [],
    ...overrides,
  };
}

const SAVED_VIEW_DTO = aReportView();

// The applied dimensions ARE the server-side aggregation key, so every report-rows request carries
// them - this is what the default saved view above sends.
const DEFAULT_GROUP_BY = ["DATE", "LINE_ITEM_ID"];
// Every dimension an adjustment write carries: the raw grain, and the only grain editing is offered on
// (a coarser grouping leaves the rest of the identity null, so it could not be written back).
const RAW_GRAIN_DIMS = [...ADJUSTMENT_KEY_DIM_IDS];

function aReportViewPage(
  content: ReportViewV1[] = [SAVED_VIEW_DTO],
  overrides: Partial<ReportViewPageResponseV1> = {}
): ReportViewPageResponseV1 {
  return {
    content,
    pageNumber: 1,
    pageSize: 25,
    totalElements: content.length,
    totalPages: content.length === 0 ? 0 : 1,
    ...overrides,
  };
}

function mockReportViews(views: ReportViewV1[] = [SAVED_VIEW_DTO]) {
  vi.mocked(listReportViews).mockResolvedValue(aReportViewPage(views));
}

function renderReportingTab(campaign: CampaignV1 = aCampaign(), sidebar?: SidebarCollapse) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarCollapseContext.Provider value={sidebar ?? null}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/campaigns/42/reporting"]}>
          <Routes>
            <Route
              path="/campaigns/:campaignId"
              element={<Outlet context={{ campaign } satisfies CampaignTabContext} />}
            >
              <Route path="reporting" element={<ReportingTab />} />
              <Route path="dashboards" element={<div>Dashboards content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>
      </SidebarCollapseContext.Provider>
    </QueryClientProvider>
  );
}

/** The data table's header cells, by role - excludes the unrelated saved-reports list table, which also
 *  has `columnheader` cells on the same page. */
function dataTableHeaderCells() {
  const dataTable = document.querySelector(".reporting-tab__data-tbl") as HTMLElement;
  return within(dataTable).getAllByRole("columnheader");
}

/** One header cell, found by the label it starts with (a metric header trails its agg badge). */
function dataTableHeaderCell(label: string) {
  return dataTableHeaderCells().find((header) => header.textContent?.startsWith(label)) as HTMLElement;
}

/** The data table's header cells' text, in DOM order. A metric header trails its agg badge, hence e.g.
 *  "ImpressionsSUM". */
function dataTableColumnNames() {
  return dataTableHeaderCells().map((header) => header.textContent);
}

/** The move handle on one column's header, by the label the header shows. */
function columnGrip(label: string) {
  return screen.getByRole("button", { name: `Move ${label}` });
}

/**
 * Replaces `requestAnimationFrame`/`cancelAnimationFrame` with a manually-driven queue for one test.
 * The reordering drag's own geometry effect (reporting-tab.tsx) schedules exactly one frame at a time -
 * it calls `requestAnimationFrame` again itself at the end of every frame it runs - so capturing and
 * firing the single pending callback by hand drives it exactly that effect would, one frame at a time,
 * without waiting on the real 60Hz clock jsdom doesn't run anyway.
 */
function controlledRaf() {
  let pending: FrameRequestCallback | null = null;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    pending = cb;
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
    pending = null;
  });
  return {
    /** Runs the pending frame, if there is one - wrapped in `act` because the effect's own callback
     *  updates React state (the resolved drop boundary, the label position) outside of any event
     *  handler React itself is already batching. */
    flush() {
      const cb = pending;
      pending = null;
      if (cb) act(() => cb(0));
    },
  };
}

/**
 * Stubs the data table's header cells' bounding rects for the duration of one test - jsdom never lays
 * anything out, so the drag's own geometry (resolveDropBoundary in reporting-tab.tsx) has nothing real
 * to read without this. Columns are laid out left to right in the given order, each `width` wide,
 * starting at viewport x 0.
 */
function stubHeaderRects(order: string[], width = 160) {
  order.forEach((label, index) => {
    const left = index * width;
    const rect = {
      left,
      right: left + width,
      width,
      top: 0,
      bottom: 40,
      height: 40,
      x: left,
      y: 0,
      toJSON() {
        return this;
      },
    };
    vi.spyOn(dataTableHeaderCell(label), "getBoundingClientRect").mockReturnValue(rect as DOMRect);
  });
}

/**
 * Drives one full pointer drag: press the grip, stub the header geometry, move the cursor to `atX`
 * (optionally at a given `clientY`, to prove the vertical position never matters), let the drag's own
 * animation-frame effect resolve a boundary against it, then release.
 */
function dragColumnTo(
  from: string,
  atX: number,
  order: string[],
  raf: ReturnType<typeof controlledRaf>,
  clientY = 0
) {
  fireEvent.pointerDown(columnGrip(from), { clientX: 0, clientY: 0 });
  stubHeaderRects(order);
  fireEvent.pointerMove(window, { clientX: atX, clientY });
  raf.flush();
  fireEvent.pointerUp(window);
}

describe("ReportingTab reports list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallbacks = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage());
  });

  it("should list the campaign's saved report views", async () => {
    // Given:
    mockReportViews([SAVED_VIEW_DTO, aReportView({ id: 2, name: "Weekly reporting", status: "draft" })]);

    // When:
    renderReportingTab();

    // Then:
    expect(await screen.findByText("All data")).toBeInTheDocument();
    expect(screen.getByText("Weekly reporting")).toBeInTheDocument();
    expect(listReportViews).toHaveBeenCalledWith(42, 1, 25);
  });

  it("should write the created and edited stamps the way every other date in the tab is written", async () => {
    // Given: a report saved on one day and last touched on another
    mockReportViews([aReportView({ created: "2026-07-21T09:15:00", edited: "2026-07-22T18:40:00" })]);

    // When:
    renderReportingTab();

    // Then: "Jul 21, 2026", not "21.07.26" - the same convention as the table right below, and
    // unambiguous in a way a bare numeric date is not
    expect(await screen.findByText("Jul 21, 2026")).toBeInTheDocument();
    expect(screen.getByText("Jul 22, 2026")).toBeInTheDocument();
  });

  it("should dash the edited stamp of a report that has never been edited", async () => {
    // Given:
    mockReportViews([aReportView({ created: "2026-07-21T09:15:00", edited: null })]);

    // When:
    renderReportingTab();

    // Then:
    expect(await screen.findByText("Jul 21, 2026")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("should load the next saved-report page when the reports sentinel intersects", async () => {
    // Given:
    vi.mocked(listReportViews).mockImplementation((_campaignId, pageNumber) =>
      Promise.resolve(
        pageNumber === 1
          ? aReportViewPage([SAVED_VIEW_DTO], { pageNumber: 1, totalElements: 2, totalPages: 2 })
          : aReportViewPage([aReportView({ id: 2, name: "Weekly reporting" })], {
              pageNumber: 2,
              totalElements: 2,
              totalPages: 2,
            })
      )
    );

    // When:
    renderReportingTab();
    await screen.findByText("All data");
    await intersectSentinels();

    // Then:
    await screen.findByText("Weekly reporting");
    expect(listReportViews).toHaveBeenNthCalledWith(2, 42, 2, 25);
  });

  it("should show the server total saved-report count even when only page one is loaded", async () => {
    // Given:
    vi.mocked(listReportViews).mockResolvedValue(
      aReportViewPage([SAVED_VIEW_DTO], { totalElements: 42, totalPages: 2 })
    );

    // When:
    renderReportingTab();

    // Then:
    expect(await screen.findByText("42 saved reports")).toBeInTheDocument();
  });

  it("should show the empty state when no report views exist", async () => {
    // Given:
    mockReportViews([]);

    // When:
    renderReportingTab();

    // Then:
    expect(await screen.findByText("Create your first report")).toBeInTheDocument();
  });

  it("should never call the BigQuery-backed report-rows endpoint when there are no saved reports", async () => {
    // Given:
    mockReportViews([]);

    // When:
    renderReportingTab();
    await screen.findByText("Create your first report");

    // Then: the empty state renders without ever paying for the report-rows query
    expect(listCampaignReportRows).not.toHaveBeenCalled();
  });

  it("should call the report-rows endpoint once a saved report exists", async () => {
    // Given:
    mockReportViews([SAVED_VIEW_DTO]);

    // When:
    renderReportingTab();

    // Then:
    await waitFor(() => expect(listCampaignReportRows).toHaveBeenCalledTimes(1));
  });

  it("should surface an error when the report-view list fails", async () => {
    // Given:
    vi.mocked(listReportViews).mockRejectedValue(new Error("boom"));

    // When:
    renderReportingTab();

    // Then:
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("should create a report and select it", async () => {
    // Given:
    const newViewDto = aReportView({
      id: 5,
      name: "Weekly reporting",
      status: "draft",
      note: "Weekly client deck pull",
    });
    vi.mocked(listReportViews)
      .mockResolvedValueOnce(aReportViewPage([SAVED_VIEW_DTO]))
      .mockResolvedValueOnce(aReportViewPage([SAVED_VIEW_DTO, newViewDto]));
    vi.mocked(createReportView).mockResolvedValue(newViewDto);
    renderReportingTab();
    await screen.findAllByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Create report" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Basic" }));
    await userEvent.type(screen.getByRole("textbox", { name: "New report name" }), "  Weekly reporting  ");
    await userEvent.type(screen.getByRole("textbox", { name: "Description" }), "Weekly client deck pull");
    await userEvent.click(screen.getByRole("button", { name: "Create Basic report" }));

    // Then: exactly one create call, with trimmed name, note, and default type/status/dimensions/metrics
    await waitFor(() => expect(createReportView).toHaveBeenCalledTimes(1));
    expect(createReportView).toHaveBeenCalledWith(42, {
      name: "Weekly reporting",
      note: "Weekly client deck pull",
      type: "basic",
      status: "draft",
      dimensions: DEFAULT_DIMS,
      metrics: DEFAULT_METRICS,
      filters: [],
      columnOrder: [],
    });
    // ...and the new view becomes selected once the list refetches to include it
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Report name" })).toHaveValue("Weekly reporting")
    );
  });

  it("should require a non-blank report name before creating", async () => {
    // Given:
    mockReportViews([SAVED_VIEW_DTO]);
    renderReportingTab();
    await screen.findAllByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Create report" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Basic" }));
    await userEvent.click(screen.getByRole("button", { name: "Create Basic report" }));

    // Then:
    expect(await screen.findByText("Report name is required.")).toBeInTheDocument();
    expect(createReportView).not.toHaveBeenCalled();
  });

  it("should surface an error toast when submitting a new report fails", async () => {
    // Given:
    vi.mocked(createReportView).mockRejectedValue(new Error("name already exists"));
    mockReportViews([SAVED_VIEW_DTO]);
    renderReportingTab();
    await screen.findAllByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Create report" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Basic" }));
    await userEvent.type(screen.getByRole("textbox", { name: "New report name" }), "Weekly reporting");
    await userEvent.click(screen.getByRole("button", { name: "Create Basic report" }));

    // Then:
    expect(await screen.findByText("name already exists")).toBeInTheDocument();
  });

  it("should duplicate a report and select the copy", async () => {
    // Given:
    const copyDto = aReportView({ id: 2, name: "All data (copy)", status: "draft" });
    vi.mocked(listReportViews)
      .mockResolvedValueOnce(aReportViewPage([SAVED_VIEW_DTO]))
      .mockResolvedValueOnce(aReportViewPage([SAVED_VIEW_DTO, copyDto]));
    vi.mocked(duplicateReportView).mockResolvedValue(copyDto);
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Actions for All data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    // Then:
    await waitFor(() => expect(duplicateReportView).toHaveBeenCalledWith(42, 1));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Report name" })).toHaveValue("All data (copy)")
    );
  });

  it("should update report name and description from the Rename action", async () => {
    // Given:
    const viewWithNote = aReportView({ note: "Old description" });
    mockReportViews([viewWithNote]);
    vi.mocked(updateReportView).mockResolvedValue({
      ...viewWithNote,
      name: "Weekly reporting",
      note: "Weekly client deck pull",
    });
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Actions for All data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Rename report name" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Rename report name" }), "  Weekly reporting  ");
    await userEvent.clear(screen.getByRole("textbox", { name: "Rename report description" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Rename report description" }), "Weekly client deck pull");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Then:
    await waitFor(() => expect(updateReportView).toHaveBeenCalledTimes(1));
    expect(updateReportView).toHaveBeenCalledWith(42, 1, {
      name: "Weekly reporting",
      note: "Weekly client deck pull",
      type: "basic",
      status: "saved",
      dimensions: ["date", "line_item_id"],
      metrics: ["impressions", "spend"],
      filters: [],
      columnOrder: [],
    });
    expect(await screen.findByText("Report updated.")).toBeInTheDocument();
  });

  it("should disable Apply once every dimension and metric is cleared", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();

    // When: clear both pickers
    await userEvent.click(within(screen.getByText("Dimensions").closest("h4")!.parentElement!).getByText("Clear"));
    await userEvent.click(within(screen.getByText("Metrics").closest("h4")!.parentElement!).getByText("Clear"));

    // Then:
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("should show a short description under each metric in the metric picker", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then:
    expect(screen.getByText("Total ad impressions delivered.")).toBeInTheDocument();
  });

  it("should delete a report and clear the selection", async () => {
    // Given:
    vi.mocked(listReportViews)
	      .mockResolvedValueOnce(aReportViewPage([SAVED_VIEW_DTO]))
	      .mockResolvedValueOnce(aReportViewPage([]));
    vi.mocked(deleteReportView).mockResolvedValue(undefined);
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Actions for All data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: 'Delete "All data"?' });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete report" }));

    // Then:
    await waitFor(() => expect(deleteReportView).toHaveBeenCalledWith(42, 1));
    expect(await screen.findByText("Create your first report")).toBeInTheDocument();
    expect(await screen.findByText("Report deleted.")).toBeInTheDocument();
  });

  it("should not delete when the user cancels the delete dialog", async () => {
    // Given:
    mockReportViews([SAVED_VIEW_DTO]);
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Actions for All data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: 'Delete "All data"?' });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // Then:
    expect(deleteReportView).not.toHaveBeenCalled();
    expect(screen.getByText("All data")).toBeInTheDocument();
  });

  it("should save the report config in a single PUT", async () => {
    // Given:
    mockReportViews([SAVED_VIEW_DTO]);
    vi.mocked(updateReportView).mockResolvedValue({ ...SAVED_VIEW_DTO, status: "saved" });
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Save report" }));

    // Then: exactly one PUT, carrying the status change and the current config together
    await waitFor(() => expect(updateReportView).toHaveBeenCalledTimes(1));
    expect(updateReportView).toHaveBeenCalledWith(42, 1, {
      name: "All data",
      type: "basic",
      status: "saved",
      dimensions: ["date", "line_item_id"],
      metrics: ["impressions", "spend"],
      filters: [],
      columnOrder: [],
    });
    expect(await screen.findByText("Report saved.")).toBeInTheDocument();
  });

  it("should surface an error toast when saving the report config fails", async () => {
    // Given:
    mockReportViews([SAVED_VIEW_DTO]);
    vi.mocked(updateReportView).mockRejectedValue(new Error("boom"));
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Save report" }));

    // Then:
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("should save the edited report name only when Save report is clicked", async () => {
    // Given:
    mockReportViews([SAVED_VIEW_DTO]);
    vi.mocked(updateReportView).mockResolvedValue({ ...SAVED_VIEW_DTO, name: "All data v2" });
    renderReportingTab();
    await screen.findByText("LI-1");
    const nameInput = screen.getByRole("textbox", { name: "Report name" });

    // When: typing without blurring
    await userEvent.type(nameInput, " v2");

    // Then: no request yet - request count matters, not just eventual correctness
    expect(updateReportView).not.toHaveBeenCalled();

    // When: blur validates/trims locally, but does not persist metadata by itself
    await userEvent.tab();

    // Then:
    expect(updateReportView).not.toHaveBeenCalled();

    // When: Save report commits name and config together
    await userEvent.click(screen.getByRole("button", { name: "Save report" }));

    // Then:
    await waitFor(() => expect(updateReportView).toHaveBeenCalledTimes(1));
    expect(updateReportView).toHaveBeenCalledWith(42, 1, expect.objectContaining({ name: "All data v2" }));
  });

  it("should not render a report description field in the builder", async () => {
    // Given:
    mockReportViews([SAVED_VIEW_DTO]);
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then:
    expect(screen.queryByRole("textbox", { name: "Report description" })).not.toBeInTheDocument();
  });
});

describe("ReportingTab pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallbacks = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    mockReportViews();
  });

  it("should request only page one on initial render", async () => {
    // Given:
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage());

    // When:
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then:
    expect(listCampaignReportRows).toHaveBeenCalledTimes(1);
    expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, { filters: [], groupBy: DEFAULT_GROUP_BY, sortField: undefined, sortDirection: undefined });
  });

  it("should show a scroll sentinel while more pages remain", async () => {
    // Given:
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage({ pageNumber: 1, hasNext: true }));

    // When:
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then:
    expect(document.querySelector(".reporting-tab__load-more")).toBeInTheDocument();
  });

  it("should load page two when the scroll sentinel intersects", async () => {
    // Given:
    vi.mocked(listCampaignReportRows).mockImplementation((_campaignId, pageNumber) =>
      Promise.resolve(
        pageNumber === 1
          ? aPage({ pageNumber: 1, hasNext: true, content: [aRow({ line_item_id: "LI-1" })] })
          : aPage({ pageNumber: 2, hasNext: false, content: [aRow({ line_item_id: "LI-2" })] })
      )
    );
    renderReportingTab();
    await screen.findAllByText("LI-1");

    // When: the IntersectionObserver reports the sentinel row is now visible
    await intersectSentinels();

    // Then:
    await screen.findByText("LI-2");
    expect(listCampaignReportRows).toHaveBeenCalledTimes(2);
    expect(listCampaignReportRows).toHaveBeenNthCalledWith(2, 42, 2, 25, { filters: [], groupBy: DEFAULT_GROUP_BY, sortField: undefined, sortDirection: undefined });
  });

  it("should stop showing the sentinel once the last page has loaded", async () => {
    // Given: a single, complete page (no more rows past it)
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage({ pageNumber: 1, hasNext: false }));

    // When:
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then:
    expect(document.querySelector(".reporting-tab__load-more")).not.toBeInTheDocument();
    expect(listCampaignReportRows).toHaveBeenCalledTimes(1);
  });

  it("should mark a derived ratio as weighted, not averaged, in its column header", async () => {
    // Given: a report showing CPM alongside a summed metric
    mockReportViews([aReportView({ dimensions: ["date", "line_item_id"], metrics: ["impressions", "cpm"] })]);

    // When:
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then: WTD, not AVG. The totals row re-derives CPM from summed spend over summed impressions;
    // calling that "AVG" invited reproducing it with Excel's AVERAGE, which answers a different
    // question - six rows whose weighted CPM is $1.45 average out to $1.638.
    const cpmHeader = screen.getByRole("button", { name: /^Client CPM/ });
    expect(within(cpmHeader).getByText("WTD")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /^Impressions/ })).getByText("SUM")).toBeInTheDocument();
  });

  it("should leave a ratio blank when the row has nothing to divide by", async () => {
    // Given: a line that cost money and got no clicks at all
    mockReportViews([aReportView({ dimensions: ["line_item_id"], metrics: ["spend", "cpc"] })]);
    vi.mocked(listCampaignReportRows).mockResolvedValue(
      aPage({ content: [aRow({ spend: 90, clicks: 0 })] })
    );

    // When:
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then: "—", not "$0.00" - that line has no CPC rather than a CPC of nothing, and the export
    // already leaves the same cell blank
    const row = screen.getByText("LI-1").closest("tr") as HTMLElement;
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("should keep the totals row from the server's full-dataset totals after loading more pages", async () => {
    // Given: both pages report the exact same full-dataset totals (computed server-side)
    vi.mocked(listCampaignReportRows).mockImplementation((_campaignId, pageNumber) =>
      Promise.resolve(
        pageNumber === 1
          ? aPage({ pageNumber: 1, hasNext: true, content: [aRow({ line_item_id: "LI-1" })] })
          : aPage({ pageNumber: 2, hasNext: false, content: [aRow({ line_item_id: "LI-2", impressions: 999 })] })
      )
    );
    renderReportingTab();
    await screen.findByText("LI-1");
    const totalsRowBefore = document.querySelector(".reporting-tab__totals") as HTMLElement;
    expect(within(totalsRowBefore).getByText("60,000")).toBeInTheDocument();

    // When:
    await intersectSentinels();
    await screen.findByText("LI-2");

    // Then: the totals row still reads the server total, not a recomputed sum including the new row's 999
    const totalsRowAfter = document.querySelector(".reporting-tab__totals") as HTMLElement;
    expect(within(totalsRowAfter).getByText("60,000")).toBeInTheDocument();
    expect(within(totalsRowAfter).queryByText("999")).not.toBeInTheDocument();
  });
});

describe("ReportingTab constructed-level column headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallbacks = [];
    mockReportViews();
  });

  it("should head a level column with the platform's own term when every row shares one platform", async () => {
    // Given: on DV360 level 1 is the line item
    vi.mocked(listCampaignReportRows).mockResolvedValue(
      aPage({ content: [aRow({ platform: "dv_360_dlv" }), aRow({ platform: "dv_360_dlv", line_item_id: "LI-2" })] })
    );

    // When:
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then:
    expect(screen.getByRole("button", { name: "Line item id" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Constructed id L1" })).not.toBeInTheDocument();
  });

  it("should fall back to the neutral level label when the rows' platforms disagree about level 1", async () => {
    // Given: level 1 is the line item on DV360 but the campaign on Google Ads, so neither name fits
    vi.mocked(listCampaignReportRows).mockResolvedValue(
      aPage({ content: [aRow({ platform: "dv_360_dlv" }), aRow({ platform: "Google Ads", line_item_id: "LI-2" })] })
    );

    // When:
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then:
    expect(screen.getByRole("button", { name: "Constructed id L1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Line item id" })).not.toBeInTheDocument();
  });

  it("should keep the neutral level label for a platform missing from the naming-levels table", async () => {
    // Given: Snapchat is not in it, so its levels are never guessed at
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage({ content: [aRow({ platform: "Snapchat" })] }));

    // When:
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then:
    expect(screen.getByRole("button", { name: "Constructed id L1" })).toBeInTheDocument();
  });
});

describe("ReportingTab sorting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallbacks = [];
    mockReportViews();
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage());
  });

  it("should sort ascending by the clicked dimension, restarting from page one", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    vi.mocked(listCampaignReportRows).mockClear();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Date" }));

    // Then:
    await waitFor(() => expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, { filters: [], groupBy: DEFAULT_GROUP_BY, sortField: "DATE", sortDirection: "ASC" }));
  });

  it("should flip to descending when the same dimension header is clicked again", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Date" }));
    await waitFor(() => expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, { filters: [], groupBy: DEFAULT_GROUP_BY, sortField: "DATE", sortDirection: "ASC" }));
    vi.mocked(listCampaignReportRows).mockClear();

    // When: the header now reads "Date ▲", so match loosely
    await userEvent.click(screen.getByRole("button", { name: /^Date/ }));

    // Then:
    await waitFor(() => expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, { filters: [], groupBy: DEFAULT_GROUP_BY, sortField: "DATE", sortDirection: "DESC" }));
  });

  it("should sort by a clicked metric column, not just dimensions", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    vi.mocked(listCampaignReportRows).mockClear();

    // When:
    await userEvent.click(screen.getByRole("button", { name: /^Impressions/ }));

    // Then:
    await waitFor(() => expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, { filters: [], groupBy: DEFAULT_GROUP_BY, sortField: "IMPRESSIONS", sortDirection: "ASC" }));
  });

  it("should switch to the newly-clicked dimension ascending, not keep the previous column's direction", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Date" }));
    await waitFor(() => expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, { filters: [], groupBy: DEFAULT_GROUP_BY, sortField: "DATE", sortDirection: "ASC" }));
    await userEvent.click(screen.getByRole("button", { name: /^Date/ }));
    await waitFor(() => expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, { filters: [], groupBy: DEFAULT_GROUP_BY, sortField: "DATE", sortDirection: "DESC" }));
    vi.mocked(listCampaignReportRows).mockClear();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Constructed id L1" }));

    // Then:
    await waitFor(() => expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, { filters: [], groupBy: DEFAULT_GROUP_BY, sortField: "LINE_ITEM_ID", sortDirection: "ASC" }));
  });

  it("should disable every sort header and show an overlay while a resort is in flight", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    const pending = deferred<ReportRowsPageResponseV1>();
    vi.mocked(listCampaignReportRows).mockReturnValue(pending.promise);

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Date" }));

    // Then: a table-wide overlay appears and every sort header is disabled mid-fetch
    expect(await screen.findByRole("status", { name: "Updating…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Date" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Constructed id L1" })).toBeDisabled();

    // When: the fetch resolves
    pending.resolve(aPage());

    // Then: the overlay clears and headers are clickable again
    await waitFor(() => expect(screen.queryByRole("status", { name: "Updating…" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Date" })).not.toBeDisabled();
  });
});

describe("ReportingTab filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallbacks = [];
    mockReportViews();
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage());
    vi.mocked(listReportRowDistinctValues).mockResolvedValue(["Display", "Video"]);
  });

  it("should open a dimension's filter popover showing its distinct values as checkboxes", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Filter Constructed id L1" }));

    // Then:
    const popover = await screen.findByRole("dialog", { name: "Filter — Constructed id L1" });
    expect(within(popover).getByText("Display")).toBeInTheDocument();
    expect(within(popover).getByText("Video")).toBeInTheDocument();
    expect(listReportRowDistinctValues).toHaveBeenCalledWith(42, "LINE_ITEM_ID");
  });

  it("should apply the checked values on Done, restarting the table from page one", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Filter Constructed id L1" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Constructed id L1" });
    vi.mocked(listCampaignReportRows).mockClear();

    // When:
    await userEvent.click(within(popover).getByText("Display"));
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));

    // Then:
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [{ field: "LINE_ITEM_ID", values: ["Display"] }],
        groupBy: DEFAULT_GROUP_BY,
        sortField: undefined,
        sortDirection: undefined,
      })
    );
    expect(screen.queryByRole("dialog", { name: "Filter — Constructed id L1" })).not.toBeInTheDocument();
  });

  it("should save active filters with the report view", async () => {
    // Given:
    mockReportViews([SAVED_VIEW_DTO]);
    vi.mocked(updateReportView).mockResolvedValue({ ...SAVED_VIEW_DTO, status: "saved" });
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Filter Constructed id L1" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Constructed id L1" });
    await userEvent.click(within(popover).getByText("Display"));
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [{ field: "LINE_ITEM_ID", values: ["Display"] }],
        groupBy: DEFAULT_GROUP_BY,
        sortField: undefined,
        sortDirection: undefined,
      })
    );

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Save report" }));

    // Then:
    await waitFor(() => expect(updateReportView).toHaveBeenCalledTimes(1));
    expect(updateReportView).toHaveBeenCalledWith(42, 1, expect.objectContaining({
      filters: [{ field: "LINE_ITEM_ID", values: ["Display"] }],
    }));
  });

  it("should save the active date window with the report view", async () => {
    // Given:
    mockReportViews([SAVED_VIEW_DTO]);
    vi.mocked(updateReportView).mockResolvedValue({ ...SAVED_VIEW_DTO, status: "saved" });
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Filter Date" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Date" });
    await userEvent.type(within(popover).getByLabelText("From"), "2026-03-10");
    await userEvent.type(within(popover).getByLabelText("To"), "2026-03-20");
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [],
        groupBy: DEFAULT_GROUP_BY,
        dateFrom: "2026-03-10",
        dateTo: "2026-03-20",
        sortField: undefined,
        sortDirection: undefined,
      })
    );

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Save report" }));

    // Then:
    await waitFor(() => expect(updateReportView).toHaveBeenCalledTimes(1));
    expect(updateReportView).toHaveBeenCalledWith(42, 1, expect.objectContaining({
      filters: [{ field: "DATE", values: ["2026-03-10", "2026-03-20"] }],
    }));
  });

  it("should save a one-day date window as explicit from and to values", async () => {
    // Given:
    mockReportViews([SAVED_VIEW_DTO]);
    vi.mocked(updateReportView).mockResolvedValue({ ...SAVED_VIEW_DTO, status: "saved" });
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Filter Date" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Date" });
    await userEvent.type(within(popover).getByLabelText("From"), "2026-03-10");
    await userEvent.type(within(popover).getByLabelText("To"), "2026-03-10");
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Save report" }));

    // Then:
    await waitFor(() => expect(updateReportView).toHaveBeenCalledTimes(1));
    expect(updateReportView).toHaveBeenCalledWith(42, 1, expect.objectContaining({
      filters: [{ field: "DATE", values: ["2026-03-10", "2026-03-10"] }],
    }));
  });

  it("should hydrate saved filters when opening a saved report", async () => {
    // Given:
    mockReportViews([
      aReportView({
        filters: [{ field: "LINE_ITEM_ID", values: ["Display"] }],
      }),
    ]);
    renderReportingTab();

    // Then:
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [{ field: "LINE_ITEM_ID", values: ["Display"] }],
        groupBy: DEFAULT_GROUP_BY,
        sortField: undefined,
        sortDirection: undefined,
      })
    );
    expect(screen.getByRole("button", { name: "Filter Constructed id L1" })).toHaveClass("reporting-tab__filter-btn--active");
  });

  it("should clear saved filters when switching to a report without filters", async () => {
    // Given:
    const filtered = aReportView({
      id: 1,
      name: "Filtered",
      filters: [{ field: "LINE_ITEM_ID", values: ["Display"] }],
    });
    const unfiltered = aReportView({ id: 2, name: "No filters", filters: [] });
    mockReportViews([filtered, unfiltered]);
    renderReportingTab();
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [{ field: "LINE_ITEM_ID", values: ["Display"] }],
        groupBy: DEFAULT_GROUP_BY,
        sortField: undefined,
        sortDirection: undefined,
      })
    );

    // When:
    await userEvent.click(screen.getByText("No filters"));

    // Then: the active filter state is cleared. The unfiltered rows may come from React Query's
    // already-warm filters:[] cache, so this should not require a duplicate network call.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Filter Constructed id L1" })).not.toHaveClass("reporting-tab__filter-btn--active")
    );
  });

  it("should discard a staged selection when closed without clicking Done", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Filter Constructed id L1" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Constructed id L1" });
    await userEvent.click(within(popover).getByText("Display"));
    vi.mocked(listCampaignReportRows).mockClear();

    // When: clicking outside the popover instead of Done
    await userEvent.click(document.body);

    // Then: no new fetch, and reopening shows no value checked
    expect(screen.queryByRole("dialog", { name: "Filter — Constructed id L1" })).not.toBeInTheDocument();
    expect(listCampaignReportRows).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Filter Constructed id L1" }));
    const reopened = await screen.findByRole("dialog", { name: "Filter — Constructed id L1" });
    expect((within(reopened).getByText("Display").closest("label") as HTMLLabelElement).querySelector("input")).not.toBeChecked();
  });

  it("should filter dates by a range instead of a value per date", async () => {
    // Given: the Date column's filter, which is a window rather than a checkbox list - a quarter would
    // be ninety checkboxes, and the distinct-value list a picker draws from is capped server-side
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Filter Date" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Date" });
    await userEvent.type(within(popover).getByLabelText("From"), "2026-03-10");
    await userEvent.type(within(popover).getByLabelText("To"), "2026-03-20");
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));

    // Then: one re-read for the window, both bounds sent
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [],
        groupBy: DEFAULT_GROUP_BY,
        dateFrom: "2026-03-10",
        dateTo: "2026-03-20",
        sortField: undefined,
        sortDirection: undefined,
      })
    );
    expect(screen.getByRole("button", { name: "Filter Date" })).toHaveClass("reporting-tab__filter-btn--active");
  });

  it("should refuse to apply a date window whose start is after its end", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Filter Date" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Date" });
    const from = within(popover).getByLabelText("From");
    const to = within(popover).getByLabelText("To");
    // fireEvent.change: userEvent.type on type=date is flaky across browsers/jsdom
    fireEvent.change(from, { target: { value: "2026-08-04" } });
    fireEvent.change(to, { target: { value: "2026-07-01" } });
    vi.mocked(listCampaignReportRows).mockClear();

    // Then: Done is disabled and the inverted range is explained; no fetch fires
    expect(within(popover).getByText("The start date is after the end date.")).toBeInTheDocument();
    expect(within(popover).getByRole("button", { name: "Done" })).toBeDisabled();
    expect(listCampaignReportRows).not.toHaveBeenCalled();
  });

  it("should drop an obsolete saved single-date filter when opening a saved report", async () => {
    // Given: a report saved before Date used the explicit [from, to] window shape
    mockReportViews([aReportView({ filters: [{ field: "DATE", values: ["2025-11-13"] }] })]);
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then: the obsolete Date shape is ignored rather than guessed into a different current window
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [],
        groupBy: DEFAULT_GROUP_BY,
        dateFrom: undefined,
        dateTo: undefined,
        sortField: undefined,
        sortDirection: undefined,
      })
    );
    expect(screen.queryByText(/^Date: /)).not.toBeInTheDocument();
  });

  it("should hydrate a saved date-window filter when opening a saved report", async () => {
    // Given: the shape Save report writes for the Date popover's From/To window
    mockReportViews([aReportView({ filters: [{ field: "DATE", values: ["2026-03-10", "2026-03-20"] }] })]);
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then: after a refresh, the report opens with the same requested window
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [],
        groupBy: DEFAULT_GROUP_BY,
        dateFrom: "2026-03-10",
        dateTo: "2026-03-20",
        sortField: undefined,
        sortDirection: undefined,
      })
    );
    expect(screen.getByText("Date: Mar 10, 2026 — Mar 20, 2026")).toBeInTheDocument();
  });

  it("should drop a report's saved multi-date filter rather than widen it into a range", async () => {
    // Given: a report saved with three separate delivery dates picked
    mockReportViews([
      aReportView({ filters: [{ field: "DATE", values: ["2025-11-13", "2025-11-20", "2025-11-27"] }] }),
    ]);
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then: the full period, not Nov 13 - Nov 27 - a window would silently add the fortnight between
    // those dates, and the calendar cannot express or edit a set of separate days at all
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [],
        groupBy: DEFAULT_GROUP_BY,
        dateFrom: undefined,
        dateTo: undefined,
        sortField: undefined,
        sortDirection: undefined,
      })
    );
    expect(screen.queryByText(/^Date: /)).not.toBeInTheDocument();
  });

  it("should keep a saved filter on any other dimension as a value list", async () => {
    // Given: a report saved narrowed to two platforms, showing the column it narrows
    mockReportViews([
      aReportView({
        dimensions: ["date", "platform", "line_item_id"],
        filters: [{ field: "PLATFORM", values: ["dv_360_dlv", "TTD"] }],
      }),
    ]);
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then: only Date changed shape - every other dimension still filters by value
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [{ field: "PLATFORM", values: ["dv_360_dlv", "TTD"] }],
        groupBy: ["DATE", "PLATFORM", "LINE_ITEM_ID"],
        sortField: undefined,
        sortDirection: undefined,
      })
    );
    expect(screen.getByText("Platform: 2 values")).toBeInTheDocument();
  });

  it("should list every narrowing above the table, and clear one on demand", async () => {
    // Given: a report narrowed to one delivery date
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Filter Date" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Date" });
    await userEvent.type(within(popover).getByLabelText("From"), "2026-03-10");
    await userEvent.type(within(popover).getByLabelText("To"), "2026-03-20");
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));

    // Then: what the rows have been reduced to is legible without reopening the popover it came from
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenLastCalledWith(42, 1, 25, {
        filters: [],
        groupBy: DEFAULT_GROUP_BY,
        dateFrom: "2026-03-10",
        dateTo: "2026-03-20",
        sortField: undefined,
        sortDirection: undefined,
      })
    );
    expect(screen.getByText("Date: Mar 10, 2026 — Mar 20, 2026")).toBeInTheDocument();

    // When: cleared from the chip rather than from the column header
    await userEvent.click(screen.getByRole("button", { name: "Clear the Date filter" }));

    // Then: gone, and the unwindowed view is back - no new request, since that view is the one already
    // in the cache from before the window was applied
    await waitFor(() => expect(screen.queryByText(/^Date: /)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Filter Date" }))
      .not.toHaveClass("reporting-tab__filter-btn--active");
  });

  it("should drop a dimension's filter when Apply stops showing that dimension", async () => {
    // Given: a report narrowed to one delivery date
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Filter Date" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Date" });
    await userEvent.type(within(popover).getByLabelText("From"), "2026-03-10");
    await userEvent.type(within(popover).getByLabelText("To"), "2026-03-10");
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByText("Date: Mar 10, 2026 — Mar 10, 2026")).toBeInTheDocument());
    vi.mocked(listCampaignReportRows).mockClear();

    // When: the Date dimension is dropped from the report, taking its column and filter icon with it
    const dimensions = within(screen.getByText("Dimensions").closest(".reporting-tab__picker") as HTMLElement);
    await userEvent.click(dimensions.getByRole("checkbox", { name: "Date" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then: the window goes with the column - it could not be reached or undone once its header was
    // gone, and would have kept the report on a single day of a campaign
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenLastCalledWith(42, 1, 25, {
        filters: [],
        groupBy: ["LINE_ITEM_ID"],
        dateFrom: undefined,
        dateTo: undefined,
        sortField: undefined,
        sortDirection: undefined,
      })
    );
    expect(screen.queryByText(/^Date: /)).not.toBeInTheDocument();
  });

  it("should state the dates the campaign has without clamping the pickers to them", async () => {
    // Given: the response's own min/max delivery dates
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Filter Date" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Date" });

    // Then: the range is stated, not enforced - min/max clamped to a one-day dataset leaves a picker
    // that offers exactly that day and refuses every keystroke
    expect(within(popover).getByText(/Data available Mar 1, 2026 — Mar 31, 2026/)).toBeInTheDocument();
    expect(within(popover).getByLabelText("From")).not.toHaveAttribute("min");
    expect(within(popover).getByLabelText("From")).not.toHaveAttribute("max");
    expect(within(popover).getByLabelText("To")).not.toHaveAttribute("min");
    expect(within(popover).getByLabelText("To")).not.toHaveAttribute("max");
  });

  it("should keep the date filter popover under its column's filter icon while the page scrolls", async () => {
    // Given: an open Date filter, anchored under the header's filter button
    renderReportingTab();
    await screen.findByText("LI-1");
    const trigger = screen.getByRole("button", { name: "Filter Date" });
    trigger.getBoundingClientRect = () => ({ left: 120, bottom: 300, top: 280, right: 140,
      width: 20, height: 20, x: 120, y: 280, toJSON: () => ({}) }) as DOMRect;
    await userEvent.click(trigger);
    const popover = await screen.findByRole("dialog", { name: "Filter — Date" });
    expect(popover).toHaveStyle({ left: "120px", top: "306px" });

    // When: the table scrolls, taking the header - and the button - with it
    trigger.getBoundingClientRect = () => ({ left: 120, bottom: 90, top: 70, right: 140,
      width: 20, height: 20, x: 120, y: 70, toJSON: () => ({}) }) as DOMRect;
    fireEvent.scroll(document);

    // Then: the popover followed rather than staying behind, detached from its column
    await waitFor(() => expect(popover).toHaveStyle({ left: "120px", top: "96px" }));
  });

  it("should send only the bound that was given when the window is open-ended", async () => {
    // Given: "everything from the 10th onwards"
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Filter Date" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Date" });
    await userEvent.type(within(popover).getByLabelText("From"), "2026-03-10");
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));

    // Then: the unset side is absent, not blank
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [],
        groupBy: DEFAULT_GROUP_BY,
        dateFrom: "2026-03-10",
        dateTo: undefined,
        sortField: undefined,
        sortDirection: undefined,
      })
    );
  });

  it("should mark the filter icon active once a filter is applied", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Filter Constructed id L1" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Constructed id L1" });
    await userEvent.click(within(popover).getByText("Display"));

    // When:
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));

    // Then:
    expect(screen.getByRole("button", { name: "Filter Constructed id L1" })).toHaveClass("reporting-tab__filter-btn--active");
  });

  it("should select all and clear values within the popover", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Filter Constructed id L1" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Constructed id L1" });

    // When:
    await userEvent.click(within(popover).getByRole("button", { name: "Select all" }));

    // Then:
    expect((within(popover).getByText("Display").closest("label") as HTMLLabelElement).querySelector("input")).toBeChecked();
    expect((within(popover).getByText("Video").closest("label") as HTMLLabelElement).querySelector("input")).toBeChecked();

    // When:
    await userEvent.click(within(popover).getByRole("button", { name: "Clear" }));

    // Then:
    expect((within(popover).getByText("Display").closest("label") as HTMLLabelElement).querySelector("input")).not.toBeChecked();
    expect((within(popover).getByText("Video").closest("label") as HTMLLabelElement).querySelector("input")).not.toBeChecked();
  });
});

describe("ReportingTab dimension grouping", () => {
  /** The Dimensions picker, scoped so its checkboxes/actions can't be confused with the Metrics one. */
  function dimensionPicker() {
    return within(screen.getByText("Dimensions").closest(".reporting-tab__picker") as HTMLElement);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallbacks = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    mockReportViews();
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage());
  });

  it("should read the table grouped by the selected dimensions on the very first fetch", async () => {
    // Given / When: a saved view grouping by date + constructed id L1
    renderReportingTab();

    // Then: hydrating the selected report must not cost a second read at the default grain
    await screen.findByText("LI-1");
    expect(listCampaignReportRows).toHaveBeenCalledTimes(1);
    expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
      filters: [],
      groupBy: DEFAULT_GROUP_BY,
      sortField: undefined,
      sortDirection: undefined,
    });
  });

  it("should re-read the table at the new grain when Apply narrows the dimensions", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    vi.mocked(listCampaignReportRows).mockClear();

    // When: date is dropped from the dimensions and the narrower report applied
    await userEvent.click(dimensionPicker().getByRole("checkbox", { name: "Date" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then: the server regroups and re-aggregates - Apply is not a column-hiding re-render
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [],
        groupBy: ["LINE_ITEM_ID"],
        sortField: undefined,
        sortDirection: undefined,
      })
    );
    expect(listCampaignReportRows).toHaveBeenCalledTimes(1);
  });

  it("should drop a dimension sort when Apply stops showing that dimension", async () => {
    // Given: the table sorted by the date column
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Date" }));
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [],
        groupBy: DEFAULT_GROUP_BY,
        sortField: "DATE",
        sortDirection: "ASC",
      })
    );
    vi.mocked(listCampaignReportRows).mockClear();

    // When: that very dimension is deselected and applied
    await userEvent.click(dimensionPicker().getByRole("checkbox", { name: "Date" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then: back to the server's default order - a grouped read cannot order by an ungrouped column
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [],
        groupBy: ["LINE_ITEM_ID"],
        sortField: undefined,
        sortDirection: undefined,
      })
    );
  });

  it("should keep a metric sort when the dimensions narrow, since metrics are aggregated not grouped", async () => {
    // Given: the table sorted by a metric column
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: /^Impressions/ }));
    await waitFor(() => expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
      filters: [],
      groupBy: DEFAULT_GROUP_BY,
      sortField: "IMPRESSIONS",
      sortDirection: "ASC",
    }));
    vi.mocked(listCampaignReportRows).mockClear();

    // When: a dimension is dropped
    await userEvent.click(dimensionPicker().getByRole("checkbox", { name: "Date" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then: the metric sort survives - it orders by the aggregate over whatever the grouping is
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [],
        groupBy: ["LINE_ITEM_ID"],
        sortField: "IMPRESSIONS",
        sortDirection: "ASC",
      })
    );
  });

  it("should drop a metric sort when Apply stops showing that metric", async () => {
    // Given: the table sorted by Impressions
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: /^Impressions/ }));
    await waitFor(() => expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
      filters: [],
      groupBy: DEFAULT_GROUP_BY,
      sortField: "IMPRESSIONS",
      sortDirection: "ASC",
    }));
    vi.mocked(listCampaignReportRows).mockClear();

    // When: Impressions itself is deselected, taking its header - and its sort chevron - away. A
    // dimension goes with it only so the grain changes too: dropping the sort alone lands back on the
    // view already in the cache, and there would be no request to read the sort off.
    const metrics = within(screen.getByText("Metrics").closest(".reporting-tab__picker") as HTMLElement);
    await userEvent.click(metrics.getByRole("checkbox", { name: /^Impressions/ }));
    await userEvent.click(dimensionPicker().getByRole("checkbox", { name: "Date" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then: back to the server's default order - a metric sort survives a narrower grain (see the test
    // above), so this can only be the deselected metric's own sort being dropped. An order the user can
    // neither see nor undo is worse than no order at all.
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenLastCalledWith(42, 1, 25, {
        filters: [],
        groupBy: ["LINE_ITEM_ID"],
        sortField: undefined,
        sortDirection: undefined,
      })
    );
  });

  it("should restore the editable grain from the Dimensions picker's Default action", async () => {
    // Given: a report narrowed to two dimensions, so the row-editing modes are refused
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    expect(screen.getByRole("menuitem", { name: "Adjust individual lines" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");

    // When: Default puts the dimensions back and the report is re-run
    const dimensions = screen.getByRole("heading", { name: /Dimensions/ }).closest("div")?.parentElement as HTMLElement;
    await userEvent.click(within(dimensions).getByRole("button", { name: "Default" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then: back at the grain rows can be edited and lines added at
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Adjust individual lines" })).toBeEnabled()
    );
  });

  it("should block row editing below the raw grain and name the missing dimensions on hover", async () => {
    // Given: a report grouped by two dimensions only
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then: the row-editing modes are refused rather than silently un-grouping the report the user asked
    // for - but the menu still opens, because the conversions template does not come from these rows and
    // has no grain to lose
    const editButton = screen.getByRole("button", { name: "Edit data" });
    expect(editButton).toBeEnabled();
    await userEvent.click(editButton);
    expect(screen.getByRole("menuitem", { name: "Adjust individual lines" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Bulk manual adjustment" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Bulk conversions adjustment" })).toBeEnabled();
    const reason = editButton.parentElement?.getAttribute("title") ?? "";
    expect(reason).toContain("Editing works on ungrouped rows only");
    // Every missing key dimension is named, not truncated - this text is the whole remedy
    expect(reason).toContain(
      "Platform, Account, Account id, Constructed name L1, Constructed name L2, Constructed id L2, " +
        "Constructed name L3, Constructed id L3"
    );
    // And the same sentence is in the open menu, not only in the wrapper's tooltip: the menu covers the
    // button that tooltip hangs from, so two dead items were all a user with the menu open could see
    expect(within(screen.getByRole("menu")).getByText(reason)).toBeInTheDocument();
  });

  it("should offer Edit data once every dimension the view keys an adjustment by is shown", async () => {
    // Given: a report at the raw grain
    mockReportViews([aReportView({ dimensions: RAW_GRAIN_DIMS, metrics: ["spend"] })]);
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then:
    const editButton = screen.getByRole("button", { name: "Edit data" });
    expect(editButton).toBeEnabled();
    expect(editButton.parentElement).not.toHaveAttribute("title");
  });

  it("should explain what each constructed level means per platform on hover", async () => {
    // Given: the level columns can only ever name one platform's reading in their header
    renderReportingTab();
    await screen.findByText("LI-1");

    // When: the pointer rests on the "?" - no click needed
    await userEvent.hover(screen.getByRole("button", { name: "What the constructed levels mean" }));

    // Then: the source system's whole naming-levels table is available, not just the row in view
    const hint = screen.getByRole("note");
    expect(within(hint).getByRole("row", { name: "DV360 Line item Insertion order Creative" })).toBeInTheDocument();
    expect(within(hint).getByRole("row", { name: "Google Ads Campaign Ad set Ad" })).toBeInTheDocument();
    expect(within(hint).getByRole("row", { name: "Amazon Insertion order Line item Creative" })).toBeInTheDocument();
  });

  it("should hide the level help again when the pointer leaves it", async () => {
    // Given: a reference table is glanced at and left, not closed deliberately
    renderReportingTab();
    await screen.findByText("LI-1");
    const trigger = screen.getByRole("button", { name: "What the constructed levels mean" });
    await userEvent.hover(trigger);
    expect(screen.getByRole("note")).toBeInTheDocument();

    // When:
    await userEvent.unhover(trigger);

    // Then:
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("should show the level help on keyboard focus and give it up on Escape", async () => {
    // Given: hover is not available to a keyboard, so focus opens it too
    renderReportingTab();
    await screen.findByText("LI-1");
    const trigger = screen.getByRole("button", { name: "What the constructed levels mean" });
    act(() => trigger.focus());
    expect(screen.getByRole("note")).toBeInTheDocument();

    // When:
    await userEvent.keyboard("{Escape}");

    // Then:
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("should say how many rows there are, and how many of them have loaded", async () => {
    // Given: a first page that is a small slice of a much larger result
    mockReportViews();
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage({ total_rows: 138, hasNext: true }));
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then: both numbers, so the count is not mistaken for what is on screen
    expect(screen.getByText("1 of 138 rows")).toBeInTheDocument();
  });

  it("should drop the loaded count once every row is in", async () => {
    // Given: the whole result fits in one page
    mockReportViews();
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage({ total_rows: 1, hasNext: false }));
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then: no "1 of 1", which would read as still loading
    expect(screen.getByText("1 row")).toBeInTheDocument();
  });

  it("should leave Edit data available on a report using the app's default dimensions", async () => {
    // Given: a report opened with the config a freshly created one gets
    mockReportViews([aReportView({ dimensions: DEFAULT_DIMS, metrics: DEFAULT_METRICS })]);
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then: a new report is editable without the user widening its dimensions first
    expect(screen.getByRole("button", { name: "Edit data" })).toBeEnabled();
  });

  it("should show the level-1 id alone, without the constructed name under it", async () => {
    // Given: a row that has a constructed name to show
    vi.mocked(listCampaignReportRows).mockResolvedValue(
      aPage({ content: [aRow({ line_item_name: "ProximAgency_Financial Partners_FIN_Q3", tactic: "Prospecting" })] })
    );

    // When:
    renderReportingTab();

    // Then: the id cell is one line - the name is its own column when a report asks for it, and
    // repeating it here spent two rows' worth of height per row to say nothing new
    const idCell = (await screen.findByText("LI-1")).closest("td") as HTMLElement;
    expect(idCell).toHaveTextContent("LI-1");
    expect(idCell).not.toHaveTextContent("ProximAgency_Financial Partners_FIN_Q3");
    expect(idCell).not.toHaveTextContent("Prospecting");
  });
});

describe("ReportingTab editing", () => {
  // Editing is only offered at the raw grain, so an editable view has to show every dimension an
  // adjustment writes - a narrower one disables "Edit data" (covered in its own describe below).
  const EDITABLE_VIEW_DTO = aReportView({
    dimensions: RAW_GRAIN_DIMS,
    metrics: ["impressions", "spend", "cpm"],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallbacks = [];
    mockReportViews([EDITABLE_VIEW_DTO]);
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage());
  });

  it("should enter edit mode and make a stored-metric cell editable, while cpm stays read-only", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));

    // Then:
    expect(screen.getByRole("textbox", { name: /Cost for/ })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /CPM for/ })).not.toBeInTheDocument();
  });

  it("should move the totals row as a metric cell is edited, before anything is saved", async () => {
    // Given: a row of 5,000 impressions inside a 60,000-impression dataset, in edit mode
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const totalsRow = () => document.querySelector(".reporting-tab__totals") as HTMLElement;
    expect(within(totalsRow()).getByText("60,000")).toBeInTheDocument();

    // When: that row's impressions are raised by 1,000
    const cell = screen.getByRole("textbox", { name: "Impressions for LI-1" });
    await userEvent.clear(cell);
    await userEvent.type(cell, "6000");

    // Then: the total moved by the difference, not to the typed value - the server totals the whole
    // dataset, which is more than is loaded, so an edit shifts them rather than recomputing them. And
    // nothing was saved to make it happen: adjusting delivery to land on a number needs the number to
    // answer while typing.
    await waitFor(() => expect(within(totalsRow()).getByText("61,000")).toBeInTheDocument());
    expect(saveReportRowAdjustments).not.toHaveBeenCalled();
    // CPM re-derives from the shifted sums, weighted as the server weights it: 3000 / 61000 * 1000
    expect(within(totalsRow()).getByText("$49.18")).toBeInTheDocument();
  });

  it("should put the totals row back when a staged edit is undone", async () => {
    // Given: an edited cell, with the total already moved
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const totalsRow = () => document.querySelector(".reporting-tab__totals") as HTMLElement;
    const cell = screen.getByRole("textbox", { name: "Impressions for LI-1" });
    await userEvent.clear(cell);
    await userEvent.type(cell, "6000");
    await waitFor(() => expect(within(totalsRow()).getByText("61,000")).toBeInTheDocument());

    // When:
    await userEvent.keyboard("{Meta>}z{/Meta}");

    // Then: back to the server's own figure
    await waitFor(() => expect(within(totalsRow()).getByText("60,000")).toBeInTheDocument());
  });

  it("should count an added row's metrics into the totals as it is typed", async () => {
    // Given: edit mode with a manually added line
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    const totalsRow = () => document.querySelector(".reporting-tab__totals") as HTMLElement;

    // When: the new line is given 2,000 impressions
    await userEvent.type(screen.getByRole("textbox", { name: "Impressions for new line" }), "2000");

    // Then: added in full, since the row is not in the server's totals at all yet
    await waitFor(() => expect(within(totalsRow()).getByText("62,000")).toBeInTheDocument());
  });

  it("should lock dimensions, metrics, sorting, and filters while editing", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));

    // Then:
    expect(screen.getByRole("status")).toHaveTextContent("Dimensions, metrics & filters are locked");
    expect(screen.getByRole("textbox", { name: "Search dimensions" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Search metrics" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Date" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Filter Constructed id L1" })).toBeDisabled();
  });

  it("should leave cpm alone while Cost is edited, since cpm is not built on Cost", async () => {
    // Given: a row the server sent a cpm for
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage({ content: [aRow({ cpm: 18 })] }));
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    expect(screen.getByText("$18.00")).toBeInTheDocument();

    // When: Client Cost - the editable stored cost column - is edited
    const spendInput = screen.getByRole("textbox", { name: /Cost for/ });
    await userEvent.clear(spendInput);
    await userEvent.type(spendInput, "500");

    // Then: cpm does not move, and should not. It is the client's rate-card cost per thousand
    // impressions (dynamic_cost, Added Value free) - editing what the media cost us has nothing to do
    // with it. Nor is it recomputed here at all any more: the ratio is gated by channel server-side, and
    // a second implementation of that gating in the browser is what made the table, the export and the
    // totals disagree. It refreshes on save.
    expect(screen.getByText("$18.00")).toBeInTheDocument();
    expect(listCampaignReportRows).toHaveBeenCalledTimes(1);
  });

  it("should flag a non-numeric metric cell as invalid and block save", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const spendInput = screen.getByRole("textbox", { name: /Cost for/ });

    // When:
    await userEvent.clear(spendInput);
    await userEvent.type(spendInput, "abc");

    // Then: marked invalid, typed text stays (never collapses to the literal "NaN"), Save blocked
    expect(spendInput).toHaveAttribute("aria-invalid", "true");
    expect(spendInput).toHaveValue("abc");
    expect(spendInput).not.toHaveValue("NaN");
    expect(screen.getByText("Not a number")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Save changes/ }));
    expect(await screen.findByText("Fix the invalid metric values before saving.")).toBeInTheDocument();
    expect(saveReportRowAdjustments).not.toHaveBeenCalled();
  });

  it("should keep invalid metric input backspaceable rather than locking NaN into the cell", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const impressionsInput = screen.getByRole("textbox", { name: /Impressions for/ });

    // When: non-numeric input then backspace
    fireEvent.change(impressionsInput, { target: { value: "12x" } });
    expect(impressionsInput).toHaveValue("12x");
    expect(impressionsInput).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(impressionsInput, { target: { value: "12" } });

    // Then: corrected without select-all; no "NaN" residue
    expect(impressionsInput).toHaveValue("12");
    expect(impressionsInput).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText("NaN")).not.toBeInTheDocument();
  });

  it("should clear the invalid flag once the cell is corrected", async () => {
    // Given:
    vi.mocked(saveReportRowAdjustments).mockResolvedValue(undefined);
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const spendInput = screen.getByRole("textbox", { name: /Cost for/ });
    await userEvent.clear(spendInput);
    await userEvent.type(spendInput, "abc");
    expect(spendInput).toHaveAttribute("aria-invalid", "true");

    // When: corrected to a real number
    await userEvent.clear(spendInput);
    await userEvent.type(spendInput, "500");

    // Then: no longer flagged, save proceeds
    expect(spendInput).toHaveAttribute("aria-invalid", "false");
    await userEvent.click(screen.getByRole("button", { name: /Save changes/ }));
    await waitFor(() => expect(saveReportRowAdjustments).toHaveBeenCalledTimes(1));
  });

  it("should highlight a modified cell and show the original value on hover", async () => {
    // Given: spend=90
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const spendInput = screen.getByRole("textbox", { name: /Cost for/ });

    // When:
    await userEvent.clear(spendInput);
    await userEvent.type(spendInput, "500");

    // Then:
    const cell = spendInput.closest("td");
    expect(cell).toHaveClass("reporting-tab__metric-cell--modified");
    expect(cell).toHaveAttribute("title", "Original: $90.00");
  });

  it("should undo the most recent staged cell edit", async () => {
    // Given: spend edited from 90 to 500
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const spendInput = screen.getByRole("textbox", { name: /Cost for/ });
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    await userEvent.clear(spendInput);
    await userEvent.type(spendInput, "500");
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));

    // Then: reverted to the pre-edit staged state (empty adj -> displays the base value)
    expect(screen.getByRole("textbox", { name: /Cost for/ })).toHaveValue("90");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("should undo via Ctrl+Z while editing", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const spendInput = screen.getByRole("textbox", { name: /Cost for/ });
    await userEvent.clear(spendInput);
    await userEvent.type(spendInput, "500");

    // When:
    await userEvent.keyboard("{Control>}z{/Control}");

    // Then:
    expect(screen.getByRole("textbox", { name: /Cost for/ })).toHaveValue("90");
  });

  it("should stage an inline edit only for the row whose full identity matches", async () => {
    // Given: same date + line item id, but different tactic/account grain. The UI key must not collide.
    vi.mocked(listCampaignReportRows).mockResolvedValue(
      aPage({
        content: [
          aRow({ date: "2026-03-10", line_item_id: "LI-1", tactic: "Prospecting", spend: 90 }),
          aRow({ date: "2026-03-10", line_item_id: "LI-1", tactic: "Retargeting", spend: 200 }),
        ],
      })
    );
    renderReportingTab();
    await screen.findAllByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const spendInputs = screen.getAllByRole("textbox", { name: /Cost for/ });

    // When:
    await userEvent.clear(spendInputs[0]);
    await userEvent.type(spendInputs[0], "500");

    // Then:
    expect(spendInputs[0]).toHaveValue("500");
    expect(spendInputs[1]).toHaveValue("200");
  });

  it("should not collide keys for two rows with identical visible identity", async () => {
    // Given: two rows sharing every one of the 28 identity fields (a true duplicate, not just the same
    // date+line_item_id) - the render key must still be unique per rendered row.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage({ content: [aRow(), aRow()] }));
    renderReportingTab();

    // When:
    await screen.findAllByText("LI-1");

    // Then: both rows render, and React never warns about a duplicate key
    expect(screen.getAllByText("LI-1")).toHaveLength(2);
    const keyWarning = consoleError.mock.calls.some((call) =>
      String(call[0]).includes("Encountered two children with the same key")
    );
    expect(keyWarning).toBe(false);
    consoleError.mockRestore();
  });

  it("should prepend a manual row when adding a line", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));

    // Then:
    const newLineDateInput = screen.getByLabelText("Date for new line");
    const existingLineItem = screen.getByText("LI-1");
    expect(newLineDateInput.compareDocumentPosition(existingLineItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("should pre-fill an added line's agency/client fields from the campaign and not offer them for editing", async () => {
    // Given: a view showing the agency/client-scoped dimensions, over rows that all share them
    mockReportViews([
      aReportView({ dimensions: [...RAW_GRAIN_DIMS, "client", "agency_id", "channel"], metrics: ["spend"] }),
    ]);
    vi.mocked(listCampaignReportRows).mockResolvedValue(
      aPage({
        content: [
          aRow({ account: "Proxim Agency", agency_id: "ProximAgency", client: "FPCU", industry_code: "FIN",
            campaign_name: "Q1 Launch" }),
          aRow({ line_item_id: "LI-2", account: "Proxim Agency", agency_id: "ProximAgency", client: "FPCU",
            industry_code: "FIN", campaign_name: "Q1 Launch" }),
        ],
      })
    );
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));

    // Then: date stays editable, but neither the DSP account nor any naming-convention field is typed
    expect(screen.getByLabelText("Date for new line")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Account for new line" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Client for new line" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Agency id for new line" })).not.toBeInTheDocument();
    // The name is seeded with the segments this campaign already fixes, in naming-convention order
    const nameInput = screen.getByRole("textbox", { name: /Constructed name L1 for new line/ });
    expect(nameInput).toHaveValue("ProximAgency_FPCU_FIN_Q1 Launch_");
    // ...and the agency/client cells read back out of it, as the view will do on the next read
    expect(screen.getAllByText("Proxim Agency")).toHaveLength(3);
    expect(screen.getAllByText("FPCU")).toHaveLength(3);
  });

  it("should read an added line's naming-convention fields out of the constructed name as it is typed", async () => {
    // Given: an added line whose channel and tactic are segments 5 and 6 of the name
    mockReportViews([
      aReportView({ dimensions: [...RAW_GRAIN_DIMS, "channel", "tactic"], metrics: ["spend"] }),
    ]);
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));

    // When: the whole convention is typed into the name
    const nameInput = screen.getByRole("textbox", { name: /Constructed name L1 for new line/ });
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "AGY_FPCU_FIN_Q1_CTV_Prospecting");

    // Then: channel and tactic follow the name rather than being typed separately - a value typed
    // into them would be dropped, since the view derives them by splitting the name
    expect(screen.queryByRole("textbox", { name: "Channel for new line" })).not.toBeInTheDocument();
    expect(screen.getByText("CTV")).toBeInTheDocument();
    expect(screen.getByText("Prospecting")).toBeInTheDocument();
  });

  it("should keep an added line's field editable when the campaign's rows disagree on it", async () => {
    // Given: one campaign on two DSPs - the account differs per platform, so it cannot be inherited
    mockReportViews([aReportView({ dimensions: [...RAW_GRAIN_DIMS, "client"], metrics: ["spend"] })]);
    vi.mocked(listCampaignReportRows).mockResolvedValue(
      aPage({
        content: [
          aRow({ account: "Proxim Agency", client: "FPCU" }),
          aRow({ line_item_id: "LI-2", account: "Proxim Google", client: "FPCU" }),
        ],
      })
    );
    renderReportingTab();
    await screen.findByText("Proxim Agency");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));

    // Then: the ambiguous field is still editable, while the agreed one is not
    expect(screen.getByRole("textbox", { name: "Account for new line" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Client for new line" })).not.toBeInTheDocument();
  });

  it("should keep an existing row's staged edit when a manual line is added", async () => {
    // Given: spend edited from 90 to 500
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const spendInput = screen.getByRole("textbox", { name: /Cost for/ });
    await userEvent.clear(spendInput);
    await userEvent.type(spendInput, "500");

    // When: a manual row is prepended, shifting every row's rendered position
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));

    // Then: the existing row's memoized cell keeps its staged value rather than being clobbered by
    // the prepend (guards the memoized ReportRow + stable-callback wiring against a stale merge)
    expect(screen.getByRole("textbox", { name: "Client Cost for LI-1" })).toHaveValue("500");
  });

  it("should block save and keep editing when an added line is missing required write-table fields", async () => {
    // Given: an added line left blank. Editing suite shows RAW_GRAIN_DIMS (every BigQuery REQUIRED
    // key dim: platform/account/date/constructed name+id L1–L3), so each empty one is flagged inline.
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    // Then: rejected client-side before any request; toast lists the missing REQUIRED fields
    expect(await screen.findByText(/Fill required fields before saving/)).toBeInTheDocument();
    expect(saveReportRowAdjustments).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Date for new line")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox", { name: /Constructed id L1 for new line/ })).toHaveAttribute("aria-invalid", "true");
    // All 10 REQUIRED key dims empty + at least one metric (impressions) flagged Required
    expect(screen.getAllByText("Required").length).toBeGreaterThanOrEqual(10);
  });

  it("should flag a negative metric as invalid and block save", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const spendInput = screen.getByRole("textbox", { name: /Cost for/ });

    // When: fireEvent.change fires React onChange (userEvent.type mangles '-' under inputMode=decimal)
    fireEvent.change(spendInput, { target: { value: "-50" } });

    // Then: marked invalid with the non-negative message
    expect(spendInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Must be ≥ 0")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Save changes/ }));
    expect(await screen.findByText("Fix the invalid metric values before saving.")).toBeInTheDocument();
    expect(saveReportRowAdjustments).not.toHaveBeenCalled();
  });

  it("should flag a fractional integer metric as invalid and block save", async () => {
    // Given: impressions is an int64 metric — a fractional value would fail the BigQuery INSERT
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const impressionsInput = screen.getByRole("textbox", { name: /Impressions for/ });

    // When: fireEvent.change fires React onChange (userEvent.type mangles '.' under inputMode=decimal)
    fireEvent.change(impressionsInput, { target: { value: "3.7" } });

    // Then: marked invalid with the whole-number message
    expect(impressionsInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Must be a whole number")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Save changes/ }));
    expect(await screen.findByText("Fix the invalid metric values before saving.")).toBeInTheDocument();
    expect(saveReportRowAdjustments).not.toHaveBeenCalled();
  });

  it("should post one adjustments batch on Save and invalidate the report-rows query", async () => {
    // Given:
    vi.mocked(saveReportRowAdjustments).mockResolvedValue(undefined);
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const spendInput = screen.getByRole("textbox", { name: /Cost for/ });
    await userEvent.clear(spendInput);
    await userEvent.type(spendInput, "500");
    vi.mocked(listCampaignReportRows).mockClear();

    // When:
    await userEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    // Then: exactly one batch call, carrying the edited value + which metric changed
    await waitFor(() => expect(saveReportRowAdjustments).toHaveBeenCalledTimes(1));
    expect(saveReportRowAdjustments).toHaveBeenCalledWith(42, {
      adjustments: [
        expect.objectContaining({
          added: false,
          date: "2026-03-10",
          line_item_id: "LI-1",
          spend: 500,
          adjusted_metrics: "spend",
        }),
      ],
    });
    // ...and the report-rows query refetches once, since Save invalidates it
    await waitFor(() => expect(listCampaignReportRows).toHaveBeenCalledTimes(1));
  });

  it("should surface an error and keep staged edits when the save fails", async () => {
    // Given:
    vi.mocked(saveReportRowAdjustments).mockRejectedValue(new Error("boom"));
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const spendInput = screen.getByRole("textbox", { name: /Cost for/ });
    await userEvent.clear(spendInput);
    await userEvent.type(spendInput, "500");

    // When:
    await userEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    // Then: still editing, edit still staged (not discarded on failure)
    await waitFor(() => expect(saveReportRowAdjustments).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("textbox", { name: /Cost for/ })).toHaveValue("500");
  });

  it("should show the offline bulk adjustment panel with a Done button, no cell inputs", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Bulk manual adjustment" }));

    // Then:
    expect(screen.getByText(/Download the current data as a spreadsheet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download data (.xlsx)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload adjusted file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply to visible rows" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Cost for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add line" })).not.toBeInTheDocument();
  });

  it("should exit bulk mode when Done is clicked", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Bulk manual adjustment" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    // Then:
    expect(screen.getByRole("button", { name: "Edit data" })).toBeInTheDocument();
  });

  it("should download the .xlsx template for the current view", async () => {
    // Given:
    const blob = new Blob(["fake xlsx bytes"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    vi.mocked(downloadBulkAdjustmentTemplate).mockResolvedValue({ blob, truncated: false });
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Bulk manual adjustment" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Download data (.xlsx)" }));

    // Then:
    await waitFor(() =>
      expect(downloadBulkAdjustmentTemplate).toHaveBeenCalledWith(42, {
        filters: [],
        sortField: undefined,
        sortDirection: undefined,
        dimensions: RAW_GRAIN_DIMS,
        metrics: ["impressions", "spend", "cpm"],
      })
    );
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url"));
  });

  it("should upload the chosen file and toast the applied count", async () => {
    // Given:
    vi.mocked(uploadBulkAdjustments).mockResolvedValue({ applied: 2 });
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Bulk manual adjustment" }));
    vi.mocked(listCampaignReportRows).mockClear();
    const file = new File(["edited"], "edits.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Upload adjusted file" }));
    const fileInput = screen.getByLabelText("Upload adjusted spreadsheet");
    await userEvent.upload(fileInput, file);

    // Then:
    await waitFor(() => expect(uploadBulkAdjustments).toHaveBeenCalledTimes(1));
    expect(uploadBulkAdjustments).toHaveBeenCalledWith(42, file);
    expect(await screen.findByText("Applied 2 adjustments.")).toBeInTheDocument();
    await waitFor(() => expect(listCampaignReportRows).toHaveBeenCalledTimes(1));
    // Then: back to read-only, edit mode exited on success
    expect(screen.getByRole("button", { name: "Edit data" })).toBeInTheDocument();
  });

  it("should download the conversions template with the date window and no column filters", async () => {
    // Given:
    const blob = new Blob(["fake xlsx bytes"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    vi.mocked(downloadConversionAdjustmentTemplate).mockResolvedValue({ blob, truncated: false });
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Bulk conversions adjustment" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Download conversions (.xlsx)" }));

    // Then: a window only. The report's dimension filters describe delivery rows, and the two marts are
    // filled by different pipelines, so one could exclude the conversions row belonging to a kept row.
    await waitFor(() =>
      expect(downloadConversionAdjustmentTemplate).toHaveBeenCalledWith(42, {
        dateFrom: undefined,
        dateTo: undefined,
      })
    );
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url"));
  });

  it("should upload the conversions file through the conversions endpoint only", async () => {
    // Given:
    vi.mocked(uploadConversionAdjustments).mockResolvedValue({ applied: 3 });
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Bulk conversions adjustment" }));
    vi.mocked(listCampaignReportRows).mockClear();
    const file = new File(["edited"], "conversions.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    // When:
    const fileInput = screen.getByLabelText("Upload adjusted conversions spreadsheet");
    await userEvent.upload(fileInput, file);

    // Then: the delivery upload is untouched - the two tables have different keys and different grains
    await waitFor(() => expect(uploadConversionAdjustments).toHaveBeenCalledWith(42, file));
    expect(uploadBulkAdjustments).not.toHaveBeenCalled();
    expect(await screen.findByText("Applied 3 conversion adjustments.")).toBeInTheDocument();
    // The report reads its conversions from the joined mart, so the table has to re-read after the write
    await waitFor(() => expect(listCampaignReportRows).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Edit data" })).toBeInTheDocument();
  });

  it("should surface an error toast when the upload fails and stay in bulk mode", async () => {
    // Given:
    vi.mocked(uploadBulkAdjustments).mockRejectedValue(new Error("row 3: 'spend' is not a number: 'abc'"));
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Bulk manual adjustment" }));
    const file = new File(["edited"], "edits.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    // When:
    const fileInput = screen.getByLabelText("Upload adjusted spreadsheet");
    await userEvent.upload(fileInput, file);

    // Then:
    expect(await screen.findByText("row 3: 'spend' is not a number: 'abc'")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload adjusted file" })).toBeInTheDocument();
  });

  it("should discard staged edits when Cancel is clicked", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const spendInput = screen.getByRole("textbox", { name: /Cost for/ });
    await userEvent.clear(spendInput);
    await userEvent.type(spendInput, "500");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    const dialog = await screen.findByRole("dialog", { name: "Discard unsaved edits?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Discard changes" }));

    // Then: confirmed in-app, back to read-only, original value restored
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    expect(screen.getByRole("textbox", { name: /Cost for/ })).toHaveValue("90");
  });

  it("should keep staged edits when the user cancels the discard dialog", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const spendInput = screen.getByRole("textbox", { name: /Cost for/ });
    await userEvent.clear(spendInput);
    await userEvent.type(spendInput, "500");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    const dialog = await screen.findByRole("dialog", { name: "Discard unsaved edits?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // Then: still editing, staged value untouched
    expect(screen.getByRole("textbox", { name: /Cost for/ })).toHaveValue("500");
  });

  it("should exit edit mode without prompting when nothing was staged", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    // Then:
    expect(screen.queryByRole("dialog", { name: "Discard unsaved edits?" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit data" })).toBeInTheDocument();
  });
});

describe("ReportingTab conversions cell", () => {
  const LEVEL_ONE = "20_Ourisman Ford_AUTO_Ourisman Ford 2026_Display_Retargeting";

  function aJoinedRow(overrides: Partial<ReportRowV1> = {}): ReportRowV1 {
    return aRow({
      line_item_name: LEVEL_ONE,
      campaign_constructed_name: "Hero 30s",
      channel: "Display",
      conversions: 12,
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallbacks = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.mocked(listConversionBreakdown).mockResolvedValue({ rows: [] });
  });

  it("should open the breakdown from a report grouped past the adjustment key", async () => {
    // Given: a report grouped by two columns - no platform, no ids, so a delivery edit would have
    // nowhere to land
    mockReportViews([aReportView({ dimensions: ["date", "line_item_name"], metrics: ["conversions"] })]);
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage({ content: [aJoinedRow()] }));
    renderReportingTab();

    // When:
    await userEvent.click(await screen.findByRole("button", { name: `Conversions by action for ${LEVEL_ONE}` }));

    // Then: conversions are read and written by their own key, so the delivery gate has no say here -
    // whether these really are the cell's rows is the panel's own question, settled against the figure
    expect(await screen.findByRole("dialog", { name: "Conversions by action" })).toBeInTheDocument();
    expect(listConversionBreakdown).toHaveBeenCalledWith(42, {
      date: "2026-03-10",
      levelOneName: LEVEL_ONE,
      levelThreeName: "Hero 30s",
      channel: "Display",
    });
  });

  it("should pass on an absent channel rather than inventing one", async () => {
    // Given: a grouped report that does not show the channel column, so the row arrives without one
    mockReportViews([aReportView({ dimensions: RAW_GRAIN_DIMS, metrics: ["conversions"] })]);
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage({ content: [aJoinedRow({ channel: undefined })] }));
    renderReportingTab();

    // When:
    await userEvent.click(await screen.findByRole("button", { name: `Conversions by action for ${LEVEL_ONE}` }));

    // Then: the cell still opens - refusing every such report would have shut the panel on all of them,
    // since no report groups by channel by default. The server matches an absent channel the way its
    // own join does, and the panel checks the result against the figure.
    await waitFor(() => expect(listConversionBreakdown).toHaveBeenCalledTimes(1));
    expect(listConversionBreakdown).toHaveBeenCalledWith(42, {
      date: "2026-03-10",
      levelOneName: LEVEL_ONE,
      levelThreeName: "Hero 30s",
      channel: undefined,
    });
  });

  it("should leave a blank Conversions cell alone", async () => {
    // Given: a row the join attached nothing to - either nothing matched, or it is one of the siblings
    // a campaign-level channel blanks so the campaign's total is stated once
    mockReportViews([aReportView({ dimensions: ["date", "line_item_name"], metrics: ["conversions"] })]);
    vi.mocked(listCampaignReportRows).mockResolvedValue(
      aPage({ content: [aJoinedRow({ conversions: undefined })] })
    );
    renderReportingTab();
    await screen.findByText(LEVEL_ONE);

    // Then: there is no breakdown behind it, and offering one would promise rows that are not there
    expect(screen.queryByRole("button", { name: /Conversions by action for/ })).not.toBeInTheDocument();
  });
});

describe("ReportingTab table layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallbacks = [];
    mockReportViews();
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage());
  });

  it("should hide the page chrome when the table is expanded, and bring it back on collapse", async () => {
    // Given: the reports list and the dimension pickers sit above the data table
    renderReportingTab();
    await screen.findByText("LI-1");
    expect(screen.getByRole("heading", { name: "Reports" })).toBeInTheDocument();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Expand table" }));

    // Then: the table owns the page - and says how to get back
    const collapse = screen.getByRole("button", { name: "Collapse table" });
    expect(collapse).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".reporting-tab--expanded")).toBeInTheDocument();

    // When:
    await userEvent.click(collapse);

    // Then:
    expect(screen.getByRole("button", { name: "Expand table" })).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector(".reporting-tab--expanded")).not.toBeInTheDocument();
  });

  it("should bring the table back into view when it is collapsed inline again", async () => {
    // Given: an expanded table, with everything that sits above it hidden
    renderReportingTab();
    await screen.findByText("LI-1");
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    await userEvent.click(screen.getByRole("button", { name: "Expand table" }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // When: collapsing puts the reports list and the builder back above the table
    await userEvent.click(screen.getByRole("button", { name: "Collapse table" }));

    // Then: the window follows the table down the page instead of staying at an offset that now shows
    // the top of the tab
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "start" });
  });

  it("should take the sidebar's width while expanded and give it back on collapse", async () => {
    // Given: a sidebar the user had left open
    const setCollapsed = vi.fn();
    renderReportingTab(aCampaign(), { collapsed: false, setCollapsed });
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Expand table" }));

    // Then:
    expect(setCollapsed).toHaveBeenLastCalledWith(true);

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Collapse table" }));

    // Then: back to how it was found, not to some assumed default
    expect(setCollapsed).toHaveBeenLastCalledWith(false);
  });

  it("should leave a sidebar the user had already collapsed collapsed", async () => {
    // Given: expanding must not reopen a sidebar the user deliberately closed
    const setCollapsed = vi.fn();
    renderReportingTab(aCampaign(), { collapsed: true, setCollapsed });
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Expand table" }));
    await userEvent.click(screen.getByRole("button", { name: "Collapse table" }));

    // Then:
    expect(setCollapsed).toHaveBeenLastCalledWith(true);
  });

  it("should collapse an expanded table on Escape", async () => {
    // Given: expanded hides the chrome, so there has to be a way out that is not a button on screen
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Expand table" }));

    // When:
    await userEvent.keyboard("{Escape}");

    // Then:
    expect(screen.getByRole("button", { name: "Expand table" })).toBeInTheDocument();
  });

  it("should widen a column with the arrow keys, compounding one press onto the next", async () => {
    // Given: a resizer on the Date column - keyboard, because a column too narrow to read is exactly
    // where a pointer-only gesture leaves someone stuck
    renderReportingTab();
    await screen.findByText("LI-1");
    const resizer = screen.getByRole("separator", { name: "Resize Date" });

    // When:
    resizer.focus();
    await userEvent.keyboard("{ArrowRight}");
    const afterOne = Number(resizer.closest("th")?.style.width.replace("px", ""));
    await userEvent.keyboard("{ArrowRight}");

    // Then: the second press moves on from the first rather than re-measuring from scratch
    const afterTwo = Number(resizer.closest("th")?.style.width.replace("px", ""));
    expect(afterTwo).toBeGreaterThan(afterOne);
  });

  it("should pin the body cells to a resized column, not just its header", async () => {
    // Given: an auto-layout table sizes a column to its widest cell, so pinning only the header lets
    // the rows below push it straight back open - narrowing would never work
    renderReportingTab();
    await screen.findByText("LI-1");
    const resizer = screen.getByRole("separator", { name: "Resize Date" });

    // When:
    resizer.focus();
    await userEvent.keyboard("{ArrowRight}");

    // Then: header and body agree on the width
    const headerWidth = resizer.closest("th")?.style.width;
    const bodyCell = screen.getAllByText("Mar 10, 2026")[0].closest("td");
    expect(headerWidth).toBeTruthy();
    expect(bodyCell?.style.width).toBe(headerWidth);
  });

  it("should refuse to narrow a column out of existence", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    const resizer = screen.getByRole("separator", { name: "Resize Impressions" });

    // When: dragged left far past zero
    resizer.focus();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}");

    // Then: it stops at a width that can still be grabbed again
    const width = Number(resizer.closest("th")?.style.width.replace("px", ""));
    expect(width).toBeGreaterThan(0);
  });
});

describe("ReportingTab download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallbacks = [];
    mockReportViews();
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage());
  });

  it("should download the current filtered/sorted view as .xlsx via the export endpoint", async () => {
    // Given:
    const blob = new Blob(["fake xlsx bytes"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    vi.mocked(exportReportRows).mockResolvedValue({ blob, truncated: false });
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    let createdLink: HTMLAnchorElement | null = null;
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      const element = createElement(tagName, options);
      if (tagName === "a") {
        createdLink = element as HTMLAnchorElement;
        vi.spyOn(element as HTMLAnchorElement, "click").mockImplementation(vi.fn());
      }
      return element;
    });
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Current view" }));

    // Then:
    await waitFor(() =>
      expect(exportReportRows).toHaveBeenCalledWith(42, {
        filters: [],
        // The download is the view, not the raw rows behind it
        groupBy: DEFAULT_GROUP_BY,
        sortField: undefined,
        sortDirection: undefined,
        dimensions: ["date", "line_item_id"],
        metrics: ["impressions", "spend"],
        // The columns as rendered, not the report's stored (here empty) arrangement - the workbook has
        // to be written in the order the screen was in, and resolving that here leaves the server
        // nothing to guess at.
        columnOrder: ["date", "line_item_id", "impressions", "spend"],
      })
    );
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(createdLink?.download).toBe("Ourisman Ford 2026 - All data.xlsx");
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url"));
  });

  it("should export a partly-arranged report in the order the screen resolved, not the stored one", async () => {
    // Given: a report whose saved arrangement covers only some of its columns - what a report looks like
    // the moment a column is ticked on after the last drag. The screen and the server resolve the
    // remainder by different rules (the screen puts an unlisted dimension back among the dimensions, the
    // server puts every unlisted id at the end), so sending the stored arrangement would hand back a
    // workbook whose columns are in a different order than the table it was downloaded from.
    mockReportViews([
      aReportView({
        dimensions: ["date", "channel"],
        metrics: ["impressions", "spend"],
        columnOrder: ["date", "spend"],
      }),
    ]);
    const blob = new Blob(["fake xlsx bytes"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    vi.mocked(exportReportRows).mockResolvedValue({ blob, truncated: false });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock-url"), revokeObjectURL: vi.fn() });
    renderReportingTab();
    await waitFor(() => expect(document.querySelector(".reporting-tab__data-tbl")).toBeTruthy());

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Current view" }));

    // Then: the fully resolved on-screen order, with Channel back among the dimensions - not the stored
    // ["date", "spend"], and not the server's own fallback of ["date", "spend", "channel", "impressions"]
    await waitFor(() =>
      expect(exportReportRows).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ columnOrder: ["date", "channel", "spend", "impressions"] })
      )
    );
  });

  it("should download the full unfiltered dataset when All data is chosen", async () => {
    // Given:
    const blob = new Blob(["fake xlsx bytes"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    vi.mocked(exportReportRows).mockResolvedValue({ blob, truncated: false });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock-url"), revokeObjectURL: vi.fn() });
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "All data" }));

    // Then: no filters/sort are sent, regardless of what's currently applied on screen
    await waitFor(() => expect(exportReportRows).toHaveBeenCalledWith(42, {}));
  });

  it("should warn that a truncated download's rows will not add up to its totals", async () => {
    // Given: a report with more rows than one download carries, so the server cuts the row list
    const blob = new Blob(["fake xlsx bytes"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    vi.mocked(exportReportRows).mockResolvedValue({ blob, truncated: true });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock-url"), revokeObjectURL: vi.fn() });
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Current view" }));

    // Then: said out loud, because the file's Totals sheet still covers every row - a silently short
    // file is one whose own rows cannot be reconciled against its own totals
    expect(await screen.findByText(/rows in the file will not add up to them/)).toBeInTheDocument();
  });

  it("should not warn about truncation when the whole report fits in the download", async () => {
    // Given:
    const blob = new Blob(["fake xlsx bytes"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    vi.mocked(exportReportRows).mockResolvedValue({ blob, truncated: false });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock-url"), revokeObjectURL: vi.fn() });
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Current view" }));

    // Then:
    await waitFor(() => expect(exportReportRows).toHaveBeenCalled());
    expect(screen.queryByText(/will not add up/)).not.toBeInTheDocument();
  });

  it("should surface an error toast when the export fails", async () => {
    // Given:
    vi.mocked(exportReportRows).mockRejectedValue(new Error("export failed"));
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Current view" }));

    // Then: the button re-enables once the failed download settles
    await waitFor(() => expect(screen.getByRole("button", { name: "Download" })).not.toBeDisabled());
  });

  it("should carry the on-screen column order in the export payload", async () => {
    // Given: a table whose columns have been dragged out of their default arrangement
    const raf = controlledRaf();
    const blob = new Blob(["fake xlsx bytes"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    vi.mocked(exportReportRows).mockResolvedValue({ blob, truncated: false });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock-url"), revokeObjectURL: vi.fn() });
    renderReportingTab();
    await screen.findByText("LI-1");

    // When: Date is dragged past Constructed id L1's midpoint - landing just after it - then the
    // current view is downloaded
    dragColumnTo("Date", 300, ["Date", "Constructed id L1", "Impressions", "Client Cost"], raf);
    expect(dataTableColumnNames()[0]).toBe("Constructed id L1");
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Current view" }));

    // Then: the export payload's columnOrder matches what the user is actually looking at, not the
    // dimensions-then-metrics order the backend would otherwise concatenate them in
    await waitFor(() =>
      expect(exportReportRows).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ columnOrder: ["line_item_id", "date", "impressions", "spend"] })
      )
    );
  });
});

describe("ReportingTab column order", () => {
  /** The Dimensions picker, scoped so its checkboxes/actions can't be confused with the Metrics one. */
  function dimensionPicker() {
    return within(screen.getByText("Dimensions").closest(".reporting-tab__picker") as HTMLElement);
  }

  /** The Metrics picker, scoped the same way. */
  function metricPicker() {
    return within(screen.getByText("Metrics").closest(".reporting-tab__picker") as HTMLElement);
  }

  /**
   * The rendered data-table header cells' text, in DOM order - excludes the unrelated saved-reports
   * list table, which also has `columnheader` cells on the same page. The assertions below compare the
   * whole ordered array, so unlike a per-header presence check they fail on a wrong position, which is
   * the entire defect. A metric header carries its agg badge, hence "ImpressionsSUM"; the resize handle
   * contributes nothing, being an empty `<span>` labelled only by `aria-label`.
   */
  function dataTableColumnNames() {
    const dataTable = document.querySelector(".reporting-tab__data-tbl") as HTMLElement;
    return within(dataTable).getAllByRole("columnheader").map((header) => header.textContent);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallbacks = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage());
  });

  it("should render dimension columns in the user's selection order, not DIM_DEFS order", async () => {
    // Given: the default view's dimensions cleared, so only picker clicks decide the order
    mockReportViews();
    renderReportingTab();
    await screen.findByText("LI-1");
    const dims = dimensionPicker();
    await userEvent.click(dims.getByRole("checkbox", { name: "Date" }));
    await userEvent.click(dims.getByRole("checkbox", { name: /Constructed id L1/ }));

    // When: Channel is checked before Date - the reverse of DIM_DEFS, which lists Date first
    await userEvent.click(dims.getByRole("checkbox", { name: "Channel" }));
    await userEvent.click(dims.getByRole("checkbox", { name: "Date" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then: the table honors the click order, Channel before Date - the unchanged default metrics
    // (Impressions, Client Cost) still trail them
    await waitFor(() =>
      expect(dataTableColumnNames()).toEqual([
        "Channel",
        "Date",
        "ImpressionsSUM",
        "Client CostSUM",
      ])
    );
  });

  it("should render metric columns in the user's selection order, after every dimension column", async () => {
    // Given: a single dimension selected and the default metrics cleared
    mockReportViews();
    renderReportingTab();
    await screen.findByText("LI-1");
    const dims = dimensionPicker();
    await userEvent.click(dims.getByRole("checkbox", { name: /Constructed id L1/ }));
    const mets = metricPicker();
    await userEvent.click(mets.getByRole("checkbox", { name: /^Impressions/ }));
    await userEvent.click(mets.getByRole("checkbox", { name: /^Client Cost/ }));

    // When: Clicks is checked before Impressions - the reverse of METRIC_DEFS, which lists Impressions first
    await userEvent.click(mets.getByRole("checkbox", { name: /^Clicks/ }));
    await userEvent.click(mets.getByRole("checkbox", { name: /^Impressions/ }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then: the one dimension column comes first, then the metrics in click order
    await waitFor(() =>
      expect(dataTableColumnNames()).toEqual([
        "Date",
        "ClicksSUM",
        "ImpressionsSUM",
      ])
    );
  });

  it("should render a saved view's stored column order on load, even when it is not DIM_DEFS/METRIC_DEFS order", async () => {
    // Given: a saved view whose stored arrays are not in canonical definition order
    mockReportViews([aReportView({ dimensions: ["channel", "date"], metrics: ["spend", "impressions"] })]);

    // When:
    renderReportingTab();
    await waitFor(() => expect(document.querySelector(".reporting-tab__data-tbl")).toBeTruthy());

    // Then: the stored order renders as-is, with no Apply click needed
    expect(dataTableColumnNames()).toEqual([
      "Channel",
      "Date",
      "Client CostSUM",
      "ImpressionsSUM",
    ]);
  });

  it("should skip an unknown stored column id and de-duplicate a repeated one, without throwing", async () => {
    // Given: a saved view whose stored arrays contain an id absent from DIM_DEFS/METRIC_DEFS and a
    // dimension id repeated
    mockReportViews([
      aReportView({
        dimensions: ["channel", "unknown_dim", "channel", "date"],
        metrics: ["unknown_metric", "spend"],
      }),
    ]);

    // When:
    renderReportingTab();
    await waitFor(() => expect(document.querySelector(".reporting-tab__data-tbl")).toBeTruthy());

    // Then: the unknown ids render no column and the repeated dimension renders once, at its first
    // occurrence's position - three columns, not five, none of them blank
    expect(dataTableColumnNames()).toEqual([
      "Channel",
      "Date",
      "Client CostSUM",
    ]);
  });

  it("should render exactly the default arrangement when no columnOrder is saved", async () => {
    // Given: a report saved before columnOrder existed - dimensions first, then metrics, both in
    // their own selection order
    mockReportViews([aReportView()]);

    // When:
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then:
    expect(dataTableColumnNames()).toEqual([
      "Date",
      "Constructed id L1",
      "ImpressionsSUM",
      "Client CostSUM",
    ]);
  });

  it("should render a saved columnOrder that interleaves a metric between two dimensions", async () => {
    // Given: a stored columnOrder that positions a metric ahead of both dimensions
    mockReportViews([
      aReportView({
        dimensions: ["date", "line_item_id"],
        metrics: ["impressions", "spend"],
        columnOrder: ["spend", "date", "line_item_id", "impressions"],
      }),
    ]);

    // When:
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then: the table renders exactly the stored arrangement, no Apply needed
    expect(dataTableColumnNames()).toEqual([
      "Client CostSUM",
      "Date",
      "Constructed id L1",
      "ImpressionsSUM",
    ]);
  });

  it("should place a selected column columnOrder doesn't mention at the end", async () => {
    // Given: Clicks is selected but the stored columnOrder was saved before it was added to the report
    mockReportViews([
      aReportView({
        dimensions: ["date", "line_item_id"],
        metrics: ["impressions", "spend", "clicks"],
        columnOrder: ["date", "line_item_id", "spend", "impressions"],
      }),
    ]);

    // When:
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then: Clicks keeps its default place - after every column columnOrder does name
    expect(dataTableColumnNames()).toEqual([
      "Date",
      "Constructed id L1",
      "Client CostSUM",
      "ImpressionsSUM",
      "ClicksSUM",
    ]);
  });

  it("should render nothing for a columnOrder id that isn't selected", async () => {
    // Given: Clicks sits in the stored columnOrder but was never added to dimensions/metrics
    mockReportViews([
      aReportView({
        dimensions: ["date", "line_item_id"],
        metrics: ["impressions", "spend"],
        columnOrder: ["date", "clicks", "line_item_id", "impressions", "spend"],
      }),
    ]);

    // When:
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then: exactly the two selected dimensions and two selected metrics render - Clicks renders no
    // column of its own
    expect(dataTableColumnNames()).toEqual([
      "Date",
      "Constructed id L1",
      "ImpressionsSUM",
      "Client CostSUM",
    ]);
  });
});

describe("ReportingTab column reordering", () => {
  // The default view's four columns, left to right - the order every `stubHeaderRects` call below lays
  // out geometry for, at 160px each: Date [0,160), Constructed id L1 [160,320), Impressions [320,480),
  // Client Cost [480,640).
  const DEFAULT_ORDER = ["Date", "Constructed id L1", "Impressions", "Client Cost"];

  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallbacks = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    mockReportViews();
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage());
  });

  it("should move a dimension column to the boundary it is dropped on", async () => {
    // Given: the default view's Date, Constructed id L1, Impressions, Client Cost
    const raf = controlledRaf();
    renderReportingTab();
    await screen.findByText("LI-1");

    // When: Date is dragged to a cursor position past Constructed id L1's own midpoint (x=300, inside
    // its [160,320) header cell but right of its 240 midpoint) - landing it just after that column
    dragColumnTo("Date", 300, DEFAULT_ORDER, raf);

    // Then: Date lands right after Constructed id L1, which shifts left to take its old place
    expect(dataTableColumnNames()).toEqual([
      "Constructed id L1",
      "Date",
      "ImpressionsSUM",
      "Client CostSUM",
    ]);
  });

  it("should move a metric column to the boundary it is dropped on", async () => {
    // Given:
    const raf = controlledRaf();
    renderReportingTab();
    await screen.findByText("LI-1");

    // When: Client Cost is dragged to x=350 - inside Impressions' [320,480) header cell, left of its
    // 400 midpoint - landing it just before Impressions
    dragColumnTo("Client Cost", 350, DEFAULT_ORDER, raf);

    // Then: the dimensions are untouched and the two metrics have swapped
    expect(dataTableColumnNames()).toEqual([
      "Date",
      "Constructed id L1",
      "Client CostSUM",
      "ImpressionsSUM",
    ]);
  });

  it("should move the body and totals cells with the header, not just the header", async () => {
    // Given: three places render the column order independently - header, totals row, data rows - and a
    // reorder that only reached one of them would put every value under the wrong heading
    const raf = controlledRaf();
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    dragColumnTo("Date", 300, DEFAULT_ORDER, raf);

    // Then: every row agrees with the header's new order
    expect(dataTableColumnNames()[0]).toBe("Constructed id L1");
    const dataTable = document.querySelector(".reporting-tab__data-tbl") as HTMLElement;
    const bodyRows = within(dataTable).getAllByRole("row").slice(1);
    for (const row of bodyRows) {
      const cells = within(row).queryAllByRole("cell");
      if (cells.length < 2) continue;
      expect(cells[0].className).toContain("reporting-tab__dim-col--line-item");
      expect(cells[1].className).toContain("reporting-tab__dim-col--date");
    }
  });

  it("should not re-read the rows when a column only changes position", async () => {
    // Given: the applied dimensions are the server-side aggregation key, but their ORDER is not - a
    // reorder that re-keyed the query would pay for a multi-second BigQuery read to move a column
    const raf = controlledRaf();
    renderReportingTab();
    await screen.findByText("LI-1");
    const readsBefore = vi.mocked(listCampaignReportRows).mock.calls.length;

    // When:
    dragColumnTo("Date", 300, DEFAULT_ORDER, raf);
    expect(dataTableColumnNames()[0]).toBe("Constructed id L1");

    // Then:
    expect(vi.mocked(listCampaignReportRows).mock.calls.length).toBe(readsBefore);
  });

  it("should drop a metric between two dimensions", async () => {
    // Given: the table now renders one interleaved column list, not a dimension list followed by a
    // metric list - so a metric dragged to a boundary inside the dimensions lands between the two
    const raf = controlledRaf();
    renderReportingTab();
    await screen.findByText("LI-1");

    // When: Client Cost is dragged to x=200 - inside Constructed id L1's [160,320) header cell, left of
    // its 240 midpoint - landing it just before that column, between the two dimensions
    dragColumnTo("Client Cost", 200, DEFAULT_ORDER, raf);

    // Then: Client Cost now sits between the two dimensions
    expect(dataTableColumnNames()).toEqual([
      "Date",
      "Client CostSUM",
      "Constructed id L1",
      "ImpressionsSUM",
    ]);
  });

  it("should move the body and totals cells into an interleaved order along with the header", async () => {
    // Given: a metric dragged between two dimensions has to carry its whole column - header, totals,
    // and every data row - or the table would show values under the wrong heading
    const raf = controlledRaf();
    renderReportingTab();
    await screen.findByText("LI-1");

    // When: Client Cost lands between the two dimensions
    dragColumnTo("Client Cost", 200, DEFAULT_ORDER, raf);
    expect(dataTableColumnNames()[1]).toBe("Client CostSUM");

    // Then: the totals row and every data row agree with the header's new, interleaved order
    const dataTable = document.querySelector(".reporting-tab__data-tbl") as HTMLElement;
    const bodyRows = within(dataTable).getAllByRole("row").slice(1);
    for (const row of bodyRows) {
      const cells = within(row).queryAllByRole("cell");
      if (cells.length < 3) continue;
      expect(cells[0].className).toContain("reporting-tab__dim-col--date");
      expect(cells[1].className).toContain("reporting-tab__metric-col");
      expect(cells[2].className).toContain("reporting-tab__dim-col--line-item");
    }
  });

  it("should land before a column when the cursor sits left of its midpoint", async () => {
    // Given: Client Cost dragged to x=200, inside Constructed id L1's [160,320) header cell and left of
    // its 240 midpoint
    const raf = controlledRaf();
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    dragColumnTo("Client Cost", 200, DEFAULT_ORDER, raf);

    // Then: it lands BEFORE Constructed id L1, not after it
    expect(dataTableColumnNames()).toEqual([
      "Date",
      "Client CostSUM",
      "Constructed id L1",
      "ImpressionsSUM",
    ]);
  });

  it("should land after a column when the cursor sits right of its midpoint", async () => {
    // Given: Client Cost dragged to x=300 - the same header cell as above, but right of its 240
    // midpoint instead of left
    const raf = controlledRaf();
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    dragColumnTo("Client Cost", 300, DEFAULT_ORDER, raf);

    // Then: it lands AFTER Constructed id L1 instead
    expect(dataTableColumnNames()).toEqual([
      "Date",
      "Constructed id L1",
      "Client CostSUM",
      "ImpressionsSUM",
    ]);
  });

  it("should resolve a drop position even when the cursor is tracked over a body row, not the header", async () => {
    // Given: the drag no longer registers only over the header row - only the cursor's x is meant to
    // matter, so tracking it at a y far below the header (well into the body rows) has to resolve the
    // same boundary a header-row y would
    const raf = controlledRaf();
    renderReportingTab();
    await screen.findByText("LI-1");

    // When: same x as the dimension-drag test above, but at a y over the data rows
    dragColumnTo("Date", 300, DEFAULT_ORDER, raf, 400);

    // Then: the same move resolves regardless
    expect(dataTableColumnNames()).toEqual([
      "Constructed id L1",
      "Date",
      "ImpressionsSUM",
      "Client CostSUM",
    ]);
  });

  it("should reflect the current drag in the dragged column's and drop boundary's own cell classes", async () => {
    // Given: the dimming and the insertion line are driven from BEM classes applied to each affected
    // cell (see reporting-tab.css), not from a data attribute on the <table> read with `nth-child()`
    const raf = controlledRaf();
    renderReportingTab();
    await screen.findByText("LI-1");

    // When: Date (1st column) is picked up and tracked to x=300, resolving the boundary just after
    // Constructed id L1 (2nd column) - before release
    fireEvent.pointerDown(columnGrip("Date"), { clientX: 0, clientY: 0 });
    stubHeaderRects(DEFAULT_ORDER);
    fireEvent.pointerMove(window, { clientX: 300, clientY: 0 });
    raf.flush();

    // Then: Date's own header cell dims, Impressions' (the column the boundary lands before) carries
    // the insertion line, and no header cell carries the "past every column" variant of that line
    expect(dataTableHeaderCell("Date").className).toContain("reporting-tab__cell--dragging");
    expect(dataTableHeaderCell("Impressions").className).toContain("reporting-tab__cell--drop-before");
    expect(dataTableHeaderCell("Constructed id L1").className).not.toContain("reporting-tab__cell--dragging");
    expect(dataTableHeaderCell("Constructed id L1").className).not.toContain("reporting-tab__cell--drop-before");
    for (const header of dataTableHeaderCells()) {
      expect(header.className).not.toContain("reporting-tab__cell--drop-after");
    }

    // Cleanup: abandon rather than commit, so this test's assertions are about the in-progress state
    fireEvent.keyDown(window, { key: "Escape" });
  });

  it("should abandon a drag on Escape instead of committing it", async () => {
    // Given: a drag picked up and tracked to a boundary that would move the column
    const raf = controlledRaf();
    renderReportingTab();
    await screen.findByText("LI-1");
    fireEvent.pointerDown(columnGrip("Date"), { clientX: 0, clientY: 0 });
    stubHeaderRects(DEFAULT_ORDER);
    fireEvent.pointerMove(window, { clientX: 300, clientY: 0 });
    raf.flush();

    // When: released after Escape
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window);

    // Then: the order is the one the drag started from
    expect(dataTableColumnNames()[0]).toBe("Date");
  });

  it("should leave the order alone when a grip is pressed and released without moving", async () => {
    // Given: a click that never travels never resolves a boundary, so there is nothing to commit
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    fireEvent.pointerDown(columnGrip("Date"));
    fireEvent.pointerUp(window);

    // Then:
    expect(dataTableColumnNames()[0]).toBe("Date");
  });

  it("should move a column one place per arrow-key press", async () => {
    // Given: a pointer drag is the only gesture a mouse can make, so the grip answers the arrow keys
    // too - otherwise a keyboard user is stuck with whatever order the report was saved in
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    columnGrip("Client Cost").focus();
    await userEvent.keyboard("{ArrowLeft}");

    // Then:
    await waitFor(() => expect(dataTableColumnNames()[2]).toBe("Client CostSUM"));

    // When: moved back
    await userEvent.keyboard("{ArrowRight}");

    // Then:
    await waitFor(() => expect(dataTableColumnNames()[2]).toBe("ImpressionsSUM"));
  });

  it("should stop at the ends of its own list rather than crossing into the other one", async () => {
    // Given: the first dimension pressed left, which would otherwise walk out of the dimension list
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    columnGrip("Date").focus();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");

    // Then:
    expect(dataTableColumnNames()).toEqual([
      "Date",
      "Constructed id L1",
      "ImpressionsSUM",
      "Client CostSUM",
    ]);

    // When: the last metric pressed right
    columnGrip("Client Cost").focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");

    // Then:
    expect(dataTableColumnNames()).toEqual([
      "Date",
      "Constructed id L1",
      "ImpressionsSUM",
      "Client CostSUM",
    ]);
  });

  it("should persist the dragged order on Save report", async () => {
    // Given: the reorder has to reach the draft the pickers hold, not only the applied view - saving
    // the old order back while showing the new one is the one failure the user cannot see coming
    const raf = controlledRaf();
    vi.mocked(updateReportView).mockResolvedValue({ ...SAVED_VIEW_DTO, status: "saved" });
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    dragColumnTo("Date", 300, DEFAULT_ORDER, raf);
    expect(dataTableColumnNames()[0]).toBe("Constructed id L1");
    await userEvent.click(screen.getByRole("button", { name: "Save report" }));

    // Then: the arrangement is saved as columnOrder - dimensions/metrics still only decide membership
    await waitFor(() => expect(updateReportView).toHaveBeenCalledTimes(1));
    expect(updateReportView).toHaveBeenCalledWith(
      42,
      1,
      expect.objectContaining({
        dimensions: ["date", "line_item_id"],
        metrics: ["impressions", "spend"],
        columnOrder: ["line_item_id", "date", "impressions", "spend"],
      })
    );
  });

  it("should keep the dragged order through a later Apply", async () => {
    // Given: Apply copies the draft over the applied view, so a drag that never reached the draft
    // would be silently undone by the next picker change
    const raf = controlledRaf();
    renderReportingTab();
    await screen.findByText("LI-1");
    dragColumnTo("Date", 300, DEFAULT_ORDER, raf);
    expect(dataTableColumnNames()[0]).toBe("Constructed id L1");

    // When: a dimension is added and applied
    const dims = within(screen.getByText("Dimensions").closest(".reporting-tab__picker") as HTMLElement);
    await userEvent.click(dims.getByRole("checkbox", { name: "Channel" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then: the dragged order survives, with the new column appended
    await waitFor(() =>
      expect(dataTableColumnNames()).toEqual([
        "Constructed id L1",
        "Date",
        "Channel",
        "ImpressionsSUM",
        "Client CostSUM",
      ])
    );
  });

  it("should append a column at the end when it is dropped past every rendered column", async () => {
    // Given: a cursor beyond the last header's own right edge - past Client Cost's [480,640) - resolves
    // the one boundary with no column of its own to sit before (the "drop-after" variant of the
    // insertion line - see dropCellClass in reporting-tab.tsx/.css)
    const raf = controlledRaf();
    renderReportingTab();
    await screen.findByText("LI-1");

    // When: Date is dragged from the front of the list to past the very end
    dragColumnTo("Date", 700, DEFAULT_ORDER, raf);

    // Then: Date lands last instead of shifting by one place
    expect(dataTableColumnNames()).toEqual([
      "Constructed id L1",
      "ImpressionsSUM",
      "Client CostSUM",
      "Date",
    ]);
  });

  it("should place the drag classes by each column's rendered position, not a list bounded to the default column count", async () => {
    // Given: a report with two more columns than the default view's four - the generated selector list
    // this replaced was hard-coded to the largest report DIM_DEFS + METRIC_DEFS could ever build, so a
    // test at the default column count alone could not tell "derived from position" apart from "found in
    // a hard-coded list that happens to be big enough". Six columns is proof enough that it is the former.
    renderReportingTab();
    await screen.findByText("LI-1");
    const dims = within(screen.getByText("Dimensions").closest(".reporting-tab__picker") as HTMLElement);
    await userEvent.click(dims.getByRole("checkbox", { name: "Channel" }));
    await userEvent.click(dims.getByRole("checkbox", { name: "Tactic" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(dataTableColumnNames()).toEqual([
        "Date",
        "Constructed id L1",
        "Channel",
        "Tactic",
        "ImpressionsSUM",
        "Client CostSUM",
      ])
    );
    const order = ["Date", "Constructed id L1", "Channel", "Tactic", "Impressions", "Client Cost"];

    // When: Date (index 0) is picked up and tracked to x=600 - inside Tactic's [480,640) header cell,
    // right of its 560 midpoint - resolving the boundary just before Impressions (index 4)
    const raf = controlledRaf();
    fireEvent.pointerDown(columnGrip("Date"), { clientX: 0, clientY: 0 });
    stubHeaderRects(order);
    fireEvent.pointerMove(window, { clientX: 600, clientY: 0 });
    raf.flush();

    // Then: the header, the totals row and a data row all carry the same two classes at the same two
    // positions - column 0 (Date) dims, column 4 (Impressions) carries the insertion line
    expect(dataTableHeaderCell("Date").className).toContain("reporting-tab__cell--dragging");
    expect(dataTableHeaderCell("Impressions").className).toContain("reporting-tab__cell--drop-before");

    const dataTable = document.querySelector(".reporting-tab__data-tbl") as HTMLElement;
    const rowsAfterHeader = within(dataTable).getAllByRole("row").slice(1);
    const totalsCells = within(rowsAfterHeader[0]).getAllByRole("cell");
    expect(totalsCells[0].className).toContain("reporting-tab__cell--dragging");
    expect(totalsCells[4].className).toContain("reporting-tab__cell--drop-before");

    const firstDataRowCells = within(rowsAfterHeader[1]).getAllByRole("cell");
    expect(firstDataRowCells[0].className).toContain("reporting-tab__cell--dragging");
    expect(firstDataRowCells[4].className).toContain("reporting-tab__cell--drop-before");

    // Cleanup: abandon rather than commit
    fireEvent.keyDown(window, { key: "Escape" });
  });
});
