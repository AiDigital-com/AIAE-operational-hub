/**
 * Pacing's widget builder, mounted here.
 *
 * Same job as `renderer-loads.test.tsx` did for the renderer: 69 more files and ~18 000 lines were
 * moved in, their import paths rewritten across four directories, and four more hooks added to the
 * state seam. Every one of those is a wiring detail that fails as `undefined` at the first call
 * rather than at import, so this mounts the real thing and edits a real widget.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error - moved JS from Pacing's SPA (see SOURCE.md)
import WidgetBuilder from "./builder/ReportBuilder.jsx";
// @ts-expect-error - moved JS
import { PacingStateProvider, setPacingApi } from "./store.js";
// @ts-expect-error - moved JS
import { stdEntry } from "./std-catalog.js";
// @ts-expect-error - moved JS
import { buildFactsAggregates } from "./normalize.js";

const FACTS = [
  { date: "2026-03-01", line_item_id: "700001", impressions: 1000, clicks: 10, spend: 50 },
  { date: "2026-03-02", line_item_id: "700001", impressions: 2000, clicks: 30, spend: 90 },
];
const LI_PLAN = {
  700001: {
    id: "700001", ch: "Display", dsp: null, rateType: "CPM", budget: 1000, planImpr: 100000,
    mTgt: 20, ctrTgt: 1, vcrTgt: 0, fs: "2026-03-01", fe: "2026-03-31", containers: [],
  },
};
const AGG = buildFactsAggregates(FACTS, 1, LI_PLAN);

const STATE = {
  campaign: { id: "c1", name: "P", currency: "USD", rate: 1, startDate: "2026-03-01", endDate: "2026-03-31" },
  facts: { factsDaily: FACTS, liDaily: AGG.LD, liSplitDaily: AGG.LSD, asOf: AGG.asOf, rate: 1, cvCtx: null },
  liPlan: LI_PLAN,
  types: [], creatives: null, conversions: null, conversionTags: null,
  availableSplits: {}, availableMetrics: { delivery: ["im", "cl", "sp"] },
  dataConfig: { source: "platform_mart" }, dimSources: null, mappingsV3: null,
  thirdParty: null, notify: null, display: {}, journalHighlight: null,
  dimensionHandoff: null, selectedPeriodKey: null, splitScopedMode: false, splitScopedPlans: null,
  urlFilters: {
    filters: { range: "all", customRange: null, channels: [], labels: [], platforms: [], selection: [], brk: "", brkf: [], cols: null },
    setFilters: () => {},
  },
  actions: { saveSettings: async () => {} },
};

function mountBuilder(widget: unknown, onPatch = vi.fn()) {
  setPacingApi({ thirdPartyData: async () => null, thirdPartyStatus: async () => null });
  render(
    <PacingStateProvider value={STATE}>
      <WidgetBuilder widget={widget} onPatch={onPatch} onBack={() => {}} />
    </PacingStateProvider>
  );
  return onPatch;
}

describe("Pacing's widget builder, over the moved layer", () => {
  it("opens on a real Standard widget and shows its own title", async () => {
    // Pacing's own definition rather than a hand-made spec: the builder reads the grammar, and a
    // fixture written here could be one the grammar would refuse.
    const daily = stdEntry("std:v2:daily") as { definition: { title?: string } };
    expect(daily).toBeTruthy();
    mountBuilder({ id: "w_edit001", ...structuredClone(daily.definition) });

    // The builder's own controls, not just a mounted shell: the layout picker, the two scope chips
    // and the authoring affordances all have to be there for it to be usable at all.
    expect(await screen.findByPlaceholderText(/widget title/i)).toBeInTheDocument();
    for (const label of [/full row/i, /compact/i, /\+ add control/i, /\+ add source/i, /undo/i, /preview/i]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // And it opened ON this widget, rather than on an empty newborn.
    expect(document.body.textContent).toContain(daily.definition.title ?? "Daily Performance");
  });

  it("reports an edit back through onPatch rather than writing anything itself", async () => {
    // The builder owns no persistence: it hands the next widget up, and the drawer decides when
    // that becomes a save. This is the contract the Hub's drawer will be wired to.
    const kpi = stdEntry("std:v2:kpi:margin") as { definition: Record<string, unknown> };
    const onPatch = mountBuilder({ id: "w_edit002", ...structuredClone(kpi.definition) });

    // `input[type=text]` would miss it: the element carries no `type` ATTRIBUTE, and the DOM
    // property defaulting to "text" is not what a CSS attribute selector matches.
    const title = await screen.findByPlaceholderText(/widget title/i);
    // `fireEvent.change`, not `userEvent.type`: the builder writes on every change synchronously,
    // and typing races its mount effects - the first keystroke can land while the tile's data hook
    // is still settling, which made this assertion flaky rather than wrong.
    fireEvent.change(title, { target: { value: "Edited" } });

    await waitFor(() => expect(onPatch).toHaveBeenCalled());
  });
});
