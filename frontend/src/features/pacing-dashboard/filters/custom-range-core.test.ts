/**
 * Ported from the retired SPA's `tests/dashboard/custom-range.test.js` +
 * `tests/dashboard/range-label.test.js` - same assertions, adapted to TypeScript/vitest.
 */
import { describe, expect, it } from "vitest";
import { customRangeState, customRangePatch, formatRangeLabel } from "./custom-range-core";
import type { DashboardFilters } from "./types";

const f = (range: string, from = "", to = ""): Pick<DashboardFilters, "range" | "customRange"> => ({
  range,
  customRange: { from, to },
});

describe("customRangeState", () => {
  it("a complete custom range is active, shown on Custom, and narrows the data", () => {
    expect(customRangeState(f("custom", "2026-09-01", "2026-09-10"))).toEqual({
      from: "2026-09-01",
      to: "2026-09-10",
      customActive: true,
      rangeActive: true,
      shownRange: "custom",
    });
  });

  it("a dangling ?range=custom without dates is Flight for display and filters nothing", () => {
    const cases = [f("custom"), f("custom", "2026-09-01"), f("custom", "", "2026-09-10"), { range: "custom" } as never];
    for (const filters of cases) {
      const s = customRangeState(filters);
      expect(s.customActive).toBe(false);
      expect(s.rangeActive).toBe(false);
      expect(s.shownRange).toBe("all");
    }
  });

  it("quick ranges and Flight pass through", () => {
    expect(customRangeState(f("7"))).toEqual({ from: "", to: "", customActive: false, rangeActive: true, shownRange: "7" });
    expect(customRangeState(f("all"))).toEqual({ from: "", to: "", customActive: false, rangeActive: false, shownRange: "all" });
    expect(customRangeState(undefined).shownRange).toBe("all");
  });
});

describe("customRangePatch", () => {
  it("a complete pick applies custom whatever was active before", () => {
    const patch = { range: "custom", customRange: { from: "2026-09-03", to: "2026-09-10" } };
    expect(customRangePatch(f("all"), { from: "2026-09-03", to: "2026-09-10" })).toEqual(patch);
    expect(customRangePatch(f("7"), { from: "2026-09-03", to: "2026-09-10" })).toEqual(patch);
    expect(customRangePatch(f("custom", "2026-09-01", "2026-09-02"), { from: "2026-09-03", to: "2026-09-10" })).toEqual(patch);
  });

  it("the calendar's Reset clears a custom range back to Flight and is a no-op otherwise", () => {
    expect(customRangePatch(f("custom", "2026-09-01", "2026-09-10"), { from: "", to: "" })).toEqual({
      range: "all",
      customRange: { from: "", to: "" },
    });
    expect(customRangePatch(f("7"), { from: "", to: "" })).toBeNull();
    expect(customRangePatch(f("all"), { from: "", to: "" })).toBeNull();
    expect(customRangePatch(f("all"), { from: "2026-09-03", to: "" })).toBeNull();
  });
});

describe("formatRangeLabel", () => {
  const TODAY = "2026-09-11";

  it("a range inside the current year drops the year", () => {
    expect(formatRangeLabel("2026-09-01", "2026-09-10", TODAY)).toBe("Sep 1 – Sep 10");
    expect(formatRangeLabel("2026-08-28", "2026-09-03", TODAY)).toBe("Aug 28 – Sep 3");
  });

  it("a single day reads as one date", () => {
    expect(formatRangeLabel("2026-09-10", "2026-09-10", TODAY)).toBe("Sep 10");
    expect(formatRangeLabel("2025-12-31", "2025-12-31", TODAY)).toBe("Dec 31, 2025");
  });

  it("a range in another year carries the year once, at the end", () => {
    expect(formatRangeLabel("2025-07-01", "2025-07-31", TODAY)).toBe("Jul 1 – Jul 31, 2025");
  });

  it("a range that crosses a year boundary carries both years", () => {
    expect(formatRangeLabel("2025-12-28", "2026-01-03", TODAY)).toBe("Dec 28, 2025 – Jan 3, 2026");
  });

  it("an inverted pair is shown in calendar order", () => {
    expect(formatRangeLabel("2026-09-10", "2026-09-01", TODAY)).toBe("Sep 1 – Sep 10");
  });

  it("an incomplete or malformed range answers an empty string", () => {
    expect(formatRangeLabel("", "2026-09-10", TODAY)).toBe("");
    expect(formatRangeLabel("2026-09-01", "", TODAY)).toBe("");
    expect(formatRangeLabel("nope", "2026-09-10", TODAY)).toBe("");
    expect(formatRangeLabel(undefined as unknown as string, undefined as unknown as string, TODAY)).toBe("");
  });

  it("the reference day defaults to the real today", () => {
    const y = new Date().getFullYear();
    expect(formatRangeLabel(`${y}-03-01`, `${y}-03-05`)).toBe("Mar 1 – Mar 5");
  });
});
