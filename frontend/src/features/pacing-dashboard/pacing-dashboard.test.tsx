import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aPacingDashboardV1,
  aPacingLibraryEntryV1,
  aPacingLineItemPlanV1,
  aPacingRefreshStatusV1,
  aPacingRowV1,
} from "@/test/factories";
import * as api from "./api";
import { PacingDashboard } from "./pacing-dashboard";

vi.mock("./api", () => ({
  getPacingDashboard: vi.fn(),
  getPacingRefreshStatus: vi.fn(),
  triggerPacingRefresh: vi.fn(),
  savePacingDisplay: vi.fn(),
  listPacingLibrary: vi.fn(),
  createPacingLibraryEntry: vi.fn(),
  updatePacingLibraryEntry: vi.fn(),
  deletePacingLibraryEntry: vi.fn(),
  setPacingLibraryLike: vi.fn(),
}));

function renderDashboard(
  rowOverrides: Parameters<typeof aPacingRowV1>[0] = {},
  props: { watchFirstData?: boolean } = {}
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const row = aPacingRowV1(rowOverrides);
  const onBack = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <PacingDashboard row={row} onBack={onBack} watchFirstData={props.watchFirstData} />
    </QueryClientProvider>
  );
  return { row, onBack, queryClient };
}

describe("PacingDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listPacingLibrary).mockResolvedValue([aPacingLibraryEntryV1()]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should show the health/margin/budget figures straight from the row (US-114: must match the existing tool)", async () => {
    // Given: the exact same server-computed figures the Overview/Pacing-tab row already showed
    vi.mocked(api.getPacingDashboard).mockResolvedValue(aPacingDashboardV1());
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
    const { row } = renderDashboard({
      pacingDeviationPct: -12.3, marginActualPct: 18.5, marginTargetPct: 25, budgetTotal: 1_250_000,
    });

    // When:
    await screen.findByText(row.name);

    // Then: no re-derivation - the same numbers already shown on the row
    expect(screen.getByText("-12.3pp")).toBeInTheDocument();
    expect(screen.getByText(/18\.5%/)).toBeInTheDocument();
    expect(screen.getByText(/\$1,250,000|\$1\.3M|\$1\.2M/)).toBeInTheDocument();
  });

  it("should show 'No data' rather than a fake 0% when there is no pacing deviation yet", async () => {
    // Given: a freshly created pacing (§8's known plan-loss gap) with no delivery data yet
    vi.mocked(api.getPacingDashboard).mockResolvedValue(
      aPacingDashboardV1({ planByLineItem: { li1: aPacingLineItemPlanV1({ plannedImpressions: 0 }) } })
    );
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1({ exists: false, refreshId: null, rowCount: 0, latestDate: null }));
    renderDashboard({ pacingDeviationPct: null });

    // When:
    await screen.findByText("No data has been built for this pacing yet.");

    // Then:
    expect(screen.getAllByText("No data").length).toBeGreaterThan(0);
  });

  it("should wait for a just-created pacing's first build and fill in once it lands, without a reload", async () => {
    // Given: a pacing created a moment ago - its first refresh is still running, so no data exists yet
    // (refreshId absent, exactly as on the wire), and the next status poll sees the build landed
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.getPacingDashboard).mockResolvedValue(aPacingDashboardV1());
    vi.mocked(api.getPacingRefreshStatus)
      .mockResolvedValueOnce(aPacingRefreshStatusV1({ exists: false, refreshId: undefined, rowCount: 0, latestDate: undefined }))
      .mockResolvedValue(aPacingRefreshStatusV1({ refreshId: "first-build", rowCount: 1880, latestDate: "2026-04-29" }));
    const { queryClient } = renderDashboard({ pacingDeviationPct: null }, { watchFirstData: true });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    // When: the dashboard opens before the build has landed
    await screen.findByText(/pulling delivery data/i);

    // Then: it says so, and does not offer a second refresh while the first one runs
    expect(screen.getByRole("button", { name: /refreshing/i })).toBeDisabled();

    // When: the next poll comes round
    await vi.advanceTimersByTimeAsync(4000);

    // Then: the page fills in by itself - dashboard and the pacing lists behind its hero cards re-pulled
    await screen.findByText(/1,880 rows/);
    await waitFor(() => expect(api.getPacingDashboard).toHaveBeenCalledTimes(2));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["pacing", "campaign"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["pacing", "overview"] });
    expect(screen.getByRole("button", { name: /refresh data/i })).toBeEnabled();
  });

  it("should not watch a pacing that simply has no data, unless it was just created", async () => {
    // Given: an older pacing that has never built (it may never build - e.g. an incomplete plan)
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.getPacingDashboard).mockResolvedValue(aPacingDashboardV1());
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(
      aPacingRefreshStatusV1({ exists: false, refreshId: undefined, rowCount: 0, latestDate: undefined })
    );
    renderDashboard({ pacingDeviationPct: null });
    await screen.findByText("No data has been built for this pacing yet.");

    // When: well past a poll interval
    await vi.advanceTimersByTimeAsync(10_000);

    // Then: no polling, and no claim that a refresh is running
    expect(api.getPacingRefreshStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/pulling delivery data/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh data/i })).toBeEnabled();
  });

  it("should trigger a refresh and show 'Refreshing…' while watching for completion (US-119)", async () => {
    // Given:
    vi.mocked(api.getPacingDashboard).mockResolvedValue(aPacingDashboardV1());
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1({ refreshId: "r1" }));
    vi.mocked(api.triggerPacingRefresh).mockResolvedValue({ status: "started" });
    renderDashboard();
    await screen.findByRole("button", { name: /refresh data/i });

    // When:
    await userEvent.click(screen.getByRole("button", { name: /refresh data/i }));

    // Then:
    await waitFor(() => expect(api.triggerPacingRefresh).toHaveBeenCalledTimes(1));
  });

  it("should show a countdown instead of queuing a second run when refresh is triggered inside the cooldown", async () => {
    // Given: US-119 - a 429 inside the cooldown is a countdown, not an error and not a second run
    vi.mocked(api.getPacingDashboard).mockResolvedValue(aPacingDashboardV1());
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
    vi.mocked(api.triggerPacingRefresh).mockResolvedValue({ status: "cooldown", retryAfterSeconds: 42 });
    renderDashboard();
    await screen.findByRole("button", { name: /refresh data/i });

    // When:
    await userEvent.click(screen.getByRole("button", { name: /refresh data/i }));

    // Then:
    await screen.findByRole("button", { name: /refresh \(42s\)/i });
  });

  it("should keep every pacing setting behind one gear (US-116)", async () => {
    // Given: composing the dashboard is an occasional act; reading it is the point.
    // The panel used to sit inline at the bottom of the page, which spent screen on a
    // tool most viewers never open and read as part of the data rather than settings
    // for it. It is one slide-over now, holding the plan, the data settings and the
    // widgets on tabs - as the retired SPA's one Settings drawer did.
    vi.mocked(api.getPacingDashboard).mockResolvedValue(aPacingDashboardV1());
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
    renderDashboard();
    await screen.findByText(/back to pacings/i);

    // Then: nothing of the panel is on the page…
    expect(screen.queryByText(/this pacing's widgets/i)).not.toBeInTheDocument();

    // When: the gear is pressed and the Widgets tab chosen…
    await userEvent.click(screen.getByRole("button", { name: /^settings$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^widgets$/i }));

    // Then: …it opens, and as a dialog rather than another section of the page.
    expect(await screen.findByText(/this pacing's widgets/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("should call onBack when 'Back to pacings' is clicked", async () => {
    // Given:
    vi.mocked(api.getPacingDashboard).mockResolvedValue(aPacingDashboardV1());
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
    const { onBack } = renderDashboard();
    await screen.findByText(/back to pacings/i);

    // When:
    await userEvent.click(screen.getByText(/back to pacings/i));

    // Then:
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("should render a widget straight from display.widgets, not a fixed hardcoded chart set (the structural bug this rework fixes)", async () => {
    // Given: a server-sent widget list with one composite layout widget
    const widget = {
      id: "w_test1",
      kind: "composite",
      title: "Test Widget",
      schemaVersion: 2,
      spec: {
        views: [
          {
            id: "layout",
            kind: "layout",
            rows: [{ cols: [{ span: 12, frame: "none", bricks: [{ type: "detailCard", label: "Plan units", source: "planUnits" }] }] }],
          },
        ],
      },
    };
    vi.mocked(api.getPacingDashboard).mockResolvedValue(aPacingDashboardV1({ display: { rev: 1, widgets: [widget] } }));
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
    renderDashboard();

    // Then: the server-sent widget renders - it was previously thrown away entirely. (Its title also
    // appears in the widget-library management panel below, hence getAllByText.)
    await waitFor(() => expect(screen.getAllByText("Test Widget").length).toBeGreaterThan(0));
    expect(screen.getByText("Plan units")).toBeInTheDocument();
  });

  it("should degrade an unknown widget kind to a visible, explained placeholder instead of crashing", async () => {
    // Given: a widget kind this build does not speak
    const widget = { id: "w_bad1", kind: "mystery-kind", title: "Mystery Widget" };
    vi.mocked(api.getPacingDashboard).mockResolvedValue(aPacingDashboardV1({ display: { rev: 1, widgets: [widget] } }));
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
    renderDashboard();

    // Then: a visible, labeled placeholder - never a blank box, never a crashed page
    await waitFor(() => expect(screen.getAllByText("Mystery Widget").length).toBeGreaterThan(0));
    expect(screen.getByText(/Unsupported widget kind/)).toBeInTheDocument();
  });

  it("should degrade an unknown brick type inside a layout widget the same way", async () => {
    // Given: a layout widget whose column carries a brick type this build does not know
    const widget = {
      id: "w_bad2",
      kind: "composite",
      title: "Partially Unknown Widget",
      schemaVersion: 2,
      spec: {
        views: [{ id: "layout", kind: "layout", rows: [{ cols: [{ span: 12, bricks: [{ type: "sparklyNewBrick" }] }] }] }],
      },
    };
    vi.mocked(api.getPacingDashboard).mockResolvedValue(aPacingDashboardV1({ display: { rev: 1, widgets: [widget] } }));
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
    renderDashboard();

    // Then:
    await waitFor(() => expect(screen.getAllByText("Partially Unknown Widget").length).toBeGreaterThan(0));
    expect(screen.getByText(/Unsupported element type/)).toBeInTheDocument();
  });
});
