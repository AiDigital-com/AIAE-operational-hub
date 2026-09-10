import { describe, expect, it } from "vitest";
import { seedFromCandidate, seedFromPlan, toPlanUpdateLineItem } from "./line-item-fields";
import type { PacingDraftLineItemV1, PacingLineItemPlanV1 } from "./types";

describe("seedFromPlan", () => {
  it("reads every field verbatim, falling back nativeBudget to clientBudget for a USD line item", () => {
    const plan: PacingLineItemPlanV1 = {
      lineItemId: "111",
      channel: "Display",
      rateType: "CPM",
      clientBudget: 5000,
      plannedImpressions: 1_000_000,
      marginTargetPct: 20,
      ctrTargetPct: 0.5,
      vcrTargetPct: null,
      flightStart: "2026-01-01",
      flightEnd: "2026-01-31",
      containers: [],
    };
    const li = seedFromPlan(plan);
    expect(li.lineItemId).toBe("111");
    expect(li.nativeBudget).toBe("5000");
    expect(li.targetImpressions).toBe("1000000");
    expect(li.marginTargetPct).toBe("20");
    expect(li.targetCtr).toBe("0.5");
    expect(li.targetVcr).toBe("");
    expect(li.isNew).toBe(false);
  });

  it("prefers nativeBudget over clientBudget when Pacing has both (a converted line item)", () => {
    const plan: PacingLineItemPlanV1 = {
      lineItemId: "222",
      clientBudget: 6500,
      nativeBudget: 5000,
      plannedImpressions: 0,
      containers: [],
    };
    expect(seedFromPlan(plan).nativeBudget).toBe("5000");
  });
});

describe("seedFromCandidate", () => {
  it("carries identity fields forward for a not-yet-added line item", () => {
    const candidate: PacingDraftLineItemV1 = {
      lineItemId: "7",
      channel: "Display",
      campaignId: "40539",
      campaignName: "2026_Campaign",
      orderNumber: "TM-1",
      description: "Northeast",
      rateType: "CPM",
      nativeBudget: 1000,
      targetImpressions: 50000,
    };
    const li = seedFromCandidate(candidate);
    expect(li.isNew).toBe(true);
    expect(li.campaignId).toBe("40539");
    expect(li.campaignName).toBe("2026_Campaign");
    expect(li.orderNumber).toBe("TM-1");
    expect(li.description).toBe("Northeast");
  });

  // add-li-map.js:14 - the retired SPA seeded 25 when NetSuite reported no margin. A blank margin is
  // not equivalent: it persists as 0% and overstates what the campaign earns.
  it("falls back to 25% margin when NetSuite reports none", () => {
    const li = seedFromCandidate({ lineItemId: "7", channel: "Display" });
    expect(li.marginTargetPct).toBe("25");
  });

  it("keeps NetSuite's own margin when it has one, including a zero", () => {
    expect(seedFromCandidate({ lineItemId: "7", marginPercent: 40 }).marginTargetPct).toBe("40");
    expect(seedFromCandidate({ lineItemId: "7", marginPercent: 0 }).marginTargetPct).toBe("0");
  });

  // The SPA's add-LI seed left these null even though its CREATE screen defaulted them to 0 - the two
  // seeds really do differ, and this one follows add-li-map.js.
  it("leaves CTR and VCR blank, unlike the create screen", () => {
    const li = seedFromCandidate({ lineItemId: "7" });
    expect(li.targetCtr).toBe("");
    expect(li.targetVcr).toBe("");
  });
});

describe("toPlanUpdateLineItem", () => {
  it("omits identity fields for an existing line item", () => {
    const li = seedFromPlan({
      lineItemId: "111",
      channel: "Display",
      plannedImpressions: 100,
      clientBudget: 100,
      containers: [],
    });
    const wire = toPlanUpdateLineItem(li);
    expect(wire.channel).toBeUndefined();
    expect(wire.description).toBeUndefined();
    expect(wire.campaignId).toBeUndefined();
    expect(wire.campaignName).toBeUndefined();
    expect(wire.lineItemId).toBe("111");
  });

  it("includes identity fields for a newly added line item", () => {
    const li = seedFromCandidate({
      lineItemId: "7",
      channel: "Display",
      campaignId: "40539",
      campaignName: "2026_Campaign",
    });
    const wire = toPlanUpdateLineItem(li);
    expect(wire.channel).toBe("Display");
    expect(wire.campaignId).toBe("40539");
    expect(wire.campaignName).toBe("2026_Campaign");
  });

  it("parses edited numeric strings back into numbers, never computing a new figure", () => {
    const li = seedFromPlan({
      lineItemId: "111",
      plannedImpressions: 100,
      clientBudget: 100,
      containers: [],
    });
    li.targetImpressions = "250,000";
    li.marginTargetPct = "";
    const wire = toPlanUpdateLineItem(li);
    expect(wire.targetImpressions).toBe(250000);
    expect(wire.marginTargetPct).toBeUndefined();
  });
});
