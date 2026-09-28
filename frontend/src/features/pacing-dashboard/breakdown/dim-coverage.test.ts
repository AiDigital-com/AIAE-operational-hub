import { describe, expect, it } from "vitest";
import { RESIDUAL_KEYS, type DimBucket } from "./breakdown-aggregate";
import {
  CARDINALITY_LIMIT,
  DEVICE_DIM,
  aggregateDimSource,
  breakdownDimsFor,
  breakdownServable,
  breakdownState,
  coverageLineFor,
  coverageSublabel,
  coverageWindowFor,
  coverageWindowLabel,
  deviceBucketMap,
  dimSourceAvailable,
  dimSourceCardinality,
  dimSourceUnitKey,
  discrepancyLabel,
  isDimSourceDim,
  rowUnitKeyFor,
  stalenessLabel,
  type DimSourceAggregate,
  type DimSourceRow,
} from "./dim-coverage";

function bucket(overrides: Partial<DimBucket> = {}): DimBucket {
  return { im: 0, cl: 0, sp: 0, co: 0, cv: 0, pc: 0, pv: 0, dc: 0, imV: 0, coV: 0, ...overrides };
}

function srcRow(
  date: string,
  li: string,
  device: unknown,
  metrics: Record<string, number> = {}
): DimSourceRow {
  return { date, line_item_id: li, dims: { device_type: device }, metrics };
}

function agg(overrides: Partial<DimSourceAggregate> = {}): DimSourceAggregate {
  return {
    buckets: {},
    named: 0,
    noValue: 0,
    noValueMetrics: bucket(),
    notCovered: 0,
    coverage: 0,
    valued: 0,
    discrepancy: 0,
    from: null,
    to: null,
    ...overrides,
  };
}

const LI1 = new Set(["1"]);

