/**
 * Pacing's real widget renderer, mounted here.
 *
 * The case it proves is the one the Hub's own hand-written renderer cannot do: a widget whose view
 * is a TABLE. the Hub's own `widget-engine.tsx` (deleted 2026-10-01) dispatched on three view kinds — layout, chart, kpi — and
 * answers everything else with "Unsupported view kind", so three of the 32 Standard templates
 * (`std:v2:daily`, `std:v2:breakdown`, `std:v2:third-party`) draw a placeholder today, and so does
 * any table a person built in Pacing's builder. This mounts `ReportWidget` over the moved layer and
 * asserts the table is really drawn.
 *
 * It is also the end-to-end check on everything moved so far: the `@shared/*` alias, the CommonJS
 * interop over the vendored UMD modules, the import-path rewrite across 113 files, and the store
 * seam. Any one of those failing shows up here rather than on a page nobody has opened yet.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
// @ts-expect-error - moved JS from Pacing's SPA, deliberately untyped (see SOURCE.md)
import ReportWidget from "./report/ReportWidget.jsx";
// @ts-expect-error - moved JS
import { PacingStateProvider, setPacingApi } from "./store.js";
// @ts-expect-error - moved JS
import { stdEntry } from "./std-catalog.js";
// @ts-expect-error - moved JS
import { buildFactsAggregates } from "./normalize.js";

/**
 * One line item and two days of delivery — the smallest payload a table can actually draw rows
 * from. The aggregates are built by the moved `normalize.js`, not hand-written: a fixture in the
 * store's internal shape, typed out here, would pass even if the renderer and the normalizer
 * disagreed about it.
 */
const FACTS_DAILY = [
  { date: "2026-03-01", line_item_id: "700001", impressions: 1000, clicks: 10, spend: 50 },
  { date: "2026-03-02", line_item_id: "700001", impressions: 2000, clicks: 30, spend: 90 },
];
const LI_PLAN = {
  700001: {
    id: "700001", ch: "Display", dsp: "DV360", rateType: "CPM",
    budget: 1000, planImpr: 100000, mTgt: 20, ctrTgt: 1, vcrTgt: 0,
    fs: "2026-03-01", fe: "2026-03-31", containers: [],
  },
};

/** The payload shape the seam reads, filled only where this widget looks. */
const STATE = {
  campaign: { id: "c1", name: "Probe", currency: "USD", rate: 1, startDate: "2026-03-01", endDate: "2026-03-31" },
  // `buildFactsAggregates` answers `{LD, LSD, asOf}`; the store holds them as
  // `liDaily`/`liSplitDaily`, and `useWidgetData` refuses to produce anything without `liDaily`.
  facts: (() => {
    const { LD, LSD, asOf } = buildFactsAggregates(FACTS_DAILY, 1, LI_PLAN);
    return { factsDaily: FACTS_DAILY, liDaily: LD, liSplitDaily: LSD, asOf, rate: 1, cvCtx: null };
  })(),
  types: [],
  liPlan: LI_PLAN,
  creatives: null,
  conversions: null,
  conversionTags: null,
  availableSplits: [],
  availableMetrics: { delivery: ["im", "cl", "sp"] },
  dataConfig: { source: "platform_mart" },
  dimSources: null,
  mappingsV3: null,
  thirdParty: null,
  notify: null,
  display: {},
  journalHighlight: null,
  dimensionHandoff: null,
  selectedPeriodKey: null,
  splitScopedMode: false,
  splitScopedPlans: null,
  effLIs: [],
  // The SPA's `useUrlFilters` default — every key, because the renderer reads them positionally
  // (`filters.range.replace(...)` the moment one is absent).
  urlFilters: {
    filters: {
      range: "all", customRange: null, channels: [], labels: [], platforms: [],
      selection: [], brk: "", brkf: [], cols: null,
    },
    setFilters: () => {},
  },
  actions: { saveSettings: async () => {} },
};

function mount(widget: unknown) {
  setPacingApi({ thirdPartyData: async () => null, thirdPartyStatus: async () => null });
  return render(
    <PacingStateProvider value={STATE}>
      <ReportWidget widget={widget} />
    </PacingStateProvider>
  );
}

describe("Pacing's own renderer, over the moved layer", () => {
  it("draws a TABLE widget — the view kind the Hub's own engine answers with a placeholder", async () => {
    // Pacing's own Standard definition, not a hand-made spec: if the catalog and the renderer
    // disagreed about the grammar, a fixture written here would hide it.
    const daily = stdEntry("std:v2:daily");
    expect(daily).toBeTruthy();

    mount({ id: "w_table01", ...structuredClone(daily.definition) });

    // The placeholder the Hub's engine would have produced must NOT be what came out.
    expect(screen.queryByText(/Unsupported view kind/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Unsupported widget kind/i)).not.toBeInTheDocument();
    // And a table is a table: a real <table> element, with a header row.
    // And a table is a table: a real <table>, a header row, and the figures it was given.
    // The tile fills in after mount (its data hook settles in an effect), so this waits rather
    // than reading the first paint — which is empty by design, not by failure.
    const table = await waitFor(() => {
      const t = document.querySelector("table");
      expect(t).toBeTruthy();
      return t!;
    });
    expect(table.querySelectorAll("th").length).toBeGreaterThan(0);
    expect(table.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    // 1000 + 2000 impressions across the two days actually reached the cells.
    expect(document.body.textContent).toMatch(/3,000|3 000|3000/);
  });

  it("draws a KPI widget too, so the port did not trade one view kind for another", async () => {
    const margin = stdEntry("std:v2:kpi:margin");
    expect(margin).toBeTruthy();
    mount({ id: "w_kpi0001", ...structuredClone(margin.definition) });
    // Asserting on real output, not on the absence of an error string: an empty div would pass
    // "no Unsupported text" perfectly well.
    await waitFor(() => expect(document.body.textContent?.trim().length ?? 0).toBeGreaterThan(0));
    expect(screen.queryByText(/Unsupported/i)).not.toBeInTheDocument();
  });
});
