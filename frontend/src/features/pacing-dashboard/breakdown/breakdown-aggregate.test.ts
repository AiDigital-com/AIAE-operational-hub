import { describe, expect, it } from "vitest";
import {
  OTHERS_KEY,
  RESIDUAL_KEYS,
  UNCLASSIFIED_KEY,
  aggregateConversion,
  aggregateCreativeAsset,
  aggregateDim,
  breakdownTotals,
  detectAvailDims,
  dimTaggedDelivery,
  enrichRows,
  mergeSplitAcrossLIs,
  rateExtremes,
  sortRows,
  splitKeysFor,
  type BreakdownRow,
  type DimBucket,
} from "./breakdown-aggregate";
import type { FactRow, LiPlanMap, NormalizedLiPlan } from "../engine/vendor-types";

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

function bucket(overrides: Partial<DimBucket> = {}): DimBucket {
  return { im: 0, cl: 0, sp: 0, co: 0, cv: 0, pc: 0, pv: 0, dc: 0, imV: 0, coV: 0, ...overrides };
}

function row(overrides: Partial<BreakdownRow> & { key: string }): BreakdownRow {
  return {
    ...bucket(),
    label: overrides.key,
    ctr: 0,
    vcr: 0,
    cvr: 0,
    cpm: 0,
    residual: RESIDUAL_KEYS.has(overrides.key),
    unknownBeyondUnit: overrides.key === OTHERS_KEY || overrides.key === "__notcovered__",
    ...overrides,
  };
}

describe("splitKeysFor", () => {
  it("collects split keys for the lines in view only", () => {
    const lsd = {
      "1": { "tactic:a": { "2026-08-01": { im: 1 } } },
      "2": { "geo:Austin": { "2026-08-01": { im: 1 } } },
    };
    expect(splitKeysFor(lsd, ["1"])).toEqual({ "tactic:a": true });
    expect(splitKeysFor(lsd, ["1", "2"])).toEqual({ "tactic:a": true, "geo:Austin": true });
    expect(splitKeysFor(null, ["1"])).toEqual({});
  });
});

describe("detectAvailDims", () => {
  it("gives a dim with two or more values a tab", () => {
    const avail = detectAvailDims({ "tactic:a": true, "tactic:b": true }, null);
    expect(avail.has("tactic")).toBe(true);
  });

  it("gives a single-value dim a tab ONLY when it tags part (not all) of delivery", () => {
    const keys = { "platform:DV360": true };
    const partial = { total: 100, byDim: new Map([["platform", 60]]) };
    const full = { total: 100, byDim: new Map([["platform", 100]]) };
    expect(detectAvailDims(keys, partial).has("platform")).toBe(true);
    expect(detectAvailDims(keys, full).has("platform")).toBe(false);
    // No coverage aggregate -> the older behaviour exactly: a single value never earns a tab.
    expect(detectAvailDims(keys, null).has("platform")).toBe(false);
  });

  it("gives audience a tab at a single value, with no coverage needed", () => {
    expect(detectAvailDims({ "audience:retargeting": true }, null).has("audience")).toBe(true);
  });

  it("never counts '-' or empty as a value", () => {
    const avail = detectAvailDims({ "tactic:-": true, "tactic:": true, "tactic:  ": true }, null);
    expect(avail.has("tactic")).toBe(false);
  });
});

describe("dimTaggedDelivery", () => {
  it("sums per-dim tagged impressions and the delivered total over the flight, skipping '-'", () => {
    const LP: LiPlanMap = { "1": plan({ id: "1", fs: "2026-08-01", fe: "2026-08-02" }) };
    const liDaily = { "1": { "2026-08-01": { im: 100 }, "2026-08-05": { im: 999 } } };
    const lsd = {
      "1": {
        "geo:Austin": { "2026-08-01": { im: 40 }, "2026-08-05": { im: 999 } },
        "geo:-": { "2026-08-01": { im: 60 } },
      },
    };
    const { total, byDim } = dimTaggedDelivery(lsd, liDaily, ["1"], LP);
    expect(total).toBe(100); // the out-of-flight day is clipped
    expect(byDim.get("geo")).toBe(40); // '-' never counts toward what the dim tags
  });
});

