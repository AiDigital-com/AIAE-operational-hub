import { describe, expect, it } from "vitest";
import type { MockCam } from "./types";
import { buildSetup } from "./setup";

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

describe("buildSetup", () => {
  it("should create one insertion order per channel", () => {
    // Given:
    const cam = aMockCam({ channels: ["Display", "Video", "Search"] });

    // When:
    const result = buildSetup(cam);

    // Then:
    expect(result.ios).toHaveLength(3);
    expect(result.ios.map((io) => io.channel)).toEqual(["Display", "Video", "Search"]);
  });

  it("should split the campaign budget evenly across channels", () => {
    // Given:
    const cam = aMockCam({ budget: 240_000, channels: ["Display", "Video"] });

    // When:
    const result = buildSetup(cam);

    // Then: each IO's own budget is the sum of its LIs, which split $120,000 evenly across 2 tactics
    expect(result.ios[0].budget).toBe(120_000);
    expect(result.ios[1].budget).toBe(120_000);
  });

  it("should mark every other line item paused when the campaign is live", () => {
    // Given: Display has 2 tactics (Prospecting, Retargeting)
    const cam = aMockCam({ status: "live", channels: ["Display"] });

    // When:
    const [io] = buildSetup(cam).ios;

    // Then:
    expect(io.lis[0].status).toBe("live");
    expect(io.lis[1].status).toBe("paused");
  });

  it("should not pause any line item when the campaign is not live", () => {
    // Given:
    const cam = aMockCam({ status: "paused", channels: ["Display"] });

    // When:
    const [io] = buildSetup(cam).ios;

    // Then:
    expect(io.lis.every((li) => li.status === "paused")).toBe(true);
  });

  it("should produce identical output for the same campaign id across calls", () => {
    // Given:
    const cam = aMockCam();

    // When:
    const first = buildSetup(cam);
    const second = buildSetup(cam);

    // Then:
    expect(first).toEqual(second);
  });

  it("should produce different IO/LI ids for different campaigns", () => {
    // Given:
    const a = aMockCam({ id: "1001" });
    const b = aMockCam({ id: "2002" });

    // When:
    const resultA = buildSetup(a);
    const resultB = buildSetup(b);

    // Then:
    expect(resultA.ios[0].id).not.toBe(resultB.ios[0].id);
    expect(resultA.ios[0].lis[0].id).not.toBe(resultB.ios[0].lis[0].id);
  });

  it("should fall back to a General tactic for an unrecognized channel", () => {
    // Given:
    const cam = aMockCam({ channels: ["Podcast Network"] });

    // When:
    const [io] = buildSetup(cam).ios;

    // Then:
    expect(io.lis).toHaveLength(1);
    expect(io.lis[0].name).toBe("General");
  });

  it("should not divide by zero when the campaign has no channels", () => {
    // Given:
    const cam = aMockCam({ channels: [] });

    // When:
    const result = buildSetup(cam);

    // Then:
    expect(result.ios).toEqual([]);
  });
});
