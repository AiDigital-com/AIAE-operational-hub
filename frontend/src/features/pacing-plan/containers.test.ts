import { describe, expect, it } from "vitest";
import {
  buildDateChild,
  buildDefaultContainer,
  buildDimChild,
  dimChildLabel,
  dimKeysOverTarget,
  DIM_KEYS,
  DIM_LABELS,
  resolveDimAbs,
  containerImprSum,
  containerSumExceedsPlan,
  currencyMatches,
  duplicateContainer,
  genId,
  nextMonthPeriod,
  type PacingContainer,
} from "./containers";

describe("genId", () => {
  it("prefixes and returns distinct ids", () => {
    const a = genId("c");
    const b = genId("c");
    expect(a).toMatch(/^c-/);
    expect(b).toMatch(/^c-/);
    expect(a).not.toEqual(b);
  });
});

describe("buildDefaultContainer", () => {
  it("copies the line item's own targets and names a single-month flight by month", () => {
    const container = buildDefaultContainer({
      fs: "2026-03-01",
      fe: "2026-03-31",
      targetImpressions: 500000,
      nativeBudget: 20000,
    });
    expect(container.name).toBe("Mar 2026");
    expect(container.fs).toBe("2026-03-01");
    expect(container.fe).toBe("2026-03-31");
    expect(container.target_impressions).toBe(500000);
    expect(container.native_budget).toBe(20000);
    expect(container.date_children).toEqual([]);
    expect(container.dim_children).toEqual([]);
  });

  it("falls back to a generic name when the flight spans more than one month", () => {
    const container = buildDefaultContainer({
      fs: "2026-01-01",
      fe: "2026-03-31",
      targetImpressions: 100,
      nativeBudget: null,
    });
    expect(container.name).toBe("Container");
  });
});

describe("nextMonthPeriod", () => {
  it("shifts a full calendar month to the next one", () => {
    expect(nextMonthPeriod("2026-01-01", "2026-01-31")).toEqual({
      fs: "2026-02-01",
      fe: "2026-02-28",
      name: "Feb 2026",
    });
  });

  it("rolls December into January of the next year", () => {
    expect(nextMonthPeriod("2026-12-01", "2026-12-31")).toEqual({
      fs: "2027-01-01",
      fe: "2027-01-31",
      name: "Jan 2027",
    });
  });

  it("shifts a non-calendar-month span by its own length, with no name", () => {
    expect(nextMonthPeriod("2026-01-05", "2026-01-14")).toEqual({
      fs: "2026-01-15",
      fe: "2026-01-24",
      name: null,
    });
  });
});

describe("duplicateContainer", () => {
  const src: PacingContainer = {
    id: "c1",
    name: "Jan 2026",
    fs: "2026-01-01",
    fe: "2026-01-31",
    target_impressions: 100000,
    native_budget: 5000,
    target_spend: 5000,
    margin_percent: 20,
    date_children: [
      {
        id: "d1",
        name: "Week 1",
        fs: "2026-01-01",
        fe: "2026-01-07",
        target_impressions: 25000,
        native_budget: 1250,
        target_spend: 1250,
        margin_percent: null,
      },
    ],
    dim_children: [],
  };

  it("scales every absolute target by the factor and carries the duplicate-transport marker", () => {
    const dup = duplicateContainer(src, { name: "Feb 2026", fs: "2026-02-01", fe: "2026-02-28", scale: 1.1 });
    expect(dup.name).toBe("Feb 2026");
    expect(dup.fs).toBe("2026-02-01");
    expect(dup.fe).toBe("2026-02-28");
    expect(dup.target_impressions).toBe(110000);
    expect(dup.native_budget).toBe(5500);
    expect(dup.target_spend).toBe(5500);
    expect(dup.margin_percent).toBe(20);
    expect(dup.date_children).toHaveLength(1);
    expect(dup.date_children[0].target_impressions).toBe(27500);
    expect(dup.date_children[0].id).not.toBe("d1");
    // The three transport-only fields dash-gate's existing duplicate mechanism reads and strips.
    expect(dup.__action).toBe("duplicate");
    expect(dup.__source_id).toBe("c1");
    expect(dup.__scale).toBe(1.1);
  });

  it("defaults to scale 1 (an exact copy) for a non-positive or invalid factor", () => {
    const dup = duplicateContainer(src, { name: null, fs: "2026-02-01", fe: "2026-02-28", scale: 0 });
    expect(dup.target_impressions).toBe(100000);
    expect(dup.__scale).toBe(1);
    expect(dup.name).toBe("Jan 2026 (copy)");
  });

  it("generates a fresh id, never reusing the source container's own", () => {
    const dup = duplicateContainer(src, { name: "Copy", fs: "2026-02-01", fe: "2026-02-28", scale: 1 });
    expect(dup.id).not.toBe(src.id);
  });

  // Dim children have no Hub UI, but a container authored in the retired SPA carries them and must
  // survive a duplicate the way that SPA cloned it (PacingTab.jsx:150-162).
  describe("dim children", () => {
    const withDims: PacingContainer = {
      ...src,
      dim_children: [
        { id: "x1", dim_key: "platform", dim_value: "CTV", target_mode: "absolute", target_value: 40000, native_budget: 2000, target_spend: 2000 },
        { id: "x2", dim_key: "platform", dim_value: "OLV", target_mode: "percent", target_value: 30, native_budget: null, target_spend: null },
      ],
    };

    it("re-ids each one so a duplicate never shares a key with its source", () => {
      const dup = duplicateContainer(withDims, { name: "Feb", fs: "2026-02-01", fe: "2026-02-28", scale: 0.5 });
      const ids = dup.dim_children.map((dx) => dx.id);
      expect(ids).not.toContain("x1");
      expect(ids).not.toContain("x2");
      expect(new Set(ids).size).toBe(2);
    });

    it("scales an absolute target and its money, and leaves a percent target alone", () => {
      const dup = duplicateContainer(withDims, { name: "Feb", fs: "2026-02-01", fe: "2026-02-28", scale: 0.5 });
      const [abs, pct] = dup.dim_children;
      expect(abs.target_value).toBe(20000);
      expect(abs.native_budget).toBe(1000);
      expect(abs.target_spend).toBe(1000);
      // A share OF the container's own target, which this duplicate already halved - scaling it here
      // would apply 0.5 twice and silently quarter the split.
      expect(pct.target_value).toBe(30);
    });

    it("keeps the fields it does not own untouched", () => {
      const dup = duplicateContainer(withDims, { name: "Feb", fs: "2026-02-01", fe: "2026-02-28", scale: 0.5 });
      expect(dup.dim_children[0].dim_key).toBe("platform");
      expect(dup.dim_children[0].dim_value).toBe("CTV");
      expect(dup.dim_children[1].target_mode).toBe("percent");
    });
  });
});