describe("aggregateDim", () => {
  const splitData = {
    "geo:Austin": {
      "2026-08-01": bucket({ im: 100, cl: 5, imV: 100, coV: 20 }),
      "2026-08-10": bucket({ im: 50 }),
    },
    "geo:-": { "2026-08-01": bucket({ im: 7 }) },
    "geo:": { "2026-08-01": bucket({ im: 3 }) },
    "tactic:a": { "2026-08-01": bucket({ im: 999 }) },
  };

  it("folds '-' and empty values into __unclassified__ and skips other dims", () => {
    const map = aggregateDim(splitData, "geo", null);
    expect(Object.keys(map).sort()).toEqual([UNCLASSIFIED_KEY, "Austin"].sort());
    expect(map[UNCLASSIFIED_KEY].im).toBe(10);
    expect(map.Austin.im).toBe(150);
  });

  it("carries the gated imV/coV pair from the merged day rows", () => {
    const map = aggregateDim(splitData, "geo", null);
    expect(map.Austin.imV).toBe(100);
    expect(map.Austin.coV).toBe(20);
  });

  it("clips days outside the range window", () => {
    const map = aggregateDim(splitData, "geo", { from: "2026-08-01", to: "2026-08-05" });
    expect(map.Austin.im).toBe(100);
  });
});

describe("mergeSplitAcrossLIs", () => {
  const LP: LiPlanMap = {
    "1": plan({ id: "1", fs: "2026-08-01", fe: "2026-08-02" }),
    "2": plan({ id: "2", fs: "2026-08-01", fe: "2026-08-31" }),
  };
  const facts = {
    liSplitDaily: {
      "1": { "geo:Austin": { "2026-08-01": { im: 10, co: 4 }, "2026-08-09": { im: 999, co: 999 } } },
      "2": { "geo:Austin": { "2026-08-01": { im: 20, co: 6 } } },
    },
    liDaily: {
      "1": { "2026-08-01": { im: 10, cl: 1, co: 4 }, "2026-08-09": { im: 999, cl: 9, co: 9 } },
      "2": { "2026-08-01": { im: 20, cl: 2, co: 6 } },
    },
  };

  it("clips each line item by its own flight", () => {
    const { mergedSplit, totalIm, totals } = mergeSplitAcrossLIs(facts, ["1", "2"], LP, null, new Set());
    // LI 1's 08-09 day is outside its flight - gone from the merge AND from the totals.
    expect(mergedSplit["geo:Austin"]["2026-08-09"]).toBeUndefined();
    expect(mergedSplit["geo:Austin"]["2026-08-01"].im).toBe(30);
    expect(totalIm).toBe(30);
    expect(totals).toEqual({ im: 30, cl: 3, co: 10 });
  });

  it("accrues imV/coV only from lines in the eligible set", () => {
    const { mergedSplit } = mergeSplitAcrossLIs(facts, ["1", "2"], LP, null, new Set(["2"]));
    const day = mergedSplit["geo:Austin"]["2026-08-01"];
    expect(day.im).toBe(30); // ungated fields see both lines
    expect(day.imV).toBe(20); // gated pair sees only LI 2
    expect(day.coV).toBe(6);
  });

  it("returns the empty shape for missing facts or no lines", () => {
    expect(mergeSplitAcrossLIs(null, ["1"], LP, null, new Set())).toEqual({
      mergedSplit: {},
      totalIm: 0,
      totals: { im: 0, cl: 0, co: 0 },
    });
    expect(mergeSplitAcrossLIs(facts, [], LP, null, new Set()).totalIm).toBe(0);
  });
});

