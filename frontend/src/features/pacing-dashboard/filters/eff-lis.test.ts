import { describe, expect, it } from "vitest";
import { computeEffLIs, getEffRange } from "./eff-lis";
import { DEFAULT_FILTERS } from "./types";
import type { LiPlanMap, NormalizedLiPlan } from "../engine/vendor-types";

function plan(overrides: Partial<NormalizedLiPlan>): NormalizedLiPlan {
  return {
    id: "1",
    ch: "Display",
    dsp: null,
    rateType: "CPM",
    budget: 1000,
    planImpr: 100000,
    mTgt: 20,
    coef: false,
    ctrTgt: null,
    vcrTgt: null,
    fs: "2026-08-01",
    fe: "2026-08-31",
    containers: [],
    labels: [],
    pause_intervals: [],
    desc: null,
    converted: false,
    currency: null,
    native_budget: null,
    ...overrides,
  };
}

const LP: LiPlanMap = {
  "1": plan({ id: "1", ch: "Display", labels: ["brand"] }),
  "2": plan({ id: "2", ch: "Video", labels: ["brand", "always-on"] }),
  "3": plan({ id: "3", ch: "Video", labels: [] }),
};

describe("computeEffLIs", () => {
  it("returns every id when no LI-level filter is active (the crown test's no-filter case)", () => {
    expect(computeEffLIs(LP, DEFAULT_FILTERS)).toEqual(["1", "2", "3"]);
  });

  it("returns [] for a null/undefined plan map", () => {
    expect(computeEffLIs(null, DEFAULT_FILTERS)).toEqual([]);
    expect(computeEffLIs(undefined, DEFAULT_FILTERS)).toEqual([]);
  });

  it("narrows by channel", () => {
    expect(computeEffLIs(LP, { ...DEFAULT_FILTERS, channels: ["Video"] })).toEqual(["2", "3"]);
  });

  it("narrows by label (any overlap)", () => {
    expect(computeEffLIs(LP, { ...DEFAULT_FILTERS, labels: ["always-on"] })).toEqual(["2"]);
  });

  it("narrows by explicit selection", () => {
    expect(computeEffLIs(LP, { ...DEFAULT_FILTERS, selection: ["1", "3"] })).toEqual(["1", "3"]);
  });

  it("applies channel, label and selection together (AND across filter kinds)", () => {
    expect(
      computeEffLIs(LP, { ...DEFAULT_FILTERS, channels: ["Video"], labels: ["brand"], selection: ["2", "3"] })
    ).toEqual(["2"]);
  });
});

describe("getEffRange", () => {
  const campaign = { startDate: "2026-08-01", endDate: "2026-08-31" };

  it("defaults to the whole flight clamped at asOf - byte-identical to merge.mjs's hardcoded default", () => {
    expect(getEffRange(DEFAULT_FILTERS, campaign, "2026-08-15")).toEqual({ from: "2026-08-01", to: "2026-08-15" });
  });

  it("falls back to campaign.endDate when there is no asOf yet", () => {
    expect(getEffRange(DEFAULT_FILTERS, campaign, null)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("uses the custom range when both ends are set", () => {
    const filters = { ...DEFAULT_FILTERS, range: "custom", customRange: { from: "2026-08-05", to: "2026-08-10" } };
    expect(getEffRange(filters, campaign, "2026-08-15")).toEqual({ from: "2026-08-05", to: "2026-08-10" });
  });

  it("ignores an incomplete custom range and falls back to the default window", () => {
    const filters = { ...DEFAULT_FILTERS, range: "custom", customRange: { from: "2026-08-05", to: "" } };
    expect(getEffRange(filters, campaign, "2026-08-15")).toEqual({ from: "2026-08-01", to: "2026-08-15" });
  });

  it("clips an Nd quick range back from asOf", () => {
    const filters = { ...DEFAULT_FILTERS, range: "7d" };
    // 7 days INCLUSIVE of asOf: Aug 9 - Aug 15.
    expect(getEffRange(filters, campaign, "2026-08-15")).toEqual({ from: "2026-08-09", to: "2026-08-15" });
  });

  it("a quick range with no asOf yet falls back to the default window (no data to clip from)", () => {
    const filters = { ...DEFAULT_FILTERS, range: "7d" };
    expect(getEffRange(filters, campaign, null)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });
});
