import { describe, expect, it } from "vitest";
import { makeRng, seedFromId } from "./rng";

describe("rng", () => {
  it("should produce the same sequence for the same seed", () => {
    // Given:
    const seed = 4242;

    // When:
    const first = Array.from({ length: 5 }, makeRng(seed));
    const second = Array.from({ length: 5 }, makeRng(seed));

    // Then:
    expect(first).toEqual(second);
  });

  it("should produce values within the unit interval", () => {
    // Given:
    const rnd = makeRng(seedFromId("campaign-123"));

    // When:
    const values = Array.from({ length: 50 }, () => rnd());

    // Then:
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("should derive the same seed from the same id every time", () => {
    // Given:
    const id = "9001";

    // When:
    const first = seedFromId(id);
    const second = seedFromId(id);

    // Then:
    expect(first).toBe(second);
  });

  it("should derive different seeds for different ids", () => {
    // Given / When:
    const a = seedFromId("9001");
    const b = seedFromId("9002");

    // Then:
    expect(a).not.toBe(b);
  });
});
