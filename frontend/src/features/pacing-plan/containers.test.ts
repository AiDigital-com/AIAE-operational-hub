import { describe, expect, it } from "vitest";
import {
  buildDateChild,
  buildDefaultContainer,
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