describe("aggregateDimSource", () => {
  it("splits delivery into three parts that add up: named + noValue + notCovered = delivery", () => {
    const rows = [
      srcRow("2026-08-01", "1", "Ctv", { im: 40 }),
      srcRow("2026-08-01", "1", "", { im: 10 }), // blank -> noValue
      srcRow("2026-08-02", "1", "Mobile", { im: 30 }),
      srcRow("2026-08-02", "1", "Unknown", { im: 5 }), // dropped -> noValue, never deleted
    ];
    const r = aggregateDimSource(rows, {
      dimKey: DEVICE_DIM,
      liIdSet: LI1,
      deliveryByDate: { "2026-08-01": 100, "2026-08-02": 100 },
    });
    expect(r.named).toBe(70);
    expect(r.noValue).toBe(15);
    expect(r.notCovered).toBe(115);
    expect(r.named + r.noValue + r.notCovered).toBe(200);
    expect(r.buckets.CTV.im).toBe(40);
    expect(r.buckets.Mobile.im).toBe(30);
    expect(r.coverage).toBe(85 / 200);
    expect(r.valued).toBe(70 / 200);
  });

  it("measures over the days BOTH sides have by default, so a lagging source does not report the lag as missing data", () => {
    const rows = [srcRow("2026-08-01", "1", "Ctv", { im: 100 }), srcRow("2026-08-02", "1", "Ctv", { im: 100 })];
    const r = aggregateDimSource(rows, {
      dimKey: DEVICE_DIM,
      liIdSet: LI1,
      // Delivery runs one day past the source - that day must not count as not covered.
      deliveryByDate: { "2026-08-01": 100, "2026-08-02": 100, "2026-08-03": 50 },
    });
    expect(r.from).toBe("2026-08-01");
    expect(r.to).toBe("2026-08-02");
    expect(r.notCovered).toBe(0);
    expect(r.coverage).toBe(1);
  });

  it("intersectWindow: false measures the selected range instead - the lag day becomes not covered", () => {
    const rows = [srcRow("2026-08-01", "1", "Ctv", { im: 100 }), srcRow("2026-08-02", "1", "Ctv", { im: 100 })];
    const r = aggregateDimSource(rows, {
      dimKey: DEVICE_DIM,
      liIdSet: LI1,
      deliveryByDate: { "2026-08-01": 100, "2026-08-02": 100, "2026-08-03": 50 },
      intersectWindow: false,
      range: { from: "2026-08-01", to: "2026-08-03" },
    });
    expect(r.notCovered).toBe(50);
    expect(r.named + r.noValue + r.notCovered).toBe(250);
  });

  it("lets a user range narrow the shared window but never widen it", () => {
    const rows = [srcRow("2026-08-01", "1", "Ctv", { im: 100 }), srcRow("2026-08-02", "1", "Ctv", { im: 100 })];
    const delivery = { "2026-08-01": 100, "2026-08-02": 100, "2026-08-03": 50 };
    const narrowed = aggregateDimSource(rows, {
      dimKey: DEVICE_DIM,
      liIdSet: LI1,
      deliveryByDate: delivery,
      range: { from: "2026-08-02", to: "2026-08-02" },
    });
    expect(narrowed.from).toBe("2026-08-02");
    expect(narrowed.to).toBe("2026-08-02");
    expect(narrowed.named).toBe(100);

    const wide = aggregateDimSource(rows, {
      dimKey: DEVICE_DIM,
      liIdSet: LI1,
      deliveryByDate: delivery,
      range: { from: "2026-07-01", to: "2026-08-10" },
    });
    expect(wide.from).toBe("2026-08-01");
    expect(wide.to).toBe("2026-08-02");
  });

  it("has no window at all when the two sides share no day", () => {
    const rows = [srcRow("2026-08-05", "1", "Ctv", { im: 100 })];
    const r = aggregateDimSource(rows, {
      dimKey: DEVICE_DIM,
      liIdSet: LI1,
      deliveryByDate: { "2026-08-01": 100 },
      range: { from: "2026-08-01", to: "2026-08-05" },
    });
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
    expect(r.named).toBe(0);
    expect(r.notCovered).toBe(0);
  });

  it("counts the gated anchor coV from VCR-eligible line items only", () => {
    const rows = [
      srcRow("2026-08-01", "1", "Ctv", { im: 100, co: 50 }),
      srcRow("2026-08-01", "2", "Ctv", { im: 100, co: 70 }), // display line - no gated completes
    ];
    const r = aggregateDimSource(rows, {
      dimKey: DEVICE_DIM,
      liIdSet: new Set(["1", "2"]),
      anchor: "coV",
      vcrEligibleIds: new Set(["1"]),
      deliveryByDate: { "2026-08-01": 50 },
    });
    expect(r.named).toBe(50);
    // The bucket still carries BOTH raw completes and the gated pair separately.
    expect(r.buckets.CTV.co).toBe(120);
    expect(r.buckets.CTV.coV).toBe(50);
    expect(r.buckets.CTV.imV).toBe(100);
  });

  it("measures discrepancy on the totals, not as 1 - coverage, so the figure is precision-exact", () => {
    const rows = [srcRow("2026-08-01", "1", "Ctv", { im: 13 })];
    const r = aggregateDimSource(rows, {
      dimKey: DEVICE_DIM,
      liIdSet: LI1,
      deliveryByDate: { "2026-08-01": 10 },
    });
    // (1 - r.coverage) * -100 would come out as 30.000000000000004.
    expect(r.discrepancy).toBe(30);
    expect(r.notCovered).toBe(0); // never negative
  });

  it("reports 100% discrepancy when the source has rows but there is no delivery at all", () => {
    const rows = [srcRow("2026-08-01", "1", "Ctv", { im: 10 })];
    const r = aggregateDimSource(rows, { dimKey: DEVICE_DIM, liIdSet: LI1, intersectWindow: false });
    expect(r.discrepancy).toBe(100);
    expect(r.coverage).toBe(0);
    const empty = aggregateDimSource([], { dimKey: DEVICE_DIM, liIdSet: LI1, intersectWindow: false });
    expect(empty.discrepancy).toBe(0);
  });

  it("makes a bucket labelled '__proto__' a real, countable bucket", () => {
    const rows = [srcRow("2026-08-01", "1", "__proto__", { im: 40 })];
    const r = aggregateDimSource(rows, {
      dimKey: DEVICE_DIM,
      liIdSet: LI1,
      deliveryByDate: { "2026-08-01": 100 },
    });
    expect(Object.keys(r.buckets)).toContain("__proto__");
    expect(Object.prototype.hasOwnProperty.call(r.buckets, "__proto__")).toBe(true);
    expect(r.buckets["__proto__"].im).toBe(40);
    expect(r.named).toBe(40);
  });

  it("keeps the full metrics on the no-value side, not just the anchor", () => {
    const rows = [srcRow("2026-08-01", "1", " ", { im: 10, cl: 3, sp: 2.5 })];
    const r = aggregateDimSource(rows, {
      dimKey: DEVICE_DIM,
      liIdSet: LI1,
      deliveryByDate: { "2026-08-01": 100 },
    });
    expect(r.noValue).toBe(10);
    expect(r.noValueMetrics.cl).toBe(3);
    expect(r.noValueMetrics.sp).toBe(2.5);
  });

  it("clamps a row to its flight via liPlanForFlight", () => {
    const rows = [srcRow("2026-08-01", "1", "Ctv", { im: 10 }), srcRow("2026-08-05", "1", "Ctv", { im: 99 })];
    const r = aggregateDimSource(rows, {
      dimKey: DEVICE_DIM,
      liIdSet: LI1,
      liPlanForFlight: { "1": { fs: "2026-08-01", fe: "2026-08-02" } },
      deliveryByDate: { "2026-08-01": 10, "2026-08-05": 99 },
    });
    expect(r.named).toBe(10);
  });
});

