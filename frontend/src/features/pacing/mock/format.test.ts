import { describe, expect, it } from "vitest";
import {
  clamp,
  daysBetween,
  daysLeft,
  fmtBudget,
  fmtDate,
  fmtMD,
  fmtMoney,
  labelDay,
  parseMoney,
  todayISO,
} from "./format";

describe("format", () => {
  it("should format a plain date", () => {
    // Given / When / Then:
    expect(fmtDate("2026-04-23")).toBe("Apr 23, 2026");
  });

  it("should format a BigQuery timestamp as its date", () => {
    // Given: an audit stamp as BigQuery hands it over
    // When / Then: splitting on "-" alone left the day as "23 11:29:43.104000 UTC" and printed
    // "Apr NaN, 2026" - a number that looked like data
    expect(fmtDate("2026-04-23 11:29:43.104000 UTC")).toBe("Apr 23, 2026");
  });

  it("should format an ISO timestamp as its date", () => {
    // Given / When / Then:
    expect(fmtDate("2026-04-23T11:29:43Z")).toBe("Apr 23, 2026");
  });

  it("should leave an absent date empty rather than printing its own failure", () => {
    // Given / When / Then: a missing stamp is a fact about the row; "undefined NaN, " is not
    expect(fmtDate("")).toBe("");
  });

  it("should format millions with one decimal", () => {
    // Given / When / Then:
    expect(fmtBudget(1_250_000)).toBe("$1.3M");
  });

  it("should format thousands with one decimal", () => {
    // Given / When / Then:
    expect(fmtBudget(70_600)).toBe("$70.6K");
  });

  it("should format zero as a plain dollar zero", () => {
    // Given / When / Then:
    expect(fmtBudget(0)).toBe("$0");
  });

  it("should format small numbers without a suffix", () => {
    // Given / When / Then:
    expect(fmtBudget(950)).toBe("$950");
  });

  it("should format money with thousands separators", () => {
    // Given / When / Then:
    expect(fmtMoney(1_234_567)).toBe("$1,234,567");
  });

  it("should strip non-numeric characters when parsing money", () => {
    // Given / When / Then:
    expect(parseMoney("$1,250,000")).toBe(1250000);
  });

  it("should pass a plain number through when parsing money", () => {
    // Given / When / Then:
    expect(parseMoney(4200)).toBe(4200);
  });

  it("should return zero for unparsable money", () => {
    // Given / When / Then:
    expect(parseMoney("")).toBe(0);
  });

  it("should split an ISO date into month/day", () => {
    // Given / When / Then:
    expect(fmtMD("2026-07-01")).toBe("07/01");
  });

  it("should compute whole days between two ISO dates", () => {
    // Given / When / Then:
    expect(daysBetween("2026-07-01", "2026-07-31")).toBe(30);
  });

  it("should compute a negative day count when the range runs backward", () => {
    // Given / When / Then:
    expect(daysBetween("2026-07-31", "2026-07-01")).toBe(-30);
  });

  it("should label the nth day from a start date", () => {
    // Given / When / Then:
    expect(labelDay("2026-07-01", 20)).toBe("Jul 20");
  });

  it("should never return a negative days-left count", () => {
    // Given: a date far in the past
    const pastIso = "2000-01-01";

    // When:
    const result = daysLeft(pastIso);

    // Then:
    expect(result).toBe("0d");
  });

  it("should append a d suffix to a future days-left count", () => {
    // Given: a date far enough in the future that the day count is unambiguous
    const future = new Date();
    future.setFullYear(future.getFullYear() + 5);
    const iso = future.toISOString().slice(0, 10);

    // When:
    const result = daysLeft(iso);

    // Then:
    expect(result).toMatch(/^\d+d$/);
  });

  it("should clamp a value within the given bounds", () => {
    // Given / When / Then:
    expect(clamp(150, 45, 99)).toBe(99);
    expect(clamp(-10, 45, 99)).toBe(45);
    expect(clamp(70, 45, 99)).toBe(70);
  });

  it("should return today formatted as an ISO date", () => {
    // Given / When:
    const result = todayISO();

    // Then:
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