describe("buildDateChild", () => {
  it("seeds fs/fe from the container and leaves targets blank", () => {
    const dc = buildDateChild({ fs: "2026-01-01", fe: "2026-01-31" });
    expect(dc.fs).toBe("2026-01-01");
    expect(dc.fe).toBe("2026-01-31");
    expect(dc.target_impressions).toBeNull();
  });
});

describe("containerImprSum / containerSumExceedsPlan", () => {
  const containers: PacingContainer[] = [
    { id: "c1", name: "A", fs: "2026-01-01", fe: "2026-01-31", target_impressions: 60000, target_spend: null, date_children: [], dim_children: [] },
    { id: "c2", name: "B", fs: "2026-02-01", fe: "2026-02-28", target_impressions: 50000, target_spend: null, date_children: [], dim_children: [] },
  ];

  it("sums plain target_impressions across containers", () => {
    expect(containerImprSum(containers)).toBe(110000);
  });

  it("flags when the sum exceeds the line item's own plan - informational only, never a save gate", () => {
    expect(containerSumExceedsPlan(100000, containers)).toBe(true);
    expect(containerSumExceedsPlan(110000, containers)).toBe(false);
    expect(containerSumExceedsPlan(200000, containers)).toBe(false);
  });

  it("never flags when the line item carries no plan target yet (nothing to compare against)", () => {
    expect(containerSumExceedsPlan(0, containers)).toBe(false);
    expect(containerSumExceedsPlan(null, containers)).toBe(false);
  });
});

describe("currencyMatches", () => {
  it("normalizes null/empty to USD", () => {
    expect(currencyMatches(null, null)).toBe(true);
    expect(currencyMatches(undefined, "USD")).toBe(true);
    expect(currencyMatches("usd", "USD")).toBe(true);
  });

  it("flags a real mismatch", () => {
    expect(currencyMatches("CAD", "USD")).toBe(false);
    expect(currencyMatches("CAD", null)).toBe(false);
  });
});