describe("dimSourceCardinality / dimSourceAvailable", () => {
  it("counts grouped labels, not raw spellings, and excludes blanks and dropped values", () => {
    const rows = [
      srcRow("2026-08-01", "1", "Ctv"),
      srcRow("2026-08-01", "1", "Connected Tv"),
      srcRow("2026-08-01", "1", "Mobile"),
      srcRow("2026-08-01", "1", ""),
      srcRow("2026-08-01", "1", "Unknown"),
    ];
    expect(dimSourceCardinality(rows, DEVICE_DIM, LI1)).toBe(2);
  });

  it("counts through a stored per-source dictionary", () => {
    const rows = [srcRow("2026-08-01", "1", "a"), srcRow("2026-08-01", "1", "b")];
    expect(dimSourceCardinality(rows, DEVICE_DIM, LI1, [{ label: "One", members: ["a", "b"] }])).toBe(1);
  });

  it("refuses a source with no rows for the line items in view", () => {
    expect(dimSourceAvailable([], LI1, DEVICE_DIM)).toBe(false);
    expect(dimSourceAvailable([srcRow("2026-08-01", "9", "Ctv")], LI1, DEVICE_DIM)).toBe(false);
  });

  it("refuses a dimension over CARDINALITY_LIMIT grouped values and allows one at it", () => {
    const at = Array.from({ length: CARDINALITY_LIMIT }, (_, i) => srcRow("2026-08-01", "1", `v${i}`));
    const over = Array.from({ length: CARDINALITY_LIMIT + 1 }, (_, i) => srcRow("2026-08-01", "1", `v${i}`));
    expect(dimSourceAvailable(at, LI1, DEVICE_DIM)).toBe(true);
    expect(dimSourceAvailable(over, LI1, DEVICE_DIM)).toBe(false);
  });
});

