/**
 * Coefficient margin mode has to survive the seam into the moved renderer.
 *
 * There are TWO engines on the dashboard page and they are fed separately: `build-metrics.ts`
 * assembles the vendored engine's input through `toEngineRaw`, and `usePacingState` assembles the
 * moved renderer's. Pacing's `normalize()` reads a line item's coefficient flag as `cost_coef` —
 * snake, because on Pacing's own side it comes straight off `config_json` — while the Hub's
 * contract publishes it as `costCoef`. `toEngineRaw` renames it; this seam did not, so a
 * coefficient line item drew its WIDGETS off BigQuery's `dynamic_cost` while the pacing list and
 * Overview — which resolve the coefficient server-side in `health.mjs` — drew the same pacing's
 * margin off `spend / (1 - margin)`. Two numbers for one figure on one screen, found on a live
 * pacing on 2026-10-08.
 *
 * Nothing else catches this: a missing key does not throw, the line simply reads as "not on
 * coefficient cost", and the vendored engine's own crown suite passes because it is fed through the
 * OTHER bridge. So this asserts the delivered figure, not just the flag — `dc` must be the
 * margin-derived client cost, with the fixture's `dynamic_cost` deliberately unrelated to `spend`
 * so a regression cannot pass by coincidence.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
// @ts-expect-error - moved JS from Pacing's SPA, deliberately untyped (see SOURCE.md)
import { usePacingState } from "./store.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const DATE = "2026-08-01";
const SPEND = 270;
/** Unrelated to SPEND on purpose: the coefficient path must ignore it entirely. */
const GARBAGE_DC = 9999;
const MARGIN = 73;

/** One coefficient line item (200) and one ordinary one (100), in the Hub's camelCase contract. */
function payload(costCoef: boolean) {
  const plan = (id: string, coef: boolean) => ({
    lineItemId: id,
    channel: "Meta",
    rateType: "CPM",
    clientBudget: 12000,
    plannedImpressions: 1_000_000,
    marginTargetPct: MARGIN,
    flightStart: DATE,
    flightEnd: "2026-08-31",
    containers: [],
    costCoef: coef,
  });
  return {
    campaign: { startDate: DATE, endDate: "2026-08-31", rate: 1 },
    planByLineItem: { "100": plan("100", false), "200": plan("200", costCoef) },
    factsDaily: [
      { line_item_id: "100", date: DATE, impressions: 10_000, clicks: 10, spend: SPEND, completes: 0, dynamic_cost: GARBAGE_DC },
      { line_item_id: "200", date: DATE, impressions: 10_000, clicks: 10, spend: SPEND, completes: 0, dynamic_cost: GARBAGE_DC },
    ],
  };
}

function stateOf(data: unknown) {
  const { result } = renderHook(() =>
    (usePacingState as Any)({ data, urlFilters: { filters: {}, setFilters: () => {} }, actions: {}, journalHighlight: null })
  );
  return result.current as Any;
}

describe("coefficient margin mode reaches the moved renderer", () => {
  it("carries costCoef across the camelCase seam into the engine's plan", () => {
    const state = stateOf(payload(true));
    expect(state.liPlan["200"].coef).toBe(true);
    expect(state.liPlan["100"].coef).toBe(false);
  });

  it("computes the coefficient line's client cost from its margin, not from dynamic_cost", () => {
    const state = stateOf(payload(true));
    // spend * 100 / (100 - m) - pacing-core's own formulation (coefDcForRow).
    expect(state.facts.liDaily["200"][DATE].dc).toBeCloseTo((SPEND * 100) / (100 - MARGIN), 6);
    // The ordinary line is untouched: it keeps the delivered dynamic_cost.
    expect(state.facts.liDaily["100"][DATE].dc).toBeCloseTo(GARBAGE_DC, 6);
  });

  it("leaves a pacing that uses no coefficient line item on the dynamic_cost path", () => {
    const state = stateOf(payload(false));
    expect(state.liPlan["200"].coef).toBe(false);
    expect(state.facts.liDaily["200"][DATE].dc).toBeCloseTo(GARBAGE_DC, 6);
  });
});
