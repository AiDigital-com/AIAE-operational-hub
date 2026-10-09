/**
 * Choosing primary conversions, and what that choice sends (Pacing spec 2026-09-13 §2).
 *
 * The wire rule is the whole subtlety here and it is not the one the other per-line-item fields use:
 * `primary_conversions` rides ONLY when the list actually moved as a SET against what Pacing
 * reported - not when the pacing switch is on, and not unconditionally the way `cost_coef` does.
 * That is what lets a tab opened before the feature existed save a plan without wiping every stored
 * choice: it sends no key, and Pacing's own key-presence back-fill keeps what it has.
 *
 * The counterpart to that is the clear: an empty list is a real choice ("count everything again") and
 * must reach the server as a PRESENT key, or it would be indistinguishable from silence.
 */
import { describe, expect, it } from "vitest";
import { actionsByLi, unmatched } from "./cv-actions";
import { sameCvChoice, seedFromPlan, toPlanUpdateLineItem, type EditableLineItem } from "./line-item-fields";
import type { PacingLineItemPlanV1 } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

function aPlan(over: Partial<PacingLineItemPlanV1> = {}): PacingLineItemPlanV1 {
  return {
    lineItemId: "100",
    channel: "Meta",
    rateType: "CPM",
    clientBudget: 10_000,
    plannedImpressions: 1_000_000,
    marginTargetPct: 25,
    flightStart: "2026-08-01",
    flightEnd: "2026-08-31",
    containers: [],
    ...over,
  } as unknown as PacingLineItemPlanV1;
}

function wireOf(li: EditableLineItem) {
  return toPlanUpdateLineItem(li, false) as Record<string, unknown>;
}

describe("the choosable actions", () => {
  const rows = [
    { line_item_id: "100", date: "2026-08-01", conversion_action: " Purchase ", conversions: 2 },
    { line_item_id: "100", date: "2026-08-02", conversion_action: "Purchase", conversions: 3 },
    { line_item_id: "100", date: "2026-08-01", conversion_action: "Page View", conversions: 40 },
    { line_item_id: "200", date: "2026-08-01", conversion_action: "Lead", conversions: 1 },
    { line_item_id: "100", date: "2026-08-01", conversion_action: "   ", conversions: 9 },
  ];

  it("groups by line item and sums each action, biggest first", () => {
    const byLi = actionsByLi(rows);
    expect(byLi.get("100")).toEqual([
      { name: "Page View", conversions: 40 },
      // 2 + 3: the untrimmed spelling is the SAME action, because every reader downstream matches on
      // the trimmed name.
      { name: "Purchase", conversions: 5 },
    ]);
    expect(byLi.get("200")).toEqual([{ name: "Lead", conversions: 1 }]);
  });

  it("drops a blank action - it is not something anyone can choose", () => {
    expect(actionsByLi(rows).get("100")?.some((a) => !a.name.trim())).toBe(false);
  });

  it("names a choice the delivered rows no longer have", () => {
    const actions = actionsByLi(rows).get("100") ?? [];
    // Silence here would read as zero conversions on the dashboard with nothing to explain it.
    expect(unmatched(["Purchase", "Renamed Action"], actions)).toEqual(["Renamed Action"]);
    expect(unmatched(["Purchase"], actions)).toEqual([]);
  });
});

describe("seeding the editor", () => {
  it("binds to the STORED list, so a choice made while the switch was off is still there", () => {
    const li = seedFromPlan(aPlan({
      storedPrimaryConversions: ["Purchase"],
      // The operative list is absent precisely because the switch is off.
    } as Any));
    expect(li.primaryCv).toEqual(["Purchase"]);
    expect(li.primaryCvStored).toEqual(["Purchase"]);
  });

  it("a line item that never chose anything starts empty", () => {
    const li = seedFromPlan(aPlan());
    expect(li.primaryCv).toEqual([]);
  });
});

describe("what the save sends", () => {
  it("an untouched line item sends no key at all", () => {
    const li = seedFromPlan(aPlan({ storedPrimaryConversions: ["Purchase"] } as Any));
    expect("primaryConversions" in wireOf(li)).toBe(false);
  });

  it("a line item with no choice, untouched, sends no key either", () => {
    expect("primaryConversions" in wireOf(seedFromPlan(aPlan()))).toBe(false);
  });

  it("re-ordering the same actions is not a change", () => {
    const li = seedFromPlan(aPlan({ storedPrimaryConversions: ["Purchase", "Lead"] } as Any));
    li.primaryCv = ["Lead", "Purchase"];
    expect("primaryConversions" in wireOf(li)).toBe(false);
  });

  it("a real edit rides", () => {
    const li = seedFromPlan(aPlan({ storedPrimaryConversions: ["Purchase"] } as Any));
    li.primaryCv = ["Purchase", "Lead"];
    expect(wireOf(li).primaryConversions).toEqual(["Purchase", "Lead"]);
  });

  it("clearing the choice rides as a PRESENT empty list, not as silence", () => {
    const li = seedFromPlan(aPlan({ storedPrimaryConversions: ["Purchase"] } as Any));
    li.primaryCv = [];
    const wire = wireOf(li);
    expect("primaryConversions" in wire).toBe(true);
    expect(wire.primaryConversions).toEqual([]);
  });

  it("rides whatever the pacing switch says - the switch gates the UI, not the save", () => {
    const li = seedFromPlan(aPlan({ storedPrimaryConversions: [] } as Any));
    li.primaryCv = ["Purchase"];
    // `false` is the net-feature flag, the only gate this function takes; the choice is unaffected.
    expect((toPlanUpdateLineItem(li, false) as Record<string, unknown>).primaryConversions).toEqual(["Purchase"]);
    expect((toPlanUpdateLineItem(li, true) as Record<string, unknown>).primaryConversions).toEqual(["Purchase"]);
  });
});

describe("sameCvChoice", () => {
  it("compares as sets, never by order", () => {
    expect(sameCvChoice(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameCvChoice(["a"], ["a", "b"])).toBe(false);
    expect(sameCvChoice([], [])).toBe(true);
  });
});
