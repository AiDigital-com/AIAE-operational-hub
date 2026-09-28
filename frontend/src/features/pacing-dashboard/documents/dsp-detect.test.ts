import { describe, expect, it } from "vitest";
import { detectDsp, dspLabel } from "./dsp-detect";

/**
 * Golden cases carried over from the reference implementation's `tests/dsp-detect-test.mjs` -
 * the port is behaviour-identical by definition of these cases, especially the whole-token rule
 * ("dv" matches the token "dv", never the "dv" inside "advanced").
 */
describe("detectDsp", () => {
  it("should recognise the DV360 spelling zoo", () => {
    // Given / When / Then: every way the team actually types it
    expect(detectDsp("dv360")).toBe("dv360");
    expect(detectDsp("DV360")).toBe("dv360");
    expect(detectDsp("dv 360")).toBe("dv360");
    expect(detectDsp("dv-360")).toBe("dv360");
    expect(detectDsp("dv")).toBe("dv360");
    expect(detectDsp("DV360 — Client X")).toBe("dv360");
    expect(detectDsp("Display & Video 360")).toBe("dv360");
    expect(detectDsp("Display and Video 360")).toBe("dv360");
  });

  it("should recognise The Trade Desk in all its forms", () => {
    expect(detectDsp("The Trade Desk")).toBe("ttd");
    expect(detectDsp("TTD")).toBe("ttd");
    expect(detectDsp("ttd")).toBe("ttd");
    expect(detectDsp("Trade Desk - APAC")).toBe("ttd");
  });

  it("should recognise the rest of the registry by alias", () => {
    expect(detectDsp("Beeswax")).toBe("beeswax");
    expect(detectDsp("Amazon DSP")).toBe("amazon");
    expect(detectDsp("amzn")).toBe("amazon");
    expect(detectDsp("Xandr")).toBe("xandr");
    expect(detectDsp("AppNexus")).toBe("xandr");
  });

  it("should not mistake presets or arbitrary names for DSPs", () => {
    expect(detectDsp("Asana")).toBeNull();
    expect(detectDsp("Media Plan")).toBeNull();
    expect(detectDsp("Slack")).toBeNull();
    expect(detectDsp("IO")).toBeNull();
  });

  it("should never match a short alias inside a longer word", () => {
    // Given: the whole reason matching is whole-token, not substring
    expect(detectDsp("advanced creative")).toBeNull();
    expect(detectDsp("individual report")).toBeNull();
  });

  it("should answer null for empty and null input", () => {
    expect(detectDsp("")).toBeNull();
    expect(detectDsp(null)).toBeNull();
  });
});

describe("dspLabel", () => {
  it("should return the canonical label for a known key and null otherwise", () => {
    expect(dspLabel("ttd")).toBe("The Trade Desk");
    expect(dspLabel("dv360")).toBe("DV360");
    expect(dspLabel("nope")).toBeNull();
  });
});