describe("coverageSublabel", () => {
  it("splits the two zero-coverage causes: no delivery on the shared days vs no match at all", () => {
    expect(coverageSublabel(null)).toBe("no matching delivery");
    expect(coverageSublabel(agg())).toBe("no matching delivery");
    // The source reported rows on days the pacing recorded no delivery.
    expect(coverageSublabel(agg({ named: 5 }))).toBe("no delivery recorded on these days");
    expect(coverageSublabel(agg({ noValue: 5 }))).toBe("no delivery recorded on these days");
  });

  it("uses the ordinary covers-0% form when there WAS delivery to cover", () => {
    expect(coverageSublabel(agg({ notCovered: 100 }))).toBe("covers 0% of delivery");
  });

  it("says 'covers all delivery' only on an exact 100/100 with nothing left over", () => {
    expect(coverageSublabel(agg({ coverage: 1, valued: 1 }))).toBe("covers all delivery");
    // 99.9% rounds to 100 while a Not covered row sits under the line - the leftover decides.
    expect(coverageSublabel(agg({ coverage: 0.999, valued: 0.999, notCovered: 1 }))).toBe(
      "covers 100% of delivery"
    );
    // Over 100% the two sides disagree - never rounded up to "all".
    expect(coverageSublabel(agg({ coverage: 1.3, valued: 1.3 }))).toBe("covers 130% of delivery");
  });

  it("states both figures only when they round apart", () => {
    expect(coverageSublabel(agg({ coverage: 0.8, valued: 0.8, notCovered: 20 }))).toBe(
      "covers 80% of delivery"
    );
    expect(coverageSublabel(agg({ coverage: 0.8, valued: 0.6, notCovered: 20 }))).toBe(
      "covers 80% of delivery · 60% shown by value"
    );
  });
});

describe("discrepancyLabel", () => {
  it("says nothing at or below half a point over, and nothing when not over 100%", () => {
    expect(discrepancyLabel(null)).toBeNull();
    expect(discrepancyLabel(agg({ coverage: 0.35 }))).toBeNull();
    expect(discrepancyLabel(agg({ coverage: 1 }))).toBeNull();
    expect(discrepancyLabel(agg({ coverage: 1.004 }))).toBeNull();
    expect(discrepancyLabel(agg({ coverage: 1.005 }))).toBeNull();
  });

  it("names the overflow, one decimal under 10 points and whole above", () => {
    expect(discrepancyLabel(agg({ coverage: 1.3 }))).toBe("30% more than the pacing delivered");
    expect(discrepancyLabel(agg({ coverage: 1.043 }))).toBe("4.3% more than the pacing delivered");
    expect(discrepancyLabel(agg({ coverage: 1.153 }))).toBe("15% more than the pacing delivered");
  });
});

describe("stalenessLabel", () => {
  it("answers null for no entry and for a healthy one", () => {
    expect(stalenessLabel(null, "2026-08-12")).toBeNull();
    expect(stalenessLabel({}, "2026-08-12")).toBeNull();
    expect(stalenessLabel({ status: "ok", fetched_at: "2026-08-12T05:00:00Z" }, "2026-08-12")).toBeNull();
  });

  it("names both dates for a behind source, one when the other is missing, neither as a plain sentence", () => {
    expect(stalenessLabel({ behind: true, coverage_hint: "2026-08-10" }, "2026-08-12")).toBe(
      "these rows are from an earlier refresh; the breakdown has data to Aug 10, the dashboard to Aug 12"
    );
    expect(stalenessLabel({ behind: true, fetched_at: "2026-08-10T09:00:00Z" }, null)).toBe(
      "these rows are from an earlier refresh; the breakdown has data to Aug 10"
    );
    expect(stalenessLabel({ behind: true })).toBe(
      "these rows are from an earlier refresh than the delivery beside them"
    );
  });

  it("names the failed read with its reason, and without one", () => {
    expect(
      stalenessLabel({ status: "stale", error: "HTTP 500: boom", fetched_at: "2026-08-11T09:00:00Z" }, "2026-08-12")
    ).toBe("last read failed (HTTP 500), showing data from yesterday");
    expect(stalenessLabel({ status: "stale", fetched_at: "2026-08-09T09:00:00Z" }, "2026-08-12")).toBe(
      "showing data from 3 days ago"
    );
    expect(stalenessLabel({ status: "stale", fetched_at: "2026-08-12T09:00:00Z" }, "2026-08-12")).toBe(
      "showing data from today"
    );
    expect(stalenessLabel({ status: "stale" }, "2026-08-12")).toBe("showing data from an earlier read");
  });

  it("joins the behind and stale sentences when both apply", () => {
    const label = stalenessLabel(
      { behind: true, status: "stale", coverage_hint: "2026-08-10", fetched_at: "2026-08-11T09:00:00Z" },
      "2026-08-12"
    );
    expect(label).toBe(
      "these rows are from an earlier refresh; the breakdown has data to Aug 10, the dashboard to Aug 12" +
        " · showing data from yesterday"
    );
  });
});

