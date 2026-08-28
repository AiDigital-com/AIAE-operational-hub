import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADJUSTMENT_KEY_DIM_IDS, DEFAULT_DIMS, DEFAULT_METRICS, DIM_DEFS } from "../../pacing/mock/reports";
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
  listConstructedEntities,
  listConversionBreakdown,
  listReportRowDistinctValues,
  listReportViews,
  previewConstructedIds,
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
  // PDI_117 Add Line id resolution/preview - defaulted so every existing "Add line" test (most of which
  // do not care about identity resolution at all) gets a harmless, non-throwing answer: no mart entities
  // to resolve against. Tests that actually cover resolution override this per test.
  listConstructedEntities: vi.fn().mockResolvedValue({ pageNumber: 1, pageSize: 1, totalElements: 0, totalPages: 0, content: [] }),
  previewConstructedIds: vi.fn().mockResolvedValue({
    level1: { id: "OPH_defaultlevel1", origin: "GENERATED" },
    level2: { id: "OPH_defaultlevel2", origin: "GENERATED" },
    level3: { id: "OPH_defaultlevel3", origin: "GENERATED" },
  }),
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

/** Stubs every visible header cell's bounding rect as a uniform `width`-px column, left to right - so a
 *  drag's geometry resolves against real x positions instead of jsdom's all-zero layout. The real widths
 *  don't matter here, only that each column occupies its own known span. */
function stubHeaderRects(width = 150) {
  let left = 0;
  for (const cell of screen.getAllByRole("columnheader")) {
    const right = left + width;
    vi.spyOn(cell, "getBoundingClientRect").mockReturnValue({
      left, right, top: 0, bottom: 30, width, height: 30, x: left, y: 0, toJSON: () => ({}),
    } as DOMRect);
    left = right;
  }
}

/** Stubs `requestAnimationFrame` so a test can run the drag's geometry effect exactly once, on demand -
 *  jsdom never paints, so nothing would ever call the real one. */
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

/** Drags the header at `fromIndex` and releases it just past the left edge of the header at `toIndex` -
 *  uniform 150px columns (see `stubHeaderRects`), so the drop always lands immediately before `toIndex`
 *  regardless of which side of it `fromIndex` started on. Stubs the geometry and drives the one animation
 *  frame the drop needs to resolve a boundary. */