// §10 sub-breakdowns (US-129/130). The maths these mirror already shipped on the
// Pacing side (pacing-core.js:resolveDimAbs); what is tested here is the Hub's
// reader of it and the warning built on top.
describe("sub-breakdowns", () => {
  const container: PacingContainer = {
    id: "c1",
    name: "Q1",
    fs: "2026-01-01",
    fe: "2026-03-31",
    target_impressions: 100000,
    native_budget: 5000,
    target_spend: 5000,
    margin_percent: 20,
    date_children: [],
    dim_children: [],
  };

  describe("buildDimChild", () => {
    it("starts on an absolute target with nothing filled in, as the retired SPA did", () => {
      const dx = buildDimChild("audience", "Sports fans");
      expect(dx.dim_key).toBe("audience");
      expect(dx.dim_value).toBe("Sports fans");
      expect(dx.target_mode).toBe("absolute");
      expect(dx.target_value).toBeNull();
      expect(dx.margin_percent).toBeNull();
      expect(dx.notify_in_summary).toBe(false);
      expect(dx.id).toMatch(/^x-/);
    });

    it("gives every sub-breakdown its own id", () => {
      expect(buildDimChild("geo", "TX").id).not.toBe(buildDimChild("geo", "TX").id);
    });

    // US-130: the value the client asked for need not exist in NetSuite.
    it("accepts a free-text value verbatim", () => {
      expect(buildDimChild("comment", "Client's own label — 2026 push").dim_value)
        .toBe("Client's own label — 2026 push");
    });
  });

  describe("resolveDimAbs", () => {
    it("reads an absolute target as the unit count it is", () => {
      expect(resolveDimAbs({ target_mode: "absolute", target_value: 40000 }, container)).toBe(40000);
    });

    it("reads a percent target as a share of the PARENT's target", () => {
      expect(resolveDimAbs({ target_mode: "percent", target_value: 30 }, container)).toBe(30000);
    });

    it("returns 0 rather than NaN when either side is missing", () => {
      expect(resolveDimAbs({ target_mode: "absolute", target_value: null }, container)).toBe(0);
      expect(resolveDimAbs({ target_mode: "percent", target_value: 30 }, { target_impressions: null })).toBe(0);
    });
  });

  describe("dimKeysOverTarget", () => {
    it("flags a key whose sub-breakdowns outrun the container", () => {
      const c = { ...container, dim_children: [
        buildDimChild("geo", "TX"), buildDimChild("geo", "CA"),
      ] };
      c.dim_children[0].target_value = 70000;
      c.dim_children[1].target_value = 50000;
      expect(dimKeysOverTarget(c)).toEqual(["geo"]);
    });

    // The bug the retired SPA fixed at PacingTab.jsx:950. Audience and Geo cut the
    // SAME units along independent axes, so their targets are not additive; summing
    // them warned on every container carrying two dimensions.
    it("never sums across different keys", () => {
      const c = { ...container, dim_children: [
        buildDimChild("audience", "Sports fans"), buildDimChild("geo", "TX"),
      ] };
      c.dim_children[0].target_value = 60000;
      c.dim_children[1].target_value = 60000; // 120k summed, but 60k on each axis
      expect(dimKeysOverTarget(c)).toEqual([]);
    });

    it("measures a percent target against the parent, not as a raw number", () => {
      const c = { ...container, dim_children: [buildDimChild("geo", "TX")] };
      c.dim_children[0].target_mode = "percent";
      c.dim_children[0].target_value = 150; // 150% of 100000 = 150000, over
      expect(dimKeysOverTarget(c)).toEqual(["geo"]);
      c.dim_children[0].target_value = 90;
      expect(dimKeysOverTarget(c)).toEqual([]);
    });

    it("says nothing when the container has no target of its own to measure against", () => {
      const c = { ...container, target_impressions: null, dim_children: [buildDimChild("geo", "TX")] };
      c.dim_children[0].target_value = 999999;
      expect(dimKeysOverTarget(c)).toEqual([]);
    });
  });

  describe("keys and labels", () => {
    // Eleven, per the migration plan — wider than the SPA's eight, which listed only
    // namebuilder dimensions. Pacing's own widget validator has accepted all eleven
    // since 2026-08-11; nothing validates a CONTAINER's key at all, so this is the guard.
    it("offers the eleven keys the plan names, and labels every one", () => {
      expect([...DIM_KEYS].sort()).toEqual([
        "audience", "channel", "comment", "creative", "flight", "geo",
        "keyword", "language", "message", "platform", "tactic",
      ]);
      for (const k of DIM_KEYS) expect(DIM_LABELS[k]).toBeTruthy();
    });

    it("labels a sub-breakdown by dimension and value", () => {
      expect(dimChildLabel({ dim_key: "audience", dim_value: "Sports fans" })).toBe("Audience: Sports fans");
    });

    it("falls back to the raw key rather than showing nothing", () => {
      expect(dimChildLabel({ dim_key: "unknown_axis", dim_value: "x" })).toBe("unknown_axis: x");
    });
  });

  describe("duplicateContainer carries them", () => {
    it("scales an absolute target but not a percent one, and re-ids both", () => {
      const c = { ...container, dim_children: [
        buildDimChild("geo", "TX"), buildDimChild("geo", "CA"),
      ] };
      c.dim_children[0].target_value = 40000;
      c.dim_children[1].target_mode = "percent";
      c.dim_children[1].target_value = 30;
      const dup = duplicateContainer(c, { name: "Q2", fs: "2026-04-01", fe: "2026-06-30", scale: 0.5 });
      expect(dup.dim_children[0].target_value).toBe(20000);
      expect(dup.dim_children[1].target_value).toBe(30);
      expect(dup.dim_children.map((d) => d.id)).not.toContain(c.dim_children[0].id);
    });
  });
});
