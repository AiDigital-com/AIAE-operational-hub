/**
 * The Breakdown is a Standard widget now (the reference's sections cutover, 2026-09-07), drawn by
 * Pacing's own renderer rather than by a section of the Hub's page.
 *
 * The case it pins is the one that section got wrong (WinSenate Alaska, 2026-10-13): a dimension
 * that tags only PART of the delivery. Its «Others» row is the untagged remainder, and it must carry
 * every column - clicks and spend included - with Totals reading the whole line, not the sum of the
 * tagged rows. The retired section printed dashes beyond impressions and a Total of 0 clicks.
 */
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
// @ts-expect-error - moved JS from Pacing's SPA, deliberately untyped (see SOURCE.md)
import ReportWidget from "./report/ReportWidget.jsx";
// @ts-expect-error - moved JS
import { PacingStateProvider, setPacingApi } from "./store.js";
// @ts-expect-error - moved JS
import { stdEntry } from "./std-catalog.js";
// @ts-expect-error - moved JS
import { buildFactsAggregates } from "./normalize.js";

/** One line item; one day tagged with a language, two days with none. */
const FACTS_DAILY = [
  { date: "2026-03-01", line_item_id: "700001", impressions: 100, clicks: 0, spend: 5, language: "-additional" },
  { date: "2026-03-02", line_item_id: "700001", impressions: 400, clicks: 1, spend: 20 },
  { date: "2026-03-03", line_item_id: "700001", impressions: 500, clicks: 2, spend: 25 },
];
const LI_PLAN = {
  700001: {
    id: "700001", ch: "CTV", dsp: "DV360", rateType: "CPM",
    budget: 1000, planImpr: 100000, mTgt: 20, ctrTgt: 1, vcrTgt: 0,
    fs: "2026-03-01", fe: "2026-03-31", containers: [],
  },
};

function state() {
  const { LD, LSD, asOf } = buildFactsAggregates(FACTS_DAILY, 1, LI_PLAN);
  return {
    campaign: { id: "c1", name: "Probe", currency: "USD", rate: 1, startDate: "2026-03-01", endDate: "2026-03-31" },
    facts: { factsDaily: FACTS_DAILY, liDaily: LD, liSplitDaily: LSD, asOf, rate: 1, cvCtx: null },
    types: [],
    liPlan: LI_PLAN,
    creatives: null,
    conversions: null,
    conversionTags: null,
    availableSplits: ["language"],
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
    urlFilters: {
      filters: {
        range: "all", customRange: null, channels: [], labels: [], platforms: [],
        selection: [], brk: "", brkf: [], cols: null,
      },
      setFilters: () => {},
    },
    actions: { saveSettings: async () => {} },
  };
}

/** The cells of the table row whose first cell starts with `label`, joined by " | ". */
function rowText(label: string): string {
  const rows = Array.from(document.querySelectorAll("tr"));
  const row = rows.find((tr) => (tr.querySelector("td,th")?.textContent ?? "").trim().startsWith(label));
  if (!row) return "";
  return Array.from(row.querySelectorAll("td,th")).map((c) => (c.textContent ?? "").trim()).join(" | ");
}

describe("the Breakdown widget", () => {
  it("fills every column of «Others», and Totals reads the whole line", async () => {
    setPacingApi({ thirdPartyData: async () => null, thirdPartyStatus: async () => null });
    const breakdown = stdEntry("std:v2:breakdown");
    render(
      <PacingStateProvider value={state()}>
        <ReportWidget widget={{ id: "w_breakdown", ...structuredClone(breakdown.definition) }} />
      </PacingStateProvider>
    );

    await waitFor(() => expect(rowText("Others")).not.toBe(""));
    // The untagged two days: 900 impressions, 3 clicks, $45 - not dashes.
    expect(rowText("Others")).toMatch(/\| 900 \| 3 \| .* \| \$45\.00 \|/);
    // The whole line: 1,000 impressions, 3 clicks, $50.
    expect(rowText("Total")).toMatch(/\| 1,000 \| 3 \| .* \| \$50\.00 \|/);
  });
});