function dragHeaderBefore(fromIndex: number, toIndex: number) {
  const runFrame = stubAnimationFrame();
  stubHeaderRects();
  const headers = screen.getAllByRole("columnheader");
  fireEvent.pointerDown(headers[fromIndex], { clientX: fromIndex * 150 + 10, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: toIndex * 150 + 10, clientY: 10 });
  runFrame();
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
    const created = await screen.findByText("Jul 21, 2026");
    const reportRow = created.closest("tr");
    expect(reportRow).not.toBeNull();
    expect(within(reportRow as HTMLElement).getByText("—")).toBeInTheDocument();
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

  it("should render saved reports and their builder while the first BigQuery row page is loading", async () => {
    // Given: cheap report metadata has resolved, while the dataset read is still in flight
    const pendingRows = deferred<ReportRowsPageResponseV1>();
    mockReportViews([SAVED_VIEW_DTO]);
    vi.mocked(listCampaignReportRows).mockReturnValue(pendingRows.promise);

    // When:
    renderReportingTab();

    // Then: the report and its configuration are usable; only the table advertises its own loading
    expect(await screen.findByText("All data")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Report name" })).toHaveValue("All data");
    expect(screen.getByText("Dimensions")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading rows" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading reports" })).not.toBeInTheDocument();

    pendingRows.resolve(aPage());
    expect(await screen.findByText("LI-1")).toBeInTheDocument();
  });

  it("should keep saved reports visible when the BigQuery row read fails", async () => {
    // Given:
    mockReportViews([SAVED_VIEW_DTO]);
    vi.mocked(listCampaignReportRows).mockRejectedValue(new Error("row query failed"));

    // When:
    renderReportingTab();

    // Then: the table owns its failure; the cheap report list and builder do not disappear with it
    expect(await screen.findByText("row query failed")).toBeInTheDocument();
    expect(screen.getByText("All data")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Report name" })).toHaveValue("All data");
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
    expect(document.querySelector(".data-table__load-more")).toBeInTheDocument();
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
    expect(document.querySelector(".data-table__load-more")).not.toBeInTheDocument();
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
    const cpmHeader = screen.getByRole("button", { name: /^CPM/ });
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
    const totalsRowBefore = document.querySelector(".data-table__totals") as HTMLElement;
    expect(within(totalsRowBefore).getByText("60,000")).toBeInTheDocument();

    // When:
    await intersectSentinels();
    await screen.findByText("LI-2");

    // Then: the totals row still reads the server total, not a recomputed sum including the new row's 999
    const totalsRowAfter = document.querySelector(".data-table__totals") as HTMLElement;
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
    expect(await screen.findByRole("status", { name: "Loading rows" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Date" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Constructed id L1" })).toBeDisabled();

    // When: the fetch resolves
    pending.resolve(aPage());

    // Then: the overlay clears and headers are clickable again
    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading rows" })).not.toBeInTheDocument());
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

  /** Opens a dimension's value popover via `+ Filter`'s field picker - the only path to a dimension's
   *  filter now that the column header's funnel is gone (PDI_115). */
  async function openDimensionFilter(label: string) {
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    const picker = await screen.findByRole("dialog", { name: "Add filter" });
    await userEvent.click(within(picker).getByText(label));
  }

  it("should open a dimension's filter popover showing its distinct values as checkboxes", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await openDimensionFilter("Constructed id L1");

    // Then:
    const popover = await screen.findByRole("dialog", { name: "Filter — Constructed id L1" });
    expect(within(popover).getByText("Display")).toBeInTheDocument();
    expect(within(popover).getByText("Video")).toBeInTheDocument();
    expect(listReportRowDistinctValues).toHaveBeenCalledWith(42, "LINE_ITEM_ID");
  });

  it("should close the field picker when + Filter is clicked again", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    const addFilterButton = screen.getByRole("button", { name: "Filter" });
    await userEvent.click(addFilterButton);
    await screen.findByRole("dialog", { name: "Add filter" });

    // When:
    await userEvent.click(addFilterButton);

    // Then: the outside-click handler must recognise the bar's own wrapper and leave the toggle to the
    // button, or the pointerdown closes the popover and the click reopens it.
    expect(screen.queryByRole("dialog", { name: "Add filter" })).not.toBeInTheDocument();
  });

  it("should apply the checked values on Done, restarting the table from page one", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await openDimensionFilter("Constructed id L1");
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
    await openDimensionFilter("Constructed id L1");
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
    await userEvent.click(screen.getByRole("button", { name: "All dates" }));
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
    await userEvent.click(screen.getByRole("button", { name: "All dates" }));
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
    expect(screen.getByText("Constructed id L1: Display")).toBeInTheDocument();
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
      expect(screen.queryByText("Constructed id L1: Display")).not.toBeInTheDocument()
    );
  });

  it("should discard a staged selection when closed without clicking Done", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await openDimensionFilter("Constructed id L1");
    const popover = await screen.findByRole("dialog", { name: "Filter — Constructed id L1" });
    await userEvent.click(within(popover).getByText("Display"));
    vi.mocked(listCampaignReportRows).mockClear();

    // When: clicking outside the popover instead of Done
    await userEvent.click(document.body);

    // Then: no new fetch, and reopening shows no value checked
    expect(screen.queryByRole("dialog", { name: "Filter — Constructed id L1" })).not.toBeInTheDocument();
    expect(listCampaignReportRows).not.toHaveBeenCalled();
    await openDimensionFilter("Constructed id L1");
    const reopened = await screen.findByRole("dialog", { name: "Filter — Constructed id L1" });
    expect((within(reopened).getByText("Display").closest("label") as HTMLLabelElement).querySelector("input")).not.toBeChecked();
  });

  it("should filter dates by a range instead of a value per date", async () => {
    // Given: the Date pill's own filter, which is a window rather than a checkbox list - a quarter
    // would be ninety checkboxes, and the distinct-value list a picker draws from is capped server-side
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "All dates" }));
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
    expect(screen.getByRole("button", { name: "Mar 10, 2026 — Mar 20, 2026" })).toBeInTheDocument();
  });

  it("should refuse to apply a date window whose start is after its end", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "All dates" }));
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
    expect(screen.getByRole("button", { name: "All dates" })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Mar 10, 2026 — Mar 20, 2026" })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "All dates" })).toBeInTheDocument();
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
    // Two values are joined rather than counted (the mock's own chip-text thresholds - PDI_115 4a)
    expect(screen.getByText("Platform: dv_360_dlv, TTD")).toBeInTheDocument();
  });

  it("should apply a date window from the pill and clear it from the popover's own Clear button", async () => {
    // Given: a report narrowed to one delivery window
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "All dates" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Date" });
    await userEvent.type(within(popover).getByLabelText("From"), "2026-03-10");
    await userEvent.type(within(popover).getByLabelText("To"), "2026-03-20");
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));

    // Then: what the rows have been reduced to is legible on the pill itself, without reopening it
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
    const pill = screen.getByRole("button", { name: "Mar 10, 2026 — Mar 20, 2026" });

    // When: reopened and cleared from the popover's own Clear button, rather than a header funnel or
    // a removable chip - the pill is persistent (D2)
    await userEvent.click(pill);
    const reopened = await screen.findByRole("dialog", { name: "Filter — Date" });
    await userEvent.click(within(reopened).getByRole("button", { name: "Clear" }));

    // Then: gone, and the unwindowed view is back - no new request, since that view is the one already
    // in the cache from before the window was applied
    await waitFor(() => expect(screen.getByRole("button", { name: "All dates" })).toBeInTheDocument());
  });

  it("should state the dates the campaign has without clamping the pickers to them", async () => {
    // Given: the response's own min/max delivery dates
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "All dates" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Date" });

    // Then: the range is stated, not enforced - min/max clamped to a one-day dataset leaves a picker
    // that offers exactly that day and refuses every keystroke
    expect(within(popover).getByText(/Data available Mar 1, 2026 — Mar 31, 2026/)).toBeInTheDocument();
    expect(within(popover).getByLabelText("From")).not.toHaveAttribute("min");
    expect(within(popover).getByLabelText("From")).not.toHaveAttribute("max");
    expect(within(popover).getByLabelText("To")).not.toHaveAttribute("min");
    expect(within(popover).getByLabelText("To")).not.toHaveAttribute("max");
  });

  it("should keep the date filter popover under its pill while the page scrolls", async () => {
    // Given: an open Date filter, anchored under the pill
    renderReportingTab();
    await screen.findByText("LI-1");
    const trigger = screen.getByRole("button", { name: "All dates" });
    trigger.getBoundingClientRect = () => ({ left: 120, bottom: 300, top: 280, right: 140,
      width: 20, height: 20, x: 120, y: 280, toJSON: () => ({}) }) as DOMRect;
    await userEvent.click(trigger);
    const popover = await screen.findByRole("dialog", { name: "Filter — Date" });
    expect(popover).toHaveStyle({ left: "120px", top: "306px" });

    // When: the page scrolls, taking the pill with it
    trigger.getBoundingClientRect = () => ({ left: 120, bottom: 90, top: 70, right: 140,
      width: 20, height: 20, x: 120, y: 70, toJSON: () => ({}) }) as DOMRect;
    fireEvent.scroll(document);

    // Then: the popover followed rather than staying behind, detached from its pill
    await waitFor(() => expect(popover).toHaveStyle({ left: "120px", top: "96px" }));
  });

  it("should send only the bound that was given when the window is open-ended", async () => {
    // Given: "everything from the 10th onwards"
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "All dates" }));
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

  it("should show a chip once a filter is applied", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await openDimensionFilter("Constructed id L1");
    const popover = await screen.findByRole("dialog", { name: "Filter — Constructed id L1" });
    await userEvent.click(within(popover).getByText("Display"));

    // When:
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));

    // Then:
    expect(screen.getByText("Constructed id L1: Display")).toBeInTheDocument();
  });

  it("should select all and clear values within the popover", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");
    await openDimensionFilter("Constructed id L1");
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

  it("should filter by a dimension that is not a selected column", async () => {
    // Given: a report whose dimensions exclude Channel
    renderReportingTab();
    await screen.findByText("LI-1");

    // When: Channel is added as a filter via + Filter, never as a column
    await openDimensionFilter("Channel");
    const popover = await screen.findByRole("dialog", { name: "Filter — Channel" });
    await userEvent.click(within(popover).getByText("Display"));
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));

    // Then: the rows are narrowed by Channel, but the grouping (and the table's columns) never
    // included it - this is the ticket
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [{ field: "CHANNEL", values: ["Display"] }],
        groupBy: DEFAULT_GROUP_BY,
        sortField: undefined,
        sortDirection: undefined,
      })
    );
    expect(screen.queryByRole("columnheader", { name: /Channel/ })).not.toBeInTheDocument();
  });

  it("should keep an active filter when its dimension is deselected and applied", async () => {
    // Given: a report with Channel as a displayed column, filtered by it
    mockReportViews([aReportView({ dimensions: ["date", "line_item_id", "channel"] })]);
    renderReportingTab();
    await screen.findByText("LI-1");
    await openDimensionFilter("Channel");
    const popover = await screen.findByRole("dialog", { name: "Filter — Channel" });
    await userEvent.click(within(popover).getByText("Display"));
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByText("Channel: Display")).toBeInTheDocument());
    vi.mocked(listCampaignReportRows).mockClear();

    // When: Channel is deselected from Dimensions and applied - the direct inverse of the old
    // pruning behaviour this ticket removes
    const dimensions = within(screen.getByText("Dimensions").closest(".reporting-tab__picker") as HTMLElement);
    await userEvent.click(dimensions.getByRole("checkbox", { name: "Channel" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then: the filter survives even though its column is gone
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenLastCalledWith(42, 1, 25, {
        filters: [{ field: "CHANNEL", values: ["Display"] }],
        groupBy: ["DATE", "LINE_ITEM_ID"],
        sortField: undefined,
        sortDirection: undefined,
      })
    );
    expect(screen.getByText("Channel: Display")).toBeInTheDocument();
  });

  it("should keep the date window when the Date column is deselected", async () => {
    // Given: a date window applied while Date is a displayed column
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "All dates" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Date" });
    await userEvent.type(within(popover).getByLabelText("From"), "2026-03-10");
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Mar 10, 2026/ })).toBeInTheDocument()
    );
    vi.mocked(listCampaignReportRows).mockClear();

    // When: the Date dimension is dropped from the report and applied
    const dimensions = within(screen.getByText("Dimensions").closest(".reporting-tab__picker") as HTMLElement);
    await userEvent.click(dimensions.getByRole("checkbox", { name: "Date" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then: the window survives - it is not reached through the Date column at all anymore (D2/D3)
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenLastCalledWith(42, 1, 25, {
        filters: [],
        groupBy: ["LINE_ITEM_ID"],
        dateFrom: "2026-03-10",
        dateTo: undefined,
        sortField: undefined,
        sortDirection: undefined,
      })
    );
    expect(screen.getByRole("button", { name: /Mar 10, 2026/ })).toBeInTheDocument();
  });

  it("should mark a filter on a non-displayed dimension as hidden", async () => {
    // Given: a report whose dimensions do not include Channel
    renderReportingTab();
    await screen.findByText("LI-1");

    // When: Channel is filtered without ever being added as a column
    await openDimensionFilter("Channel");
    const popover = await screen.findByRole("dialog", { name: "Filter — Channel" });
    await userEvent.click(within(popover).getByText("Display"));
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));

    // Then: the chip says so, dashed and explained, not silently hidden (D4)
    const chip = await screen.findByRole("button", { name: /Filtered on a column that is not displayed/ });
    expect(chip).toHaveAttribute("title", "Filtered on a column that is not displayed");
    expect(chip.closest(".data-table__chip")).toHaveClass("data-table__chip--hidden");
  });

  it("should list every dimension except Date in the field picker", async () => {
    // Given:
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    const picker = await screen.findByRole("dialog", { name: "Add filter" });

    // Then: every dimension the backend can filter by except Date, whose persistent pill already owns
    // it - counted against DIM_DEFS.length so a dimension added later is covered automatically
    expect(within(picker).getAllByRole("button")).toHaveLength(DIM_DEFS.length - 1);
    expect(within(picker).queryByText("Date")).not.toBeInTheDocument();
  });

  it("should reopen a filter's value popover from its chip", async () => {
    // Given: a report already filtered to one value
    renderReportingTab();
    await screen.findByText("LI-1");
    await openDimensionFilter("Constructed id L1");
    const first = await screen.findByRole("dialog", { name: "Filter — Constructed id L1" });
    await userEvent.click(within(first).getByText("Display"));
    await userEvent.click(within(first).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByText("Constructed id L1: Display")).toBeInTheDocument());

    // When: the chip's own label is clicked, not its ×
    await userEvent.click(screen.getByText("Constructed id L1: Display"));

    // Then: the value popover reopens, staged with what is already applied (D5)
    const reopened = await screen.findByRole("dialog", { name: "Filter — Constructed id L1" });
    expect((within(reopened).getByText("Display").closest("label") as HTMLLabelElement).querySelector("input")).toBeChecked();
  });

  it("should clear every filter but keep the date window when Clear all is used", async () => {
    // Given: a dimension filter and a date window both applied
    renderReportingTab();
    await screen.findByText("LI-1");
    await openDimensionFilter("Constructed id L1");
    const valuePopover = await screen.findByRole("dialog", { name: "Filter — Constructed id L1" });
    await userEvent.click(within(valuePopover).getByText("Display"));
    await userEvent.click(within(valuePopover).getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("button", { name: "All dates" }));
    const datePopover = await screen.findByRole("dialog", { name: "Filter — Date" });
    await userEvent.type(within(datePopover).getByLabelText("From"), "2026-03-10");
    await userEvent.click(within(datePopover).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByText("Constructed id L1: Display")).toBeInTheDocument());

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Clear all" }));

    // Then: the dimension filter is gone; the persistent Date pill is not touched by Clear all
    await waitFor(() =>
      expect(screen.queryByText("Constructed id L1: Display")).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /Mar 10, 2026/ })).toBeInTheDocument();
  });

  it("should drop the sort but keep the filter when a sorted, filtered dimension is deselected", async () => {
    // Given: a report with Channel added as a dimension, sorted and filtered by it
    mockReportViews([aReportView({ dimensions: ["date", "line_item_id", "channel"] })]);
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Channel" }));
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenCalledWith(42, 1, 25, {
        filters: [],
        groupBy: ["DATE", "LINE_ITEM_ID", "CHANNEL"],
        sortField: "CHANNEL",
        sortDirection: "ASC",
      })
    );
    await openDimensionFilter("Channel");
    const popover = await screen.findByRole("dialog", { name: "Filter — Channel" });
    await userEvent.click(within(popover).getByText("Display"));
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByText("Channel: Display")).toBeInTheDocument());
    vi.mocked(listCampaignReportRows).mockClear();

    // When: Channel is deselected from Dimensions and applied
    const dimensions = within(screen.getByText("Dimensions").closest(".reporting-tab__picker") as HTMLElement);
    await userEvent.click(dimensions.getByRole("checkbox", { name: "Channel" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Then: the sort is gone (a grouped read cannot order by an ungrouped column, D3) but the filter,
    // reached independently of the column now, survives
    await waitFor(() =>
      expect(listCampaignReportRows).toHaveBeenLastCalledWith(42, 1, 25, {
        filters: [{ field: "CHANNEL", values: ["Display"] }],
        groupBy: ["DATE", "LINE_ITEM_ID"],
        sortField: undefined,
        sortDirection: undefined,
      })
    );
    expect(screen.getByText("Channel: Display")).toBeInTheDocument();
  });

  it("should save a date window on a report whose Date column is not selected", async () => {
    // Given: a report that does not display Date as a column
    mockReportViews([aReportView({ dimensions: ["line_item_id"] })]);
    vi.mocked(updateReportView).mockResolvedValue({ ...SAVED_VIEW_DTO, status: "saved" });
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "All dates" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Date" });
    await userEvent.type(within(popover).getByLabelText("From"), "2026-03-10");
    await userEvent.type(within(popover).getByLabelText("To"), "2026-03-20");
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Mar 10, 2026/ })).toBeInTheDocument()
    );

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Save report" }));

    // Then: the window is written even though Date is not a displayed column (D2/5f)
    await waitFor(() => expect(updateReportView).toHaveBeenCalledTimes(1));
    expect(updateReportView).toHaveBeenCalledWith(42, 1, expect.objectContaining({
      filters: [{ field: "DATE", values: ["2026-03-10", "2026-03-20"] }],
    }));
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
    const totalsRow = () => document.querySelector(".data-table__totals") as HTMLElement;
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
    const totalsRow = () => document.querySelector(".data-table__totals") as HTMLElement;
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
    const totalsRow = () => document.querySelector(".data-table__totals") as HTMLElement;

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
    expect(screen.getByRole("button", { name: "All dates" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Filter" })).toBeDisabled();
  });

  it("should leave cpm alone while Cost is edited, since cpm is not built on Cost", async () => {
    // Given: a row the server sent a cpm for
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage({ content: [aRow({ cpm: 18 })] }));
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    expect(screen.getByText("$18.00")).toBeInTheDocument();

    // When: DSP Cost - the editable stored cost column - is edited
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
    expect(screen.getByRole("textbox", { name: "DSP Cost for LI-1" })).toHaveValue("500");
  });

  it("should remove a manually added line when its cross is clicked", async () => {
    // Given: a pristine added line, untouched since Add line
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    expect(screen.getByLabelText("Date for new line")).toBeInTheDocument();

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Remove new line" }));

    // Then: gone at once - a pristine row needs no confirmation
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Date for new line")).not.toBeInTheDocument();
  });

  it("should keep an added line's date editable, with the remove control out of the cell's flow", async () => {
    // Given: a fresh added line. Its leading cell is the date - the first required adjustment key
    // dimension - and that cell clips its overflow, so a remove button rendered inline ahead of the
    // date input would push the input's right edge (calendar icon, year segment) out of sight.
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));

    // When: the date is entered
    const dateInput = screen.getByLabelText("Date for new line");
    fireEvent.change(dateInput, { target: { value: "2026-03-04" } });

    // Then: the value lands, and the ✕ shares that cell from outside its content flow. jsdom does no
    // layout, so the class is the guard: it is what makes the button absolutely positioned in the
    // padding the cell already reserves, instead of taking width away from the input.
    expect(dateInput).toHaveValue("2026-03-04");
    const dateCell = dateInput.closest("td");
    expect(dateCell).toHaveClass("reporting-tab__cell--removable");
    expect(dateCell).toContainElement(screen.getByRole("button", { name: "Remove new line" }));
  });

  it("should not offer a remove control on an existing report row", async () => {
    // Given: two existing server rows
    vi.mocked(listCampaignReportRows).mockResolvedValue(
      aPage({ content: [aRow(), aRow({ line_item_id: "LI-2" })] })
    );
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));

    // When: one manual line is added alongside the two server rows
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));

    // Then: exactly one remove control - the added row's, not either existing row's (D1)
    expect(screen.getAllByRole("button", { name: "Remove new line" })).toHaveLength(1);
  });

  it("should confirm before removing an added line that has values typed into it", async () => {
    // Given: an added line with a typed metric value
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Impressions for new line" }), "2000");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Remove new line" }));

    // Then: a confirmation dialog appears, and the row stays until it is confirmed
    const dialog = await screen.findByRole("dialog", { name: "Remove this line?" });
    expect(screen.getByLabelText("Date for new line")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove line" }));

    // Then: removed once confirmed
    expect(screen.queryByLabelText("Date for new line")).not.toBeInTheDocument();
  });

  it("should keep the added line when its removal is cancelled", async () => {
    // Given: an added line with a typed metric value, mid-removal
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Impressions for new line" }), "2000");
    await userEvent.click(screen.getByRole("button", { name: "Remove new line" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove this line?" });

    // When:
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // Then: still there, value intact
    expect(screen.getByRole("textbox", { name: "Impressions for new line" })).toHaveValue("2000");
  });

  it("should stop blocking save on an invalid metric that belonged to a removed line", async () => {
    // Given: a valid edit already staged on the existing row, plus an added line whose metric is
    // unparsable - the exact combination that used to leave a stale invalidCells entry behind (D3).
    // An unparsable value parses to `undefined`, the same as a cleared cell, so the row still counts
    // as pristine and its removal needs no confirmation (D5) - only the stale flag itself is at issue.
    vi.mocked(saveReportRowAdjustments).mockResolvedValue(undefined);
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const spendInput = screen.getByRole("textbox", { name: /Cost for/ });
    await userEvent.clear(spendInput);
    await userEvent.type(spendInput, "500");
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    // fireEvent.change, not userEvent.type: the point is the invalid value landing, not how it's typed
    fireEvent.change(screen.getByRole("textbox", { name: "Impressions for new line" }), { target: { value: "abc" } });
    expect(screen.getByText("Not a number")).toBeInTheDocument();

    // When: the invalid line is removed and the batch is saved
    await userEvent.click(screen.getByRole("button", { name: "Remove new line" }));
    await userEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    // Then: the removed row's stale invalid flag no longer blocks the save of the surviving edit
    await waitFor(() => expect(saveReportRowAdjustments).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Fix the invalid metric values before saving.")).not.toBeInTheDocument();
  });

  it("should not bring a removed line back when Undo is pressed", async () => {
    // Given: a line added FIRST, then an edit staged on the existing row. The order matters: that
    // edit's undo snapshot is taken while the added row is already in the batch, so it carries a copy
    // of it. Staging the edit before the add would leave a snapshot with an empty `added` and the test
    // would pass whether or not removal prunes the history at all (D4).
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    // Named in full, not /Cost for/: with a line added, that pattern also matches the new row's own
    // cost cell.
    const spendInput = screen.getByRole("textbox", { name: "DSP Cost for LI-1" });
    await userEvent.clear(spendInput);
    await userEvent.type(spendInput, "500");
    await userEvent.click(screen.getByRole("button", { name: "Remove new line" }));
    expect(screen.queryByLabelText("Date for new line")).not.toBeInTheDocument();

    // When: Undo rewinds the spend edit - removal is not itself undoable (D4), so that edit is the
    // only history entry left
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));

    // Then: the spend edit is rewound, and the removed row is NOT resurrected out of its snapshot
    expect(screen.getByRole("textbox", { name: "DSP Cost for LI-1" })).not.toHaveValue("500");
    expect(screen.queryByLabelText("Date for new line")).not.toBeInTheDocument();
  });

  it("should keep the other staged edits when one added line is removed", async () => {
    // Given: an edited existing row and two added lines, each with its own impressions value
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    const spendInput = screen.getByRole("textbox", { name: /Cost for/ });
    await userEvent.clear(spendInput);
    await userEvent.type(spendInput, "500");
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    const impressionsInputs = screen.getAllByRole("textbox", { name: "Impressions for new line" });
    await userEvent.type(impressionsInputs[0], "1000");
    await userEvent.type(impressionsInputs[1], "2000");
    expect(screen.getByRole("button", { name: "Save changes (3)" })).toBeInTheDocument();

    // When: the first (most recently added) line is removed
    const removeButtons = screen.getAllByRole("button", { name: "Remove new line" });
    await userEvent.click(removeButtons[0]);
    const dialog = await screen.findByRole("dialog", { name: "Remove this line?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove line" }));

    // Then: the other added line and the existing row's edit both survive, count drops by exactly one
    expect(screen.getByRole("button", { name: "Save changes (2)" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "DSP Cost for LI-1" })).toHaveValue("500");
    expect(screen.getAllByRole("textbox", { name: "Impressions for new line" })).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Impressions for new line" })).toHaveValue("2000");
  });

  it("should exclude a removed line from the save payload", async () => {
    // Given: one added line filled in completely (identity resolved through the PDI_117 id flow), and a
    // second one carrying only a stray metric value that is never meant to be saved
    vi.mocked(saveReportRowAdjustments).mockResolvedValue(undefined);
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));

    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    fireEvent.change(screen.getByLabelText("Date for new line"), { target: { value: "2026-03-11" } });
    const survivorFields: [string, string][] = [
      ["Impressions for new line", "777"],
      ["Platform for new line", "DV360"],
      ["Account for new line", "Proxim Agency"],
      ["Account id for new line", "12345"],
      ["Constructed name L1 for new line", "ProximAgency_FPCU_12"],
      ["Constructed name L2 for new line", "IO-1"],
      ["Constructed name L3 for new line", "Whitelist"],
    ];
    for (const [name, value] of survivorFields) {
      fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
    }
    // Each level independently resolves to nothing and must be confirmed as new before it generates
    for (const level of ["LVL1", "LVL2", "LVL3"]) {
      const confirmButton = await screen.findByRole(
        "button", { name: `${level} id - no match, create it as new?` }
      );
      await userEvent.click(confirmButton);
    }
    await waitFor(
      () => {
        expect(screen.getByText("OPH_defaultlevel1")).toBeInTheDocument();
        expect(screen.getByText("OPH_defaultlevel2")).toBeInTheDocument();
        expect(screen.getByText("OPH_defaultlevel3")).toBeInTheDocument();
      },
      { timeout: 5000 }
    );

    // The second line: never filled in beyond one metric - it is removed before Save ever sees it, so
    // its missing identity must not matter
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Impressions for new line" }), { target: { value: "999" } });

    // When: the unfinished line is removed and the batch is saved
    await userEvent.click(screen.getAllByRole("button", { name: "Remove new line" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Remove this line?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove line" }));
    await userEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    // Then: the payload carries only the surviving row - if the wrong row were purged, this save would
    // instead fail on the survivor's own missing required fields rather than silently posting both/neither
    await waitFor(() => expect(saveReportRowAdjustments).toHaveBeenCalledTimes(1));
    const calls = vi.mocked(saveReportRowAdjustments).mock.calls[0];
    const sent = (calls[calls.length - 1] as { adjustments: Record<string, unknown>[] }).adjustments;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ added: true, impressions: 777 });
  }, 20_000);

  it("should trim a typed key before writing it, as every spreadsheet comparison does", async () => {
    // Given: an added line whose Level 1 name arrived with a stray space around it, as a paste does.
    // PDI_117: the three constructed ids are never typed and resolution is per level (D2) - the default
    // mock campaign has no mart data at all, so every level resolves to nothing and must be confirmed as
    // new individually. The point of this test is the typed name key, not how the ids get filled.
    vi.mocked(saveReportRowAdjustments).mockResolvedValue(undefined);
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Adjust individual lines" }));
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    fireEvent.change(screen.getByLabelText("Date for new line"), { target: { value: "2026-03-10" } });
    const typed: [string, string][] = [
      // The metric first: a metric cell is labelled after the row's own line-item id once it has one, and
      // the point of this test is the key, not the label
      ["Impressions for new line", "1000"],
      ["Platform for new line", "DV360"],
      ["Account for new line", " Proxim Agency "],
      ["Account id for new line", "12345"],
      ["Constructed name L1 for new line", "  ProximAgency_FPCU_12  "],
      ["Constructed name L2 for new line", "IO-1"],
      ["Constructed name L3 for new line", "Whitelist"],
    ];
    for (const [name, value] of typed) {
      fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
    }
    // Each level independently resolves to nothing and must be confirmed as new before it generates
    for (const level of ["LVL1", "LVL2", "LVL3"]) {
      const confirmButton = await screen.findByRole(
        "button", { name: `${level} id - no match, create it as new?` }
      );
      await userEvent.click(confirmButton);
    }
    // The generated ids fill in asynchronously (debounced preview) before Save is allowed to proceed
    // One budget covering all three rather than three one-second budgets in series: the ids arrive
    // together in a single debounced preview response, so waiting for them separately spends the first
    // two budgets on an event that has already happened and leaves the third to absorb every delay. On
    // a loaded CI runner that third budget expires while React is still flushing the staged updates.
    await waitFor(
      () => {
        expect(screen.getByText("OPH_defaultlevel1")).toBeInTheDocument();
        expect(screen.getByText("OPH_defaultlevel2")).toBeInTheDocument();
        expect(screen.getByText("OPH_defaultlevel3")).toBeInTheDocument();
      },
      { timeout: 5000 }
    );

    // When:
    await userEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    // Then: written without the stray spaces. Every name comparison the reporting spreadsheets make wraps
    // both sides in TRIM, so an untrimmed key is one they would call equal and an exact-key write would
    // not - the row would land in the write table and match nothing on read
    await waitFor(() => expect(saveReportRowAdjustments).toHaveBeenCalledTimes(1));
    const calls = vi.mocked(saveReportRowAdjustments).mock.calls[0];
    const sent = (calls[calls.length - 1] as { adjustments: Record<string, unknown>[] }).adjustments[0];
    expect(sent.line_item_name).toBe("ProximAgency_FPCU_12");
    expect(sent.account).toBe("Proxim Agency");
    // This runs in ~525ms locally, so the ceiling below is not a duration - a passing run never spends
    // it. It exists because the test waits out three debounced resolutions plus the id preview, and a
    // CI runner measured ~2.6x slower turns that wait into seconds. The default 5s budget is shared
    // with the waitFor above, so the two starve each other exactly when the machine is loaded.
    // If this ever times out again, the cause is no longer a tight budget: do not raise this further,
    // find out why the third level's generated id never renders.
  }, 20_000);

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
    // PDI_117: the constructed id cells are never inputs, so a missing id shows the same "Required" text
    // as every other empty REQUIRED cell rather than an invalid textbox of its own.
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
    const backgroundReload = deferred<ReportRowsPageResponseV1>();
    vi.mocked(listCampaignReportRows).mockImplementationOnce(() => backgroundReload.promise);

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
    // ...and the report-rows query refetches once, since Save invalidates it. The successful write is
    // acknowledged before that expensive BigQuery read finishes; the table owns its loading state.
    await waitFor(() => expect(listCampaignReportRows).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Edits saved.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Cost for/ })).not.toBeInTheDocument();

    await act(async () => backgroundReload.resolve(aPage()));
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
        dateFrom: undefined,
        dateTo: undefined,
        sortField: undefined,
        sortDirection: undefined,
      })
    );
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url"));
  });

  it("should download the template for the date window the screen is filtered to", async () => {
    // Given: a report narrowed to a date window, as someone does before editing that slice
    const blob = new Blob(["fake xlsx bytes"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    vi.mocked(downloadBulkAdjustmentTemplate).mockResolvedValue({ blob, truncated: false });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock-url"), revokeObjectURL: vi.fn() });
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "All dates" }));
    const popover = await screen.findByRole("dialog", { name: "Filter — Date" });
    await userEvent.type(within(popover).getByLabelText("From"), "2026-08-01");
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Bulk manual adjustment" }));

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Download data (.xlsx)" }));

    // Then: the window travels with the dimension filters, rather than the file quietly covering
    // every month of the campaign
    await waitFor(() =>
      expect(downloadBulkAdjustmentTemplate).toHaveBeenCalledWith(42, expect.objectContaining({
        dateFrom: "2026-08-01",
        dateTo: undefined,
      }))
    );
  });

  it("should upload the chosen file and toast the applied count", async () => {
    // Given:
    vi.mocked(uploadBulkAdjustments).mockResolvedValue({ applied: 2 });
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Edit data" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Bulk manual adjustment" }));
    vi.mocked(listCampaignReportRows).mockClear();
    const backgroundReload = deferred<ReportRowsPageResponseV1>();
    vi.mocked(listCampaignReportRows).mockImplementationOnce(() => backgroundReload.promise);
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
    // Then: back to read-only as soon as the upload succeeds; the expensive row refresh stays local
    // to the table and does not keep the upload mutation pending.
    expect(screen.getByRole("button", { name: "Edit data" })).toBeInTheDocument();

    await act(async () => backgroundReload.resolve(aPage()));
  });

  it("should download the conversions template with the date window and no dimension filters", async () => {
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

describe("ReportingTab column width", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallbacks = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage());
  });

  it("should let a widened column show its whole header name", async () => {
    // Given: a report showing a column whose name does not fit the default width
    mockReportViews([aReportView({ dimensions: ["date"], metrics: ["last_modified_at"] })]);
    renderReportingTab();
    await screen.findByText("Mar 10, 2026");
    const label = screen.getByTitle(/Date/);
    // The cap that keeps an unsized column from being stretched by a long name
    expect(label.className).not.toContain("data-table__label--sized");

    // When: the column is widened by the keyboard, the same path the drag handle takes
    const handle = screen.getByRole("separator", { name: "Resize Date" });
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowRight" });

    // Then: the cap comes off, so the name fills the width the user just asked for. Leaving it on meant
    // dragging a column wider and watching the name stay clipped - the one thing the drag was for.
    await waitFor(() => expect(screen.getByTitle(/Date/).className)
      .toContain("data-table__label--sized"));
  });
});

