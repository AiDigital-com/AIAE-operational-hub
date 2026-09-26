import { describe, expect, it } from "vitest";
import { deriveHeroHealth, type HeroHealthRowInput } from "./pacing-dashboard-health";
import type { PacingMetricsBag } from "./types-metrics";

const ROW: HeroHealthRowInput = {
  pacingDeviationPct: -12.3,
  marginActualPct: 40,
  marginTargetPct: 45,
  paceStatus: "under",
};

function bag(campaign: Record<string, unknown>): PacingMetricsBag {
  return {
    asOf: "2026-09-20",
    campaign,
    scalars: {},
    series: [],
    daily: [],
    sources: {},
    readings: {},
    containers: {},
    bound: {},
  } as unknown as PacingMetricsBag;
}

describe("deriveHeroHealth", () => {
  it("reads pac/mA/mT off metrics.campaign when a goal is present", () => {
    const health = deriveHeroHealth(bag({ pac: 2, mA: 55, mT: 50, hasImpr: true }), ROW);
    expect(health).toEqual({ pacingDeviationPct: 2, marginActualPct: 55, marginTargetPct: 50, paceStatus: "on_pace" });
  });

  it("buckets a Scope filter's new figure into a different pace status - a Scope filter moves the strip", () => {
    // 20pp deviation crosses the +5pp ceiling in dash-gate/lib/health.mjs's pacingCategory.
    const health = deriveHeroHealth(bag({ pac: 20, mA: 55, mT: 50, hasImpr: true }), ROW);
    expect(health.pacingDeviationPct).toBe(20);
    expect(health.paceStatus).toBe("over");
  });

  it("buckets under (< -5pp) and on_pace (within +-5pp) the same way health.mjs's thresholds do", () => {
    expect(deriveHeroHealth(bag({ pac: -5.1, mA: 10, mT: 10, hasImpr: true }), ROW).paceStatus).toBe("under");
    expect(deriveHeroHealth(bag({ pac: -5, mA: 10, mT: 10, hasImpr: true }), ROW).paceStatus).toBe("on_pace");
    expect(deriveHeroHealth(bag({ pac: 5, mA: 10, mT: 10, hasImpr: true }), ROW).paceStatus).toBe("on_pace");
  });

  it("a filter that narrows effLIs to zero (or to line items with no deliverable goal) reads No data, not a false 0.0pp on_pace", () => {
    // campM's pac/mA default to 0 (not null) when the weighted sums have nothing to divide -
    // hasImpr/hasClicks/hasViews is the only signal that a goal actually exists in the current set.
    const health = deriveHeroHealth(bag({ pac: 0, mA: 0, mT: 0, hasImpr: false, hasClicks: false, hasViews: false }), ROW);
    expect(health.pacingDeviationPct).toBeNull();
    expect(health.marginActualPct).toBeNull();
    expect(health.paceStatus).toBe("no_data");
  });

  it("inactive (Complete/Archive) always wins - a filter cannot turn a retired pacing back on", () => {
    const health = deriveHeroHealth(bag({ pac: 2, mA: 55, mT: 50, hasImpr: true }), { ...ROW, paceStatus: "inactive" });
    expect(health).toEqual({ pacingDeviationPct: null, marginActualPct: null, marginTargetPct: 45, paceStatus: "inactive" });
  });

  it("falls back to the row's server-computed figures while there is no metrics bag yet (loading/error)", () => {
    expect(deriveHeroHealth(null, ROW)).toEqual({
      pacingDeviationPct: -12.3,
      marginActualPct: 40,
      marginTargetPct: 45,
      paceStatus: "under",
    });
  });
});

// The two acceptance criteria this exists for - "a Scope filter moves the strip" / "a Lens filter
// does not" - are proved one level down, at the source of `campaign.pac`/`mA`/`mT` itself, in
// `engine/build-metrics.filters.test.ts` ("a channel filter (Scope) DOES change campaign-level
// readings, unlike a platform/brkf filter (Lens)" + "leaves campaign-level readings unchanged by a
// platform filter" / "also holds for a brkf filter"): this file only has to prove it reads
// `campaign.pac`/`mA`/`mT` faithfully once they change, not that they change correctly.
