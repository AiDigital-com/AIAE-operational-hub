/**
 * Net cost mode has to survive the seam into the vendored engine.
 *
 * The mirror of `spa/coef-seam.test.tsx`. There are two engines on the dashboard page, fed by two
 * separate bridges, and each one was dropping a different feature's plan fields:
 *
 *   - `usePacingState` (moved renderer, widgets) lost `cost_coef` - fixed, covered there.
 *   - `toEngineRaw` (vendored engine, the Daily performance table) lost the whole net family:
 *     `netRatio`, `storedNetRatio`, `netRatioLocked`, `nsNetRatio`. It enumerates the plan fields it
 *     forwards, and those four were never added, so every line item reached `normalize()` with
 *     `k === undefined` and `PacingCore.netDc` handed back the GROSS cost unchanged.
 *
 * `netRatio` is a MATH input: on a net pacing the client is invoiced at net, so the delivered client
 * cost is `dynamic_cost * k`. Losing it overstates that cost by `1/k` - on k = 0.85, by ~18%.
 *
 * Nothing else catches it: a missing key does not throw, `netDc` treats a non-finite ratio as the
 * identity, and the crown suite compares this engine against the server's own metrics bag on
 * fixtures that carry no net ratio. So this asserts the delivered figure.
 */
import { describe, expect, it } from "vitest";
import { createPacingEngine } from "./engine-loader";
import { toEngineRaw } from "./build-metrics";
import type { PacingDashboardV1 } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const DATE = "2026-08-01";
const GROSS_DC = 1000;
/** A real net ratio: `netDc` applies only a value strictly inside (0, 1). */
const K = 0.85;

/** One net line item (200) and one invoiced at gross (100), in the Hub's camelCase contract. */
function payload(netRatio: number | null) {
  const plan = (id: string, k: number | null) => ({
    lineItemId: id,
    channel: "Display",
    rateType: "CPM",
    clientBudget: 10_000,
    plannedImpressions: 1_000_000,
    marginTargetPct: 25,
    flightStart: DATE,
    flightEnd: "2026-08-31",
    containers: [],
    costCoef: false,
    netRatio: k,
    storedNetRatio: k,
    netRatioLocked: false,
    nsNetRatio: k,
  });
  return {
    campaign: { startDate: DATE, endDate: "2026-08-31", rate: 1 },
    planByLineItem: { "100": plan("100", null), "200": plan("200", netRatio) },
    factsDaily: [
      { line_item_id: "100", date: DATE, impressions: 10_000, clicks: 10, spend: 200, completes: 0, dynamic_cost: GROSS_DC },
      { line_item_id: "200", date: DATE, impressions: 10_000, clicks: 10, spend: 200, completes: 0, dynamic_cost: GROSS_DC },
    ],
  } as unknown as PacingDashboardV1;
}

function normalized(data: PacingDashboardV1) {
  const engine = createPacingEngine() as Any;
  return engine.normalize(toEngineRaw(data));
}

describe("net cost mode reaches the vendored engine", () => {
  it("carries the net ratio across the seam into the engine's plan", () => {
    const { LP } = normalized(payload(K));
    expect(LP["200"].k).toBeCloseTo(K, 6);
    // Invoiced at gross: the engine's identity, not a dropped field.
    expect(LP["100"].k).toBe(1);
  });

  /**
   * The engine half of the same bug, kept because it is the one that can regress silently.
   *
   * `vendor/dashboard-metrics.js` is generated from `AIAE-paicing`'s
   * `scripts/build-dashboard-metrics.mjs`, which carries a hand-written transcription of
   * `workspace/src/lib/dashboard/row-utils.js`. Its `addFact` had drifted to the pre-net signature -
   * `(r, f, rate, coefIdx)` with a bare `currencyToUsd` where the original takes `k` and wraps it in
   * `PacingCore.netDc` - so this engine could not apply a net ratio however correctly it was handed
   * one, and read client cost GROSS. Repaired and re-copied 2026-10-08 (see `vendor/SOURCE.md`).
   *
   * It drifted silently because that generator's parity suite
   * (`AIAE-paicing/tests/dashboard-metrics-test.mjs`) compares `normalize`/`pacing-calc`/`metrics`
   * line by line against their originals and does not cover the inlined `row-utils` parts. Nothing
   * on this side compares the vendored copy to its source either, so this asserts the behaviour.
   */
  it("invoices the net line's client cost at net, and leaves the gross line alone", () => {
    const { LD } = normalized(payload(K));
    expect(LD["200"][DATE].dc).toBeCloseTo(GROSS_DC * K, 6);
    expect(LD["100"][DATE].dc).toBeCloseTo(GROSS_DC, 6);
  });

  it("carries the fields the Settings drawer binds to, not just the operative ratio", () => {
    const { LP } = normalized(payload(K));
    expect(LP["200"].kStored).toBeCloseTo(K, 6);
    expect(LP["200"].nsK).toBeCloseTo(K, 6);
    expect(LP["200"].netLocked).toBe(false);
  });
});