describe("breakdownState / breakdownServable", () => {
  it("treats a source with no map as unrestricted", () => {
    expect(breakdownState(null, "s1", "city")).toBe("ready");
    expect(breakdownState({}, "s1", "city")).toBe("ready");
    expect(breakdownState({ s1: {} }, "s1", "city")).toBe("ready");
    expect(breakdownState({ s1: { breakdowns: { msg: "broken" } } }, "s1", "city")).toBe("ready");
  });

  it("serves ready and stale, refuses broken and not_read", () => {
    const loaded = { s1: { breakdowns: { a: "ready", b: "stale", c: "broken", d: "not_read" } } };
    expect(breakdownServable(loaded, "s1", "a")).toBe(true);
    expect(breakdownServable(loaded, "s1", "b")).toBe(true);
    expect(breakdownServable(loaded, "s1", "c")).toBe(false);
    expect(breakdownServable(loaded, "s1", "d")).toBe(false);
  });
});

describe("breakdownDimsFor", () => {
  const sheetA = {
    id: "s1",
    loader: "sheet",
    title: "Sheet A",
    origin: { columns: { dims: [{ key: "city", label: "City" }, { key: "msg", label: "Message" }] } },
  };
  const sheetB = {
    id: "s2",
    loader: "sheet",
    title: "Sheet B",
    origin: { columns: { dims: [{ key: "city", label: "City" }] } },
  };

  it("keeps the built-in device entry on its bare key", () => {
    expect(breakdownDimsFor([{ id: "devices", loader: "bq_mart", origin: { catalog: "devices" } }])).toEqual([
      { dim: DEVICE_DIM, sourceId: "devices", key: DEVICE_DIM, label: "Device", note: "from DSP", source: "DSP" },
    ]);
  });

  it("namespaces sheet dims as ds:<id>:<key>", () => {
    const dims = breakdownDimsFor([sheetA]);
    expect(dims.map((d) => d.dim)).toEqual(["ds:s1:city", "ds:s1:msg"]);
    expect(dims[0]).toEqual({
      dim: "ds:s1:city",
      sourceId: "s1",
      key: "city",
      label: "City",
      note: "Sheet A",
      source: "Sheet A",
    });
  });

  it("drops a non-servable breakdown when loaded is passed, keeps it when it is not", () => {
    const loaded = { s1: { breakdowns: { city: "broken", msg: "ready" } } };
    expect(breakdownDimsFor([sheetA], loaded).map((d) => d.dim)).toEqual(["ds:s1:msg"]);
    expect(breakdownDimsFor([sheetA]).map((d) => d.dim)).toEqual(["ds:s1:city", "ds:s1:msg"]);
  });

  it("appends the source name only where two labels collide", () => {
    const labels = breakdownDimsFor([sheetA, sheetB]).map((d) => d.label);
    expect(labels).toEqual(["City (Sheet A)", "Message", "City (Sheet B)"]);
  });

  it("skips malformed entries, unknown loaders and dims without a key", () => {
    const dims = breakdownDimsFor([
      null,
      { id: "x", loader: "bq_mart" }, // bq_mart but not the devices catalogue
      { id: "s3", loader: "sheet", origin: { columns: { dims: [{ label: "No key" }, null] } } },
    ]);
    expect(dims).toEqual([]);
  });
});

