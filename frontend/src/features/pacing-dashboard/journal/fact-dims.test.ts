import { describe, expect, it } from "vitest";
import { derivePlatforms, deriveDimValues, formatPlatform } from "./fact-dims";

const FACTS = [
  { line_item_id: "1", date: "2026-08-01", platform: "dv_360_dlv", tactic: "Prospecting", geo: "US" },
  { line_item_id: "1", date: "2026-08-02", platform: "TTD", tactic: "Prospecting", geo: "-" },
  { line_item_id: "2", date: "2026-08-01", platform: "dv_360_dlv", tactic: "", geo: "" },
];

describe("derivePlatforms", () => {
  it("returns distinct non-empty platforms, sorted", () => {
    expect(derivePlatforms(FACTS)).toEqual(["TTD", "dv_360_dlv"]);
  });
  it("returns an empty array for a missing/non-array input", () => {
    expect(derivePlatforms(undefined)).toEqual([]);
    expect(derivePlatforms(null)).toEqual([]);
  });
});

describe("deriveDimValues", () => {
  it("returns distinct non-empty values for a dim, sorted", () => {
    expect(deriveDimValues(FACTS, "tactic")).toEqual(["Prospecting"]);
  });
  it("skips '-' and empty values", () => {
    expect(deriveDimValues(FACTS, "geo")).toEqual(["US"]);
  });
  it("returns an empty array for an unknown dim", () => {
    expect(deriveDimValues(FACTS, "nonexistent")).toEqual([]);
  });
});

describe("formatPlatform", () => {
  it("prettifies a known raw platform slug", () => {
    expect(formatPlatform("dv_360_dlv")).toBe("DV360");
    expect(formatPlatform("TTD")).toBe("The Trade Desk");
  });
  it("passes an unknown raw value through unchanged", () => {
    expect(formatPlatform("some_new_dsp")).toBe("some_new_dsp");
  });
  it("returns an empty string for null/undefined", () => {
    expect(formatPlatform(null)).toBe("");
    expect(formatPlatform(undefined)).toBe("");
  });
});