describe("aggregateCreativeAsset", () => {
  const creatives: FactRow[] = [
    { line_item_id: "1", date: "2026-08-01", creative: "Banner A", impressions: 100, clicks: 5, completes: 10, dynamic_cost: 100 },
    { line_item_id: "1", date: "2026-09-09", creative: "Banner A", impressions: 999 },
    { line_item_id: "2", date: "2026-08-01", creative: "", creative_id: "cr-77", impressions: 40, completes: 4 },
    { line_item_id: "3", date: "2026-08-01", creative: "Elsewhere", impressions: 999 },
  ];

  it("keys by creative name with creative_id fallback, clips by range, filters by liIdSet", () => {
    const map = aggregateCreativeAsset(creatives, new Set(["1", "2"]), { from: "2026-08-01", to: "2026-08-31" }, new Set(), 1);
    expect(Object.keys(map).sort()).toEqual(["Banner A", "cr-77"]);
    expect(map["Banner A"].im).toBe(100);
    expect(map["cr-77"].im).toBe(40);
  });

  it("converts dc through the currency rate and gates imV/coV on eligibility", () => {
    const map = aggregateCreativeAsset(creatives, new Set(["1", "2"]), null, new Set(["2"]), 0.5);
    expect(map["Banner A"].dc).toBe(50); // 100 native at rate 0.5
    expect(map["Banner A"].imV).toBe(0); // LI 1 is not eligible
    expect(map["cr-77"].imV).toBe(40);
    expect(map["cr-77"].coV).toBe(4);
  });
});

describe("aggregateConversion", () => {
  it("keys by conversion action, folding a blank action into __unclassified__", () => {
    const conversions: FactRow[] = [
      { line_item_id: "1", date: "2026-08-01", conversion_action: "Purchase", conversions: 5, post_click_conversions: 3, post_view_conversions: 2 },
      { line_item_id: "1", date: "2026-08-02", conversion_action: "  ", conversions: 1 },
      { line_item_id: "1", date: "2026-09-09", conversion_action: "Purchase", conversions: 999 },
      { line_item_id: "9", date: "2026-08-01", conversion_action: "Purchase", conversions: 999 },
    ];
    const map = aggregateConversion(conversions, new Set(["1"]), { from: "2026-08-01", to: "2026-08-31" });
    expect(map.Purchase).toMatchObject({ cv: 5, pc: 3, pv: 2 });
    expect(map[UNCLASSIFIED_KEY].cv).toBe(1);
  });
});

describe("enrichRows", () => {
  const dimMap = {
    Austin: bucket({ im: 1000, cl: 20, sp: 5, cv: 4, imV: 400, coV: 100 }),
    Dallas: bucket({ im: 500, cl: 5 }),
  };

  it("computes the four rates, with division by zero yielding 0", () => {
    const rows = enrichRows(dimMap, { unitKey: "im", liTotalUnits: 1500, withOthers: true });
    const austin = rows.find((r) => r.key === "Austin")!;
    expect(austin.ctr).toBe(2); // 20/1000*100
    expect(austin.vcr).toBe(25); // 100/400*100
    expect(austin.cvr).toBe(20); // 4/20*100
    expect(austin.cpm).toBe(5); // 5/1000*1000
    const dallas = rows.find((r) => r.key === "Dallas")!;
    expect(dallas.vcr).toBe(0); // imV 0 -> 0, never NaN
    expect(dallas.ctr).toBe(1);
  });

  it("adds __others__ only when the remainder is >0 and at least 1% of the total", () => {
    const rows = enrichRows(dimMap, { unitKey: "im", liTotalUnits: 2000, withOthers: true });
    const others = rows.find((r) => r.key === OTHERS_KEY)!;
    expect(others).toBeDefined();
    expect(others.im).toBe(500);
    // The remainder carries the unit and NOTHING else - its rates are unknown, not zero.
    expect(others).toMatchObject({ cl: 0, sp: 0, co: 0, cv: 0, ctr: 0, residual: true, unknownBeyondUnit: true });

    // Exact tie -> no remainder; a sub-1% sliver -> no remainder either.
    expect(enrichRows(dimMap, { unitKey: "im", liTotalUnits: 1500, withOthers: true }).some((r) => r.key === OTHERS_KEY)).toBe(false);
    expect(enrichRows(dimMap, { unitKey: "im", liTotalUnits: 1510, withOthers: true }).some((r) => r.key === OTHERS_KEY)).toBe(false);
  });

  it("puts the remainder in the campaign's primary unit", () => {
    const clMap = { Austin: bucket({ cl: 20 }) };
    const rows = enrichRows(clMap, { unitKey: "cl", liTotalUnits: 100, withOthers: true });
    expect(rows.find((r) => r.key === OTHERS_KEY)!.cl).toBe(80);
  });

  it("suppresses __others__ for the cuts whose totals do not sum to a delivery total", () => {
    const rows = enrichRows(dimMap, { unitKey: "im", liTotalUnits: 2000, withOthers: false });
    expect(rows.some((r) => r.key === OTHERS_KEY)).toBe(false);
  });

  it("returns no rows for an empty or Unclassified-only map", () => {
    expect(enrichRows({}, { unitKey: "im", liTotalUnits: 100, withOthers: true })).toEqual([]);
    expect(
      enrichRows({ [UNCLASSIFIED_KEY]: bucket({ im: 50 }) }, { unitKey: "im", liTotalUnits: 100, withOthers: true })
    ).toEqual([]);
  });
});

