import { describe, expect, it } from "vitest";
import { hasVideoCompletesInFacts, planAutoAdd } from "./auto-add";
import type { PacingDisplayShape } from "../types";

const CPM_PLAN = { 1: { id: "1", ch: "Display", rateType: "CPM" } };
const CPC_PLAN = { 1: { id: "1", ch: "Display", rateType: "CPC" } };
const NO_FACTS = { liDaily: {} };

describe("planAutoAdd", () => {
  it("mints «Delivery vs CM360» under its fixed id once a 3rd-party source is configured", () => {
    // Given:
    const display: PacingDisplayShape = { rev: 3, widgets: [{ id: "w_finance" }] };

    // When:
    const plan = planAutoAdd(display, CPM_PLAN, NO_FACTS, [{ id: "cm1" }]);

    // Then:
    expect(plan?.fresh).toEqual(["std:v2:third-party"]);
    expect(plan?.added.map((w) => w.id)).toEqual(["w_thirdparty"]);
    expect(plan?.added[0].title).toBe("Delivery vs CM360");
    expect(plan?.staleOff).toEqual([]);
  });

  it("adds nothing without a source, and nothing again once the receipt is stored", () => {
    expect(planAutoAdd({ widgets: [] }, CPM_PLAN, NO_FACTS, [])).toBeNull();
    const receipted = { widgets: [], autoAdded: ["std:v2:third-party"] } as PacingDisplayShape;
    // The user deleted the tile after it was added: the receipt makes that stick.
    expect(planAutoAdd(receipted, CPM_PLAN, NO_FACTS, [{ id: "cm1" }])).toBeNull();
  });

  it("writes only the receipt when the fixed id is already on the board", () => {
    // Given: the user added the comparison from the Standard shelf before configuring the source
    const display: PacingDisplayShape = { widgets: [{ id: "w_thirdparty" }] };

    // When:
    const plan = planAutoAdd(display, CPM_PLAN, NO_FACTS, [{ id: "cm1" }]);

    // Then:
    expect(plan?.fresh).toEqual(["std:v2:third-party"]);
    expect(plan?.added).toEqual([]);
  });

  it("collects an off-switch left on the fixed id, so the new tile is not born invisible", () => {
    const display: PacingDisplayShape = { widgets: [], enabled: { w_thirdparty: false } };
    expect(planAutoAdd(display, CPM_PLAN, NO_FACTS, [{ id: "cm1" }])?.staleOff).toEqual(["w_thirdparty"]);
  });

  it("adds the click charts when a CPC line first appears", () => {
    const plan = planAutoAdd({ widgets: [] }, CPC_PLAN, NO_FACTS, []);
    expect(plan?.added.map((w) => w.id)).toEqual(
      expect.arrayContaining(["w_chartcpc", "w_chartcumclicks", "w_chartdailyclicks"])
    );
  });
});

describe("hasVideoCompletesInFacts", () => {
  it("is unknown without facts, and ignores audio lines' completes", () => {
    expect(hasVideoCompletesInFacts(null, CPM_PLAN)).toBeNull();
    const audio = { 1: { ch: "Audio" } };
    expect(hasVideoCompletesInFacts({ liDaily: { 1: { "2026-03-01": { co: 5 } } } }, audio)).toBe(false);
    expect(hasVideoCompletesInFacts({ liDaily: { 1: { "2026-03-01": { co: 5 } } } }, CPM_PLAN)).toBe(true);
  });
});