describe("unit keys", () => {
  it("swaps completes for the gated column only when the view has a gated basis", () => {
    expect(dimSourceUnitKey("co", true)).toBe("coV");
    expect(dimSourceUnitKey("co", false)).toBe("co");
    expect(dimSourceUnitKey("im", true)).toBe("im");
  });

  it("applies the swap only on dimension-source tabs", () => {
    expect(rowUnitKeyFor(DEVICE_DIM, "co", true)).toBe("coV");
    expect(rowUnitKeyFor("ds:s1:city", "co", true)).toBe("coV");
    expect(rowUnitKeyFor("tactic", "co", true)).toBe("co");
  });

  it("recognises dimension-source dims", () => {
    expect(isDimSourceDim(DEVICE_DIM)).toBe(true);
    expect(isDimSourceDim("ds:s1:city")).toBe(true);
    expect(isDimSourceDim("tactic")).toBe(false);
  });
});

describe("deviceBucketMap", () => {
  it("carries the source's real metrics on __novalue__ and the unit alone on __notcovered__", () => {
    const result = agg({
      buckets: { CTV: bucket({ im: 40 }) },
      noValue: 10,
      noValueMetrics: bucket({ im: 10, cl: 3, sp: 2.5 }),
      notCovered: 50,
    });
    const map = deviceBucketMap(result, "im");
    expect(map.__novalue__).toEqual(bucket({ im: 10, cl: 3, sp: 2.5 }));
    expect(map.__notcovered__).toEqual(bucket({ im: 50 }));
    // Extended in place, on purpose - see the '__proto__' note in the module.
    expect(map).toBe(result.buckets);
    // Both keys must be spellings the shared row pipeline already treats as residual.
    expect(RESIDUAL_KEYS.has("__novalue__")).toBe(true);
    expect(RESIDUAL_KEYS.has("__notcovered__")).toBe(true);
  });

  it("lands the not-covered remainder in the gated column when that is the unit", () => {
    const map = deviceBucketMap(agg({ notCovered: 7 }), "coV");
    expect(map.__notcovered__).toEqual(bucket({ coV: 7 }));
  });

  it("adds neither leftover row at zero", () => {
    const map = deviceBucketMap(agg({ buckets: { CTV: bucket({ im: 40 }) } }), "im");
    expect(Object.keys(map)).toEqual(["CTV"]);
    expect(deviceBucketMap(null, "im")).toEqual({});
  });
});

describe("coverage lines and window", () => {
  it("labels the measured window, one day or a range", () => {
    expect(coverageWindowLabel(agg({ from: "2026-08-01", to: "2026-08-05" }))).toBe("measured Aug 1 – Aug 5");
    expect(coverageWindowLabel(agg({ from: "2026-08-01", to: "2026-08-01" }))).toBe("measured Aug 1");
    expect(coverageWindowLabel(agg())).toBeNull();
    expect(coverageWindowLabel(null)).toBeNull();
  });

  it("states coverage and window only on dimension-source tabs with rows", () => {
    const full = agg({ coverage: 1, valued: 1, from: "2026-08-01", to: "2026-08-02" });
    expect(coverageLineFor(DEVICE_DIM, full, 2)).toBe("covers all delivery");
    expect(coverageLineFor("tactic", full, 2)).toBeNull();
    expect(coverageLineFor(DEVICE_DIM, full, 0)).toBeNull();
    expect(coverageLineFor(DEVICE_DIM, null, 2)).toBeNull();
    expect(coverageWindowFor(DEVICE_DIM, full, 2)).toBe("measured Aug 1 – Aug 2");
    expect(coverageWindowFor("tactic", full, 2)).toBeNull();
    expect(coverageWindowFor(DEVICE_DIM, full, 0)).toBeNull();
  });
});
