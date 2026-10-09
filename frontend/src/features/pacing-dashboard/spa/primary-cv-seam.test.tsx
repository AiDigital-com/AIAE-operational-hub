/**
 * Primary conversions have to survive the seam into the moved renderer.
 *
 * The third of the same family as `coef-seam.test.tsx` and `engine/net-seam.test.ts`, and the one
 * that was missing most of its plumbing rather than a key: the feature's whole server half was never
 * ported into this fork, so `merge.mjs` published none of the three plan fields, the Hub contract
 * carried none of them, and `usePacingState` hardcoded `cvCtx: null` - which `overlayLiDaily` reads
 * as "the feature is off". A pacing where a line item had chosen ONE conversion action therefore
 * counted every action the platform reported. Ported 2026-10-08.
 *
 * `operative` is the server's own published flag (`merge.mjs`'s `publicDataConfig` computes
 * `primary_cv_operative` and never stores it), never recomputed on this side - so the fixture sets
 * it the way the wire delivers it.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
// @ts-expect-error - moved JS from Pacing's SPA, deliberately untyped (see SOURCE.md)
import { usePacingState } from "./store.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const DATE = "2026-08-01";
/** The action the line item chose. */
const CHOSEN = "Purchase";
/** Reported by the platform on the same line and day, and NOT chosen. */
const OTHER = "Page View";

function payload(opts: { operative: boolean; choice: string[] | null }) {
  return {
    campaign: { startDate: DATE, endDate: "2026-08-31", rate: 1 },
    // What `publicDataConfig` publishes: the switch itself plus the computed operative flag.
    data: { primary_conversions_enabled: true, primary_cv_operative: opts.operative },
    planByLineItem: {
      "100": {
        lineItemId: "100",
        channel: "Meta",
        rateType: "CPM",
        clientBudget: 10_000,
        plannedImpressions: 1_000_000,
        marginTargetPct: 25,
        flightStart: DATE,
        flightEnd: "2026-08-31",
        containers: [],
        ...(opts.choice ? { primaryConversions: opts.choice } : {}),
        conversionData: true,
      },
    },
    factsDaily: [
      // 9 conversions as the delivery mart reported them - the "count everything" number.
      { line_item_id: "100", date: DATE, impressions: 10_000, clicks: 10, spend: 200, completes: 0, dynamic_cost: 300, conversions: 9 },
    ],
    conversions: [
      { line_item_id: "100", date: DATE, conversion_action: CHOSEN, conversions: 2, post_click_conversions: 2, post_view_conversions: 0 },
      { line_item_id: "100", date: DATE, conversion_action: OTHER, conversions: 7, post_click_conversions: 7, post_view_conversions: 0 },
    ],
  };
}

function stateOf(data: unknown) {
  const { result } = renderHook(() =>
    (usePacingState as Any)({ data, urlFilters: { filters: {}, setFilters: () => {} }, actions: {}, journalHighlight: null })
  );
  return result.current as Any;
}

describe("primary conversions reach the moved renderer", () => {
  it("counts only the chosen action, not everything the platform reported", () => {
    const state = stateOf(payload({ operative: true, choice: [CHOSEN] }));
    expect(state.liPlan["100"].primaryCv).toEqual([CHOSEN]);
    // 2, not the 9 on the fact row: the overlay zeroes the line's cv and refills it from the
    // chosen action's rows alone.
    expect(state.facts.liDaily["100"][DATE].cv).toBe(2);
  });

  it("leaves a line with no choice on the platform's own number", () => {
    const state = stateOf(payload({ operative: true, choice: null }));
    expect(state.facts.liDaily["100"][DATE].cv).toBe(9);
  });

  it("changes nothing while the pacing's switch is off", () => {
    // The choice is stored and published, but not operative - the stored-vs-operative split the
    // net ratio uses too. The figures must be exactly the no-feature ones.
    const state = stateOf(payload({ operative: false, choice: [CHOSEN] }));
    expect(state.facts.liDaily["100"][DATE].cv).toBe(9);
  });

  it("builds a context from the payload rather than the hardcoded null it used to pass", () => {
    const state = stateOf(payload({ operative: true, choice: [CHOSEN] }));
    expect(state.facts.cvCtx).not.toBeNull();
    expect(state.facts.cvCtx.operative).toBe(true);
    expect(state.facts.cvCtx.asOf).toBe(DATE);
  });
});
