import { describe, expect, it } from "vitest";
import { campPacing, paceOf, pdCompute } from "./pacing";
import { buildSetup } from "./setup";
import type { MockCam, PdInput } from "./types";

function aMockCam(overrides: Partial<MockCam> = {}): MockCam {
  return {
    id: "4821",
    name: "Summer Getaways 2026",
    status: "live",
    start: "2026-06-01",
    end: "2026-08-31",
    budget: 240_000,
    channels: ["Display", "Video"],
    ...overrides,
  };
}

describe("paceOf", () => {
  it("should classify as no-data when the budget is zero", () => {
    // Given / When / Then:
    expect(paceOf({ budget: 0, pp: 5 })).toBe("nodata");
  });

  it("should classify as no-data when the pacing figure is null", () => {
    // Given / When / Then:
    expect(paceOf({ budget: 1000, pp: null })).toBe("nodata");
  });

  it("should classify as over above +2pp", () => {
    // Given / When / Then:
    expect(paceOf({ budget: 1000, pp: 2.1 })).toBe("over");
  });

  it("should classify as under below -2pp", () => {
    // Given / When / Then:
    expect(paceOf({ budget: 1000, pp: -2.1 })).toBe("under");
  });

  it("should classify as on within the ±2pp band", () => {
    // Given / When / Then:
    expect(paceOf({ budget: 1000, pp: 1.5 })).toBe("on");
    expect(paceOf({ budget: 1000, pp: -1.5 })).toBe("on");
    expect(paceOf({ budget: 1000, pp: 0 })).toBe("on");
  });
});

describe("campPacing", () => {
  it("should return identical numbers across repeated calls for the same campaign", () => {
    // Given:
    const cam = aMockCam();

    // When:
    const first = campPacing(cam);
    const second = campPacing(cam);

    // Then:
    expect(first).toEqual(second);
  });

  it("should return different pacing for different campaign ids", () => {
    // Given:
    const a = aMockCam({ id: "1001" });
    const b = aMockCam({ id: "2002" });

    // When:
    const pacingA = campPacing(a);
    const pacingB = campPacing(b);

    // Then:
    expect(pacingA.pp).not.toBe(pacingB.pp);
  });

  it("should count line items as the flattened total from buildSetup", () => {
    // Given:
    const cam = aMockCam({ channels: ["Display", "Video"] });

    // When:
    const pacing = campPacing(cam);
    const expectedLiCount = buildSetup(cam).ios.flatMap((io) => io.lis).length;

    // Then:
    expect(pacing.li).toBe(expectedLiCount);
  });

  it("should always resolve pace to on for a done (archived) campaign", () => {
    // Given:
    const cam = aMockCam({ status: "archived" });

    // When:
    const pacing = campPacing(cam);

    // Then:
    expect(pacing.pace).toBe("on");
  });

  it("should format the flight range from the campaign's start and end dates", () => {
    // Given:
    const cam = aMockCam({ start: "2026-06-01", end: "2026-08-31" });

    // When:
    const pacing = campPacing(cam);

    // Then:
    expect(pacing.flight).toBe("06/01–08/31");
  });
});

describe("pdCompute", () => {
  function aPdInput(overrides: Partial<PdInput> = {}): PdInput {
    return {
      start: "2026-07-01",
      end: "2026-07-31",
      budget: 31_000,
      pp: 4,
      marginA: 77.8,
      marginT: 90,
      ...overrides,
    };
  }

  it("should keep actualByDay consistent with aboveExpected", () => {
    // Given:
    const pd = aPdInput();

    // When:
    const metrics = pdCompute(pd);

    // Then:
    expect(metrics.actualByDay - metrics.expectedByDay).toBe(metrics.aboveExpected);
  });

  it("should keep actualToday consistent with aboveDaily", () => {
    // Given:
    const pd = aPdInput();

    // When:
    const metrics = pdCompute(pd);

    // Then:
    expect(metrics.actualToday - metrics.dailyTarget).toBe(metrics.aboveDaily);
  });

  it("should compute marginDiff as actual minus target", () => {
    // Given:
    const pd = aPdInput({ marginA: 77.8, marginT: 90 });

    // When:
    const metrics = pdCompute(pd);

    // Then:
    expect(metrics.marginDiff).toBeCloseTo(-12.2, 5);
  });

  it("should return a null marginDiff when there is no margin data", () => {
    // Given:
    const pd = aPdInput({ marginA: null });

    // When:
    const metrics = pdCompute(pd);

    // Then:
    expect(metrics.marginDiff).toBeNull();
  });

  it("should never let daysLeftN go negative even past the flight end", () => {
    // Given: a flight that ended long ago
    const pd = aPdInput({ start: "2000-01-01", end: "2000-01-31" });

    // When:
    const metrics = pdCompute(pd);

    // Then:
    expect(metrics.daysLeftN).toBe(0);
    expect(metrics.dayN).toBe(metrics.flightDays);
  });
});
