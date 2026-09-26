import { describe, expect, it, vi } from "vitest";
import {
  buildBreakdownFacts,
  factMatchesBreakdownFilters,
  groupBreakdownFilters,
  parseBreakdownFilters,
  type FactsBundle,
} from "./breakdown-filter";
import type { FactRow, LiPlanMap } from "../engine/vendor-types";

describe("parseBreakdownFilters", () => {
  it("parses dim:value pairs from a string[]", () => {
    expect(parseBreakdownFilters({ brkf: ["tactic:prospecting", "geo:Austin"] })).toEqual([
      { dim: "tactic", key: "prospecting" },
      { dim: "geo", key: "Austin" },
    ]);
  });

  it("accepts a legacy single string for bookmark compatibility", () => {
    expect(parseBreakdownFilters({ brkf: "tactic:prospecting" })).toEqual([{ dim: "tactic", key: "prospecting" }]);
  });

  it("rejects an unknown dimension", () => {
    expect(parseBreakdownFilters({ brkf: ["notadim:x"] })).toEqual([]);
  });

  it("rejects the muted __others__/__unclassified__ buckets and a malformed pair", () => {
    expect(parseBreakdownFilters({ brkf: ["tactic:__others__", "tactic:__unclassified__", "tactic:", "noColon"] })).toEqual([]);
  });

  it("dedupes repeated pairs, order-preserving", () => {
    expect(parseBreakdownFilters({ brkf: ["tactic:a", "tactic:b", "tactic:a"] })).toEqual([
      { dim: "tactic", key: "a" },
      { dim: "tactic", key: "b" },
    ]);
  });

  it("parses an outside pair and drops one with no line item", () => {
    expect(parseBreakdownFilters({ brkf: ["audience:__outside__@42", "audience:__outside__"] })).toEqual([
      { dim: "audience", key: "__outside__", liId: "42" },
    ]);
  });
});

describe("groupBreakdownFilters", () => {
  it("groups by dim, OR within one dim, excluding outside pairs", () => {
    const parsed = parseBreakdownFilters({ brkf: ["tactic:a", "tactic:b", "geo:Austin", "audience:__outside__@1"] });
    const grouped = groupBreakdownFilters(parsed);
    expect(grouped.get("tactic")).toEqual(new Set(["a", "b"]));
    expect(grouped.get("geo")).toEqual(new Set(["Austin"]));
    expect(grouped.has("audience")).toBe(false);
  });
});

describe("factMatchesBreakdownFilters", () => {
  it("matches only when every dim's value is in its allowed set (AND across dims)", () => {
    const byDim = groupBreakdownFilters(parseBreakdownFilters({ brkf: ["tactic:a", "geo:Austin"] }));
    expect(factMatchesBreakdownFilters({ tactic: "a", geo: "Austin" }, byDim)).toBe(true);
    expect(factMatchesBreakdownFilters({ tactic: "a", geo: "Dallas" }, byDim)).toBe(false);
  });
});

describe("buildBreakdownFacts", () => {
  const LP: LiPlanMap = {} as LiPlanMap;
  const baseFacts: FactsBundle = {
    factsDaily: [
      { line_item_id: "1", date: "2026-08-01", platform: "dv_360_dlv", tactic: "prospecting" } as FactRow,
      { line_item_id: "1", date: "2026-08-02", platform: "TTD", tactic: "retargeting" } as FactRow,
    ],
    liDaily: { "1": { "2026-08-01": { im: 10 } as never, "2026-08-02": { im: 20 } as never } },
    asOf: "2026-08-02",
    rate: undefined,
  };

  it("returns the SAME object back, by reference, when no filter is active", () => {
    const aggregates = vi.fn();
    const result = buildBreakdownFacts(baseFacts, {}, undefined, LP, aggregates);
    expect(result).toBe(baseFacts);
    expect(aggregates).not.toHaveBeenCalled();
  });

  it("returns null for null facts", () => {
    expect(buildBreakdownFacts(null, { platforms: ["TTD"] }, undefined, LP, vi.fn())).toBeNull();
  });

  it("filters factsDaily by platform before rebuilding LD/LSD", () => {
    const aggregates = vi.fn((rows: FactRow[]) => ({ LD: { filtered: true, rowCount: rows.length }, LSD: {}, asOf: "2026-08-02" }));
    const result = buildBreakdownFacts(baseFacts, { platforms: ["TTD"] }, undefined, LP, aggregates as never);
    expect(aggregates).toHaveBeenCalledTimes(1);
    const [rows] = aggregates.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe("TTD");
    // Original factsDaily/asOf/rate pass through untouched; only liDaily/liSplitDaily change.
    expect(result?.factsDaily).toBe(baseFacts.factsDaily);
    expect(result?.liDaily).toEqual({ filtered: true, rowCount: 1 });
  });

  it("filters factsDaily by a brkf dim pair", () => {
    const aggregates = vi.fn((rows: FactRow[]) => ({ LD: {}, LSD: {}, asOf: null }));
    buildBreakdownFacts(baseFacts, { brkf: ["tactic:retargeting"] }, undefined, LP, aggregates as never);
    const [rows] = aggregates.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].tactic).toBe("retargeting");
  });

  it("combines platform and brkf as AND", () => {
    const aggregates = vi.fn((rows: FactRow[]) => ({ LD: {}, LSD: {}, asOf: null }));
    buildBreakdownFacts(baseFacts, { platforms: ["TTD"], brkf: ["tactic:prospecting"] }, undefined, LP, aggregates as never);
    const [rows] = aggregates.mock.calls[0];
    expect(rows).toHaveLength(0);
  });
});
