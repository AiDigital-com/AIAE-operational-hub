import { describe, expect, it } from "vitest";
import { orderAssetLinks } from "./asset-links";
import { PRESET_ORDER } from "./constants/asset-presets";

/**
 * Golden cases carried over from the reference implementation's `tests/asset-links-test.mjs`:
 * DSP links first (alphabetical), then presets in `PRESET_ORDER`, then everything else
 * (alphabetical), with url-less entries dropped.
 */
describe("orderAssetLinks", () => {
  it("should order DSP → preset → other and drop url-less entries", () => {
    // Given: a mixed list, deliberately shuffled
    const links = [
      { name: "Asana", url: "a" },
      { name: "DV360 — Client X", url: "d" },
      { name: "Random Doc", url: "r" },
      { name: "TTD", url: "t" },
      { name: "Slack", url: "s" },
      { name: "Empty", url: "" },
    ];

    // When:
    const out = orderAssetLinks(links);

    // Then: the exact reference order, and the url-less entry is gone
    expect(out.map((link) => link.name)).toEqual(["DV360 — Client X", "TTD", "Asana", "Slack", "Random Doc"]);
    expect(out.some((link) => link.name === "Empty")).toBe(false);
  });

  it("should classify each link and carry the canonical DSP key", () => {
    // Given:
    const links = [
      { name: "TTD", url: "t" },
      { name: "DV360 — Client X", url: "d" },
      { name: "Asana", url: "a" },
      { name: "Random Doc", url: "r" },
    ];

    // When:
    const out = orderAssetLinks(links);

    // Then:
    expect(out.find((link) => link.name === "TTD")?.kind).toBe("dsp");
    expect(out.find((link) => link.name === "TTD")?.dsp).toBe("ttd");
    expect(out.find((link) => link.name === "DV360 — Client X")?.kind).toBe("dsp");
    expect(out.find((link) => link.name === "Asana")?.kind).toBe("preset");
    expect(out.find((link) => link.name === "Random Doc")?.kind).toBe("other");
  });

  it("should answer an empty list for empty and null input", () => {
    expect(orderAssetLinks([])).toEqual([]);
    expect(orderAssetLinks(null)).toEqual([]);
  });

  it("should export the four preset names in their display order", () => {
    // Then: exactly the reference's set - the plan's fifth "Dashboard" slot was deliberately
    // not added (owner decision: follow the reference)
    expect([...PRESET_ORDER]).toEqual(["Asana", "IO", "Media Plan", "Slack"]);
  });
});
