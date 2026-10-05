import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aPacingDashboardV1,
  aPacingLibraryEntryV1,
  aPacingLineItemPlanV1,
  aPacingRefreshStatusV1,
  aPacingRowV1,
} from "@/test/factories";
import * as api from "./api";
import { ToastProvider } from "../../shared/ui/toast/toast";
import { PacingDashboard } from "./pacing-dashboard";
// Moved JS from Pacing's SPA - the Standard catalog, read here so the fixture is Pacing's own
// definition rather than a hand-made spec that could drift from the grammar it is meant to exercise.
import { stdEntry } from "./spa/std-catalog.js";

vi.mock("./api", () => ({
  getPacingDashboard: vi.fn(),
  savePacingCampaignLinks: vi.fn(),
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
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        {/* ToastProvider: the header's Documents chips (§16) confirm an IO copy with a toast. */}
        <ToastProvider>
          <PacingDashboard row={row} onBack={onBack} watchFirstData={props.watchFirstData} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
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

  // The two tests that stood here - "Pace/Margin straight from the row while loading" and "'No data'
  // rather than a fake 0%" - went with the KPI strip they were about (owner decision, 2026-10-01).
  // Both asserted figures that this page no longer prints: the hero widget carries them now, from
  // the facts, and the strip's disagreement with it is what got the strip removed. The empty-state
  // line one of them also touched is still asserted by the first-build test below.

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

  it("should degrade an unknown widget kind to a named, visible tile instead of crashing", async () => {
    // Given: a widget kind this build does not speak
    const widget = { id: "w_bad1", kind: "mystery-kind", title: "Mystery Widget" };
    vi.mocked(api.getPacingDashboard).mockResolvedValue(aPacingDashboardV1({ display: { rev: 1, widgets: [widget] } }));
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
    renderDashboard();

    // Then: the tile is drawn and named, and says why it has nothing to show. The words are
    // Pacing's own renderer's now, not the hand-written engine this replaced - which is the point:
    // a pacing brought over from Pacing degrades exactly the way it does there.
    await waitFor(() => expect(screen.getAllByText("Mystery Widget").length).toBeGreaterThan(0));
    expect(screen.getByText(/None of these metrics apply to this pacing/i)).toBeInTheDocument();
  });

  it("should drop an unknown element inside a layout widget without taking the tile down", async () => {
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

    // Then: the tile survives, named, with the unknown element simply absent.
    //
    // WEAKER THAN WHAT THIS REPLACED, on purpose: the Hub's own engine printed "Unsupported element
    // type" in the element's place. Pacing's renderer drops it silently. Keeping our louder
    // behaviour would have meant editing a moved file to disagree with the app it came from, and an
    // unknown element type only arises from a build older than the widget that uses it - the case
    // the version lockout in the grammar already covers at the widget level.
    await waitFor(() => expect(screen.getAllByText("Partially Unknown Widget").length).toBeGreaterThan(0));
    const tile = document.querySelector(".dash-grid");
    expect(tile?.textContent).toContain("Partially Unknown Widget");
    expect(tile?.textContent).not.toMatch(/sparklyNewBrick/);
  });

  it("should draw a TABLE widget on the page — the kind the previous engine could not", async () => {
    // Given: Pacing's own Standard "Daily Performance" definition, which is a `table` view. The
    // engine this replaced dispatched on three view kinds and answered `table` with a placeholder,
    // so three of the 32 Standard templates — and most widgets anyone builds in Pacing's builder —
    // drew nothing. This is the end-to-end proof that the moved renderer is wired to the page: the
    // payload, the state seam, the grammar and the renderer all in one path.
    const daily = stdEntry("std:v2:daily") as { definition: Record<string, unknown> };
    expect(daily).toBeTruthy();
    // A table with no delivery draws its own "no data in this period" state, which would pass a
    // weaker assertion while proving nothing — so this gives it two days to put in rows.
    const plan = aPacingLineItemPlanV1();
    vi.mocked(api.getPacingDashboard).mockResolvedValue(
      aPacingDashboardV1({
        planByLineItem: { [plan.lineItemId]: plan },
        factsDaily: [
          { date: "2026-08-01", line_item_id: plan.lineItemId, impressions: 1000, clicks: 10, spend: 50 },
          { date: "2026-08-02", line_item_id: plan.lineItemId, impressions: 2000, clicks: 30, spend: 90 },
        ] as never,
        display: { rev: 1, widgets: [{ id: "w_daily01", ...structuredClone(daily.definition) }] },
      })
    );
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
    renderDashboard();

    // Then: a real table inside the widget board, with a header row.
    const board = await waitFor(() => {
      const el = document.querySelector(".dash-grid table");
      expect(el).toBeTruthy();
      return el as HTMLTableElement;
    });
    expect(board.querySelectorAll("th").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Unsupported view kind/i);
  });

  it("should label a channel row from `types`, not fall back to Unknown", async () => {
    // `types` is one of the four fields the Hub's contract dropped until 2026-10-01. Pacing sends it
    // and `normalize()` reads it; without it every line item's channel resolves to "Unknown", so a
    // channel-grained row collapses into one bucket and a channel filter matches nothing. Asserted
    // through what a reader SEES, because the field arriving and the field being used are two
    // different claims.
    const plan = aPacingLineItemPlanV1();
    const daily = stdEntry("std:v2:daily") as { definition: Record<string, unknown> };
    vi.mocked(api.getPacingDashboard).mockResolvedValue(
      aPacingDashboardV1({
        planByLineItem: { [plan.lineItemId]: { ...plan, channel: undefined } as never },
        types: [{ line_item_id: plan.lineItemId, type: "Connected TV" }] as never,
        factsDaily: [
          { date: "2026-08-01", line_item_id: plan.lineItemId, impressions: 1000, clicks: 10, spend: 50 },
        ] as never,
        display: { rev: 1, widgets: [{ id: "w_daily02", ...structuredClone(daily.definition) }] },
      })
    );
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
    renderDashboard();

    await waitFor(() => expect(document.querySelector(".dash-grid table")).toBeTruthy());
    // The plan carries no channel of its own, so "Connected TV" can only have come from `types`.
    expect(document.body.textContent).toContain("Connected TV");
    expect(document.querySelector(".dash-grid")?.textContent).not.toContain("Unknown");
  });

  it("should place tiles on the 12-column grid, not stack them", async () => {
    // The board used to render a flat stack, which threw away every tile's stored geometry: the
    // column it sits in, how many it spans, and its height band. That is what made the page come out
    // as a column of same-width tiles. This asserts the grid is really driving the placement.
    const brick = (label: string) => ({
      kind: "composite", schemaVersion: 2, profile: "chart",
      spec: { views: [{ id: "l", kind: "layout", rows: [{ cols: [{ span: 12, bricks: [{ type: "detailCard", label, source: "planUnits" }] }] }] }] },
    });
    vi.mocked(api.getPacingDashboard).mockResolvedValue(
      aPacingDashboardV1({
        display: {
          rev: 1,
          widgets: [
            { id: "w_aaa111", title: "Left", ...brick("Left brick") },
            { id: "w_bbb222", title: "Right", ...brick("Right brick") },
          ],
          layout: { version: 1, tiles: { w_aaa111: { x: 0, y: 0, w: 6, h: "M" }, w_bbb222: { x: 6, y: 0, w: 6, h: "M" } } },
        },
      })
    );
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
    renderDashboard();

    const grid = await waitFor(() => {
      const el = document.querySelector(".dash-grid");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    // Two tiles side by side, six columns each - not two full-width rows. `chart` rather than
    // `card`, because the grid CLAMPS per kind and a card maxes out at four columns: the fixture has
    // to ask for a width its kind can actually hold, or this asserts the clamp instead of the grid.
    const left = grid.querySelector<HTMLElement>('[data-tile-id="w_aaa111"]');
    const right = grid.querySelector<HTMLElement>('[data-tile-id="w_bbb222"]');
    expect(left?.style.gridColumn).toBe("1 / span 6");
    expect(right?.style.gridColumn).toBe("7 / span 6");
    // Row 2, not row 1: the Line Items block is a tile of this board now (2026-10-05) and it is a
    // `flow` kind — always full width, and anchored on the slot scale ahead of a widget the saved
    // layout places but the catalogue gives no slot. Both charts still SHARE their row, which is
    // what this case is about; which row that is belongs to the case below.
    expect(left?.style.gridRow).toBe("2");
    expect(right?.style.gridRow).toBe("2");
  });

  it("should place the Line Items block as a full-width tile of the board", async () => {
    // It used to be a fixed section BELOW the whole grid, which put a line item's own figures
    // under the charts that roll up from them. As a tile it carries Pacing's own slot for it
    // (600: hero 200 · Finance 300 · lineItems 600 · charts 700+), so on a pacing with the
    // Standard widgets it lands between the summary cards and the charts.
    const brick = (label: string) => ({
      kind: "composite", schemaVersion: 2, profile: "chart",
      spec: { views: [{ id: "l", kind: "layout", rows: [{ cols: [{ span: 12, bricks: [{ type: "detailCard", label, source: "planUnits" }] }] }] }] },
    });
    vi.mocked(api.getPacingDashboard).mockResolvedValue(
      aPacingDashboardV1({
        display: {
          rev: 1,
          widgets: [
            { id: "w_aaa111", title: "Left", ...brick("Left brick") },
            { id: "w_bbb222", title: "Right", ...brick("Right brick") },
          ],
          layout: { version: 1, tiles: { w_aaa111: { x: 0, y: 0, w: 6, h: "M" }, w_bbb222: { x: 6, y: 0, w: 6, h: "M" } } },
        },
      })
    );
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
    renderDashboard();

    const grid = await waitFor(() => {
      const el = document.querySelector(".dash-grid");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    const block = grid.querySelector<HTMLElement>('[data-tile-id="lineItems"]');
    expect(block, "the Line Items block is a tile of the grid").toBeTruthy();
    expect(block?.style.gridColumn).toBe("1 / span 12");
    // …and nowhere else on the page: a second copy under the charts is the shape this replaced.
    expect(document.querySelectorAll('[data-tile-id="lineItems"]')).toHaveLength(1);
  });

  it("should offer Edit, Duplicate, Turn off and Delete on a tile itself", async () => {
    // The same four Pacing puts on a tile. They were only in the settings drawer before, which meant
    // switching one widget off was four clicks away from the widget.
    const daily = stdEntry("std:v2:daily") as { definition: Record<string, unknown> };
    const plan = aPacingLineItemPlanV1();
    vi.mocked(api.getPacingDashboard).mockResolvedValue(
      aPacingDashboardV1({
        planByLineItem: { [plan.lineItemId]: plan },
        factsDaily: [{ date: "2026-08-01", line_item_id: plan.lineItemId, impressions: 1000, clicks: 10, spend: 50 }] as never,
        display: { rev: 1, widgets: [{ id: "w_daily01", ...structuredClone(daily.definition) }] },
      })
    );
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
    vi.mocked(api.savePacingDisplay).mockResolvedValue({ status: "saved", display: {} });
    renderDashboard();

    await userEvent.click(await screen.findByRole("button", { name: /widget actions/i }));
    for (const label of [/edit/i, /duplicate/i, /turn off/i, /delete/i]) {
      expect(await screen.findByRole("menuitem", { name: label })).toBeInTheDocument();
    }

    // Turning off from here SAVES at once - this surface has no draft to fold into.
    await userEvent.click(screen.getByRole("menuitem", { name: /turn off/i }));
    await waitFor(() => expect(api.savePacingDisplay).toHaveBeenCalled());
    const [, sentDisplay] = vi.mocked(api.savePacingDisplay).mock.calls.at(-1)!;
    expect((sentDisplay as { enabled: Record<string, boolean> }).enabled).toEqual({ w_daily01: false });
  });

  it("should not draw a switched-off widget, while keeping it on the pacing", async () => {
    // Given: two widgets, one of them switched off in `display.enabled`
    const brick = (label: string) => ({
      kind: "composite",
      schemaVersion: 2,
      spec: {
        views: [
          {
            id: "layout",
            kind: "layout",
            rows: [{ cols: [{ span: 12, frame: "none", bricks: [{ type: "detailCard", label, source: "planUnits" }] }] }],
          },
        ],
      },
    });
    vi.mocked(api.getPacingDashboard).mockResolvedValue(
      aPacingDashboardV1({
        display: {
          rev: 1,
          widgets: [
            { id: "w_shown1", title: "Shown widget", ...brick("Shown brick") },
            { id: "w_hidden", title: "Hidden widget", ...brick("Hidden brick") },
          ],
          enabled: { w_hidden: false },
        },
      })
    );
    vi.mocked(api.getPacingRefreshStatus).mockResolvedValue(aPacingRefreshStatusV1());
    renderDashboard();

    // Then: only the switched-on one is drawn - tile and contents both.
    // (That the hidden one is still ON the pacing, listed in the management panel and waiting to be
    // switched back on, is the library panel's own test: that panel lives behind the settings
    // drawer, which is closed here.)
    await waitFor(() => expect(screen.getByText("Shown brick")).toBeInTheDocument());
    expect(screen.queryByText("Hidden brick")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden widget")).not.toBeInTheDocument();
  });
});