describe("sortRows", () => {
  const rows = [
    row({ key: "__notcovered__", label: "Not covered", im: 9000 }),
    row({ key: "b", label: "b", im: 10 }),
    row({ key: OTHERS_KEY, label: "Others", im: 5000 }),
    row({ key: UNCLASSIFIED_KEY, label: "Unclassified", im: 7000 }),
    row({ key: "a", label: "a", im: 20 }),
  ];

  it("sinks residual rows below real values regardless of direction, __notcovered__ last", () => {
    for (const dir of ["asc", "desc"] as const) {
      const keys = sortRows(rows, "im", dir).map((r) => r.key);
      expect(keys.slice(2)).toEqual([UNCLASSIFIED_KEY, OTHERS_KEY, "__notcovered__"]);
    }
  });

  it("orders within a rank by the chosen column and direction, label case-insensitively", () => {
    expect(sortRows(rows, "im", "desc").map((r) => r.key).slice(0, 2)).toEqual(["a", "b"]);
    expect(sortRows(rows, "im", "asc").map((r) => r.key).slice(0, 2)).toEqual(["b", "a"]);
    expect(sortRows(rows, "label", "asc").map((r) => r.key).slice(0, 2)).toEqual(["a", "b"]);
  });

  it("returns a new array and leaves the input untouched", () => {
    const before = rows.map((r) => r.key);
    const sorted = sortRows(rows, "im", "desc");
    expect(sorted).not.toBe(rows);
    expect(rows.map((r) => r.key)).toEqual(before);
  });
});

describe("breakdownTotals", () => {
  it("sums volumes over every row but rates over measured rows only", () => {
    const rows = [
      row({ key: "a", im: 1000, cl: 20, sp: 5, imV: 1000, coV: 250 }),
      row({ key: OTHERS_KEY, im: 4000 }), // unit only - its impressions must not dilute CTR
    ];
    const t = breakdownTotals(rows);
    expect(t.im).toBe(5000); // the column still ties to the pacing's own delivery
    expect(t.ctr).toBe(2); // 20/1000, NOT 20/5000
    expect(t.vcr).toBe(25);
    expect(t.cpm).toBe(5);
  });

  it("yields 0 rates when nothing was measured", () => {
    const t = breakdownTotals([row({ key: OTHERS_KEY, im: 100 })]);
    expect(t.im).toBe(100);
    expect(t.ctr).toBe(0);
  });
});

describe("rateExtremes", () => {
  it("returns the best/worst values when the relative spread exceeds 10%", () => {
    const rows = [row({ key: "a", ctr: 2, vcr: 50 }), row({ key: "b", ctr: 1, vcr: 48 })];
    const x = rateExtremes(rows);
    expect(x.bestCtr).toBe(2);
    expect(x.worstCtr).toBe(1);
    // VCR spread is (50-48)/50 = 4% - under the threshold, so no highlight.
    expect(x.bestVcr).toBeNull();
    expect(x.worstVcr).toBeNull();
  });

  it("returns nulls for a single row", () => {
    expect(rateExtremes([row({ key: "a", ctr: 5 })])).toEqual({ bestCtr: null, worstCtr: null, bestVcr: null, worstVcr: null });
  });

  it("does not treat unknown-beyond-unit rows as data points", () => {
    // Others' synthetic 0.00% would otherwise win "worst" every time.
    const rows = [row({ key: "a", ctr: 2 }), row({ key: "b", ctr: 1.95 }), row({ key: OTHERS_KEY, ctr: 0 })];
    const x = rateExtremes(rows);
    expect(x.worstCtr).toBeNull(); // spread between the two MEASURED rows is 2.5%
  });
});