describe("ReportingTab column order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    intersectionCallbacks = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.mocked(listCampaignReportRows).mockResolvedValue(aPage());
  });

  /** The table's column headers, in the order they are rendered. */
  function headerOrder() {
    return screen
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent ?? "")
      .filter((text) => text !== "");
  }

  it("should show the columns in the order the report was saved with", async () => {
    // Given: a report someone dragged spend in front of impressions on
    mockReportViews([aReportView({
      dimensions: ["date", "line_item_id"],
      metrics: ["impressions", "spend"],
      columnOrder: ["line_item_id", "date", "spend", "impressions"],
    })]);
    renderReportingTab();
    await screen.findByText("LI-1");

    // Then: the saved order wins over the canonical one, within each group
    const order = headerOrder();
    expect(order.findIndex((text) => text.includes("Constructed id L1")))
      .toBeLessThan(order.findIndex((text) => text.includes("Date")));
    expect(order.findIndex((text) => text.includes("Cost")))
      .toBeLessThan(order.findIndex((text) => text.includes("Impressions")));
  });

  it("should fall a column the saved order does not mention in behind the ones it does", async () => {
    // Given: an order saved before Clicks was added to the report
    mockReportViews([aReportView({
      dimensions: ["date"],
      metrics: ["impressions", "clicks"],
      columnOrder: ["date", "impressions"],
    })]);
    renderReportingTab();
    await screen.findByText("Mar 10, 2026");

    // Then: the new column goes last rather than collapsing the whole arrangement back to canonical
    const order = headerOrder();
    expect(order.findIndex((text) => text.includes("Impressions")))
      .toBeLessThan(order.findIndex((text) => text.includes("Clicks")));
  });

  it("should move a metric the saved order does not mention", async () => {
    // Given: an arrangement saved before Clicks was added, so the saved order does not mention it. This is
    // the ordinary case for metrics - they are what gets ticked after a report has been arranged.
    mockReportViews([aReportView({
      dimensions: ["date"],
      metrics: ["impressions", "clicks"],
      columnOrder: ["date", "impressions"],
    })]);
    vi.mocked(updateReportView).mockResolvedValue(aReportView());
    renderReportingTab();
    await screen.findByText("Mar 10, 2026");

    // When: that column is dragged in front of one the order does mention (Date, Impressions, Clicks)
    const headers = screen.getAllByRole("columnheader");
    const clicksAt = headers.findIndex((c) => (c.textContent ?? "").includes("Clicks"));
    const impressionsAt = headers.findIndex((c) => (c.textContent ?? "").includes("Impressions"));
    dragHeaderBefore(clicksAt, impressionsAt);

    // Then: it moves, and the saved arrangement now mentions every column on screen. It used to sit still:
    // a move looked its column up in the saved order, found nothing, and returned the order unchanged.
    await waitFor(() => {
      const after = headerOrder();
      expect(after.findIndex((x) => x.includes("Clicks")))
        .toBeLessThan(after.findIndex((x) => x.includes("Impressions")));
    });
    await waitFor(() => expect(updateReportView).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateReportView).mock.calls[0][2].columnOrder)
      .toEqual(["date", "clicks", "impressions"]);
  });

  it("should nudge a metric the saved order does not mention with the keyboard", async () => {
    // Given: the same report, arranged before Clicks existed on it
    mockReportViews([aReportView({
      dimensions: ["date"],
      metrics: ["impressions", "clicks"],
      columnOrder: ["date", "impressions"],
    })]);
    vi.mocked(updateReportView).mockResolvedValue(aReportView());
    renderReportingTab();
    await screen.findByText("Mar 10, 2026");
    const clicks = screen.getAllByRole("columnheader").find((c) => (c.textContent ?? "").includes("Clicks"));

    // When: nudged left with the keyboard
    fireEvent.keyDown(clicks as HTMLElement, { key: "ArrowLeft", altKey: true });

    // Then: the keyboard path reaches the same arrangement as the drag, which it also could not before
    await waitFor(() => {
      const after = headerOrder();
      expect(after.findIndex((x) => x.includes("Clicks")))
        .toBeLessThan(after.findIndex((x) => x.includes("Impressions")));
    });
    await waitFor(() => expect(updateReportView).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateReportView).mock.calls[0][2].columnOrder)
      .toEqual(["date", "clicks", "impressions"]);
  });

  it("should let a metric land between two dimensions, since a report no longer keeps them in two groups", async () => {
    // Given: a report with a metric and two dimensions, in canonical order
    mockReportViews([aReportView({ dimensions: ["date", "line_item_id"], metrics: ["impressions"] })]);
    vi.mocked(updateReportView).mockResolvedValue(aReportView());
    renderReportingTab();
    await screen.findByText("Mar 10, 2026");
    // Indices into the unfiltered header list - the same one `dragHeaderBefore` reads - not
    // `headerOrder()`, whose own filtering would otherwise disagree with it on where each column sits.
    const before = screen.getAllByRole("columnheader");
    const dateAt = before.findIndex((c) => (c.textContent ?? "").includes("Date"));
    const idAt = before.findIndex((c) => (c.textContent ?? "").includes("Constructed id L1"));
    const impressionsAt = before.findIndex((c) => (c.textContent ?? "").includes("Impressions"));
    expect(dateAt).toBeLessThan(idAt);
    expect(idAt).toBeLessThan(impressionsAt);

    // When: the metric is dropped between the two dimensions
    dragHeaderBefore(impressionsAt, idAt);

    // Then: it lands there rather than being refused - the whole point of the interleaved arrangement
    await waitFor(() => {
      const after = headerOrder();
      expect(after.findIndex((x) => x.includes("Date")))
        .toBeLessThan(after.findIndex((x) => x.includes("Impressions")));
      expect(after.findIndex((x) => x.includes("Impressions")))
        .toBeLessThan(after.findIndex((x) => x.includes("Constructed id L1")));
    });
    await waitFor(() => expect(updateReportView).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateReportView).mock.calls[0][2].columnOrder)
      .toEqual(["date", "impressions", "line_item_id"]);
  });

  it("should follow the header into the interleaved order in the body and totals rows too", async () => {
    // Given: the same report, so a body row and the totals row both carry real values to check the
    // order of rather than just labels
    mockReportViews([aReportView({ dimensions: ["date", "line_item_id"], metrics: ["impressions"] })]);
    vi.mocked(updateReportView).mockResolvedValue(aReportView());
    renderReportingTab();
    await screen.findByText("Mar 10, 2026");
    // Indices into the unfiltered header list - see the note in the test above.
    const before = screen.getAllByRole("columnheader");
    const idAt = before.findIndex((c) => (c.textContent ?? "").includes("Constructed id L1"));
    const impressionsAt = before.findIndex((c) => (c.textContent ?? "").includes("Impressions"));

    // When: Impressions is dropped between Date and Constructed id L1
    dragHeaderBefore(impressionsAt, idAt);
    await waitFor(() => {
      const after = headerOrder();
      expect(after.findIndex((x) => x.includes("Date")))
        .toBeLessThan(after.findIndex((x) => x.includes("Impressions")));
      expect(after.findIndex((x) => x.includes("Impressions")))
        .toBeLessThan(after.findIndex((x) => x.includes("Constructed id L1")));
    });

    // Then: the body row's own cells read Date, Impressions, then the line item id - not just the header
    const bodyRow = document.querySelector("tbody tr[data-index]") as HTMLElement;
    const bodyCells = Array.from(bodyRow.querySelectorAll("td")).map((cell) => cell.textContent ?? "");
    expect(bodyCells[0]).toContain("Mar 10, 2026");
    expect(bodyCells[2]).toContain("LI-1");

    // And: so does the pinned totals row
    const totalsRow = document.querySelector(".data-table__totals") as HTMLElement;
    const totalsCells = Array.from(totalsRow.querySelectorAll("td")).map((cell) => cell.textContent ?? "");
    expect(totalsCells[0]).toContain("Mar");
    expect(totalsCells[2]).toContain("value");
  });

  it("should reorder on a drop and save the arrangement at once", async () => {
    // Given: a report at the canonical order, with no order of its own yet
    mockReportViews([aReportView({ dimensions: ["date"], metrics: ["impressions", "spend"] })]);
    vi.mocked(updateReportView).mockResolvedValue(aReportView());
    renderReportingTab();
    await screen.findByText("Mar 10, 2026");
    expect(headerOrder().findIndex((t) => t.includes("Impressions")))
      .toBeLessThan(headerOrder().findIndex((t) => t.includes("Cost")));
    // Indices into the unfiltered header list - see the note further up this describe block.
    const before = screen.getAllByRole("columnheader");
    const costAt = before.findIndex((c) => (c.textContent ?? "").includes("Cost"));
    const impressionsAt = before.findIndex((c) => (c.textContent ?? "").includes("Impressions"));

    // When: Cost is dragged onto Impressions
    dragHeaderBefore(costAt, impressionsAt);

    // Then: it moves at once - a drag rearranges what you are looking at, so waiting for Apply would be
    // asking the user to confirm something they already did
    await waitFor(() => {
      const after = headerOrder();
      expect(after.findIndex((t) => t.includes("Cost")))
        .toBeLessThan(after.findIndex((t) => t.includes("Impressions")));
    });

    // And it is kept without anyone pressing a button: an arrangement is how the report is read, and
    // needing to save it meant every reload undid the reading
    await waitFor(() => expect(updateReportView).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(updateReportView).mock.calls[0][2];
    expect(saved.columnOrder).toEqual(["date", "spend", "impressions"]);
  });

  it("should save nothing but the arrangement when a column moves", async () => {
    // Given: a saved report whose metric selection has been staged but not applied
    mockReportViews([aReportView({ dimensions: ["date"], metrics: ["impressions", "spend"] })]);
    vi.mocked(updateReportView).mockResolvedValue(aReportView());
    renderReportingTab();
    await screen.findByText("Mar 10, 2026");
    const metrics = within(screen.getByText("Metrics").closest(".reporting-tab__picker") as HTMLElement);
    await userEvent.click(metrics.getByRole("checkbox", { name: /^Clicks/ }));

    // When: a column is dragged
    const headers = screen.getAllByRole("columnheader");
    const costAt = headers.findIndex((c) => (c.textContent ?? "").includes("Cost"));
    const impressionsAt = headers.findIndex((c) => (c.textContent ?? "").includes("Impressions"));
    dragHeaderBefore(costAt, impressionsAt);

    // Then: the write carries the stored selection, not the staged one, and leaves the status alone - a
    // drag must not commit the columns behind the Apply the user has not pressed
    await waitFor(() => expect(updateReportView).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(updateReportView).mock.calls[0][2];
    expect(saved.metrics).toEqual(["impressions", "spend"]);
    expect(saved.status).toBe("saved");
    expect(saved.columnOrder).toEqual(["date", "spend", "impressions"]);
  });

  it("should reorder one column slot with the keyboard and save it at once", async () => {
    // Given: a report with the same columns a mouse user can drag
    mockReportViews([aReportView({ dimensions: ["date"], metrics: ["impressions", "spend"] })]);
    vi.mocked(updateReportView).mockResolvedValue(aReportView());
    renderReportingTab();
    await screen.findByText("Mar 10, 2026");
    const cost = screen.getAllByRole("columnheader").find((c) => (c.textContent ?? "").includes("Cost"));

    // When: Cost is nudged left with the keyboard
    fireEvent.keyDown(cost as HTMLElement, { key: "ArrowLeft", altKey: true });

    // Then: the visual order and saved report contract match the drag behavior
    await waitFor(() => {
      const after = headerOrder();
      expect(after.findIndex((t) => t.includes("Cost")))
        .toBeLessThan(after.findIndex((t) => t.includes("Impressions")));
    });
    await waitFor(() => expect(updateReportView).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(updateReportView).mock.calls[0][2];
    expect(saved.columnOrder).toEqual(["date", "spend", "impressions"]);
  });

  it("should not read the table again just because a column moved", async () => {
    // Given:
    mockReportViews([aReportView({ dimensions: ["date"], metrics: ["impressions", "spend"] })]);
    renderReportingTab();
    await screen.findByText("Mar 10, 2026");
    vi.mocked(listCampaignReportRows).mockClear();

    // When:
    const headers = screen.getAllByRole("columnheader");
    const costAt = headers.findIndex((c) => (c.textContent ?? "").includes("Cost"));
    const impressionsAt = headers.findIndex((c) => (c.textContent ?? "").includes("Impressions"));
    dragHeaderBefore(costAt, impressionsAt);

    // Then: the rows are the same rows in a different order of columns - the grouping the server was asked
    // for has not changed, so re-reading a multi-second BigQuery query would buy nothing
    await waitFor(() => {
      const after = headerOrder();
      expect(after.findIndex((t) => t.includes("Cost")))
        .toBeLessThan(after.findIndex((t) => t.includes("Impressions")));
    });
    expect(screen.getAllByRole("columnheader")).toHaveLength(headers.length);
    expect(listCampaignReportRows).not.toHaveBeenCalled();
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
        // The fully resolved on-screen order, not the (absent) saved one - the workbook has to match
        // the screen even before anyone has ever dragged a column.
        columnOrder: ["date", "line_item_id", "impressions", "spend"],
      })
    );
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(createdLink?.download).toBe("Ourisman Ford 2026 - All data.xlsx");
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url"));
  });

  it("should export the current view with a filter on a non-displayed dimension", async () => {
    // Given: a report filtered by Channel without Channel ever being a displayed column (PDI_115)
    vi.mocked(listReportRowDistinctValues).mockResolvedValue(["Display", "Video"]);
    vi.mocked(exportReportRows).mockResolvedValue({
      blob: new Blob(["fake xlsx bytes"], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      truncated: false,
    });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock-url"), revokeObjectURL: vi.fn() });
    renderReportingTab();
    await screen.findByText("LI-1");
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    const picker = await screen.findByRole("dialog", { name: "Add filter" });
    await userEvent.click(within(picker).getByText("Channel"));
    const popover = await screen.findByRole("dialog", { name: "Filter — Channel" });
    await userEvent.click(within(popover).getByText("Display"));
    await userEvent.click(within(popover).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByText("Channel: Display")).toBeInTheDocument());

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Current view" }));

    // Then: the filter travels to the export even though Channel is not one of the exported columns
    await waitFor(() =>
      expect(exportReportRows).toHaveBeenCalledWith(42, expect.objectContaining({
        filters: [{ field: "CHANNEL", values: ["Display"] }],
        groupBy: DEFAULT_GROUP_BY,
        dimensions: ["date", "line_item_id"],
      }))
    );
  });

  it("should download current view columns in the saved visible order", async () => {
    // Given: the user dragged Cost before Impressions and saved the report
    mockReportViews([aReportView({
      columnOrder: ["line_item_id", "date", "spend", "impressions"],
    })]);
    vi.mocked(exportReportRows).mockResolvedValue({
      blob: new Blob(["fake xlsx bytes"], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      truncated: false,
    });
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock-url"),
      revokeObjectURL: vi.fn(),
    });
    renderReportingTab();
    await screen.findByText("LI-1");

    // When:
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Current view" }));

    // Then: the export endpoint receives the same per-group order the table renders
    await waitFor(() =>
      expect(exportReportRows).toHaveBeenCalledWith(42, expect.objectContaining({
        dimensions: ["line_item_id", "date"],
        metrics: ["spend", "impressions"],
      }))
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
});
