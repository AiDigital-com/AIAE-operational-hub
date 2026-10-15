import { describe, expect, it } from "vitest";
import { seedDifferText, seedPrimaryCv } from "./cv-actions";

const ON = { primary_cv_enabled: true, fetch_conversions: true };

describe("seedPrimaryCv (the reference's seedSelection)", () => {
  it("seeds the choice most line items on the same source share", () => {
    // Given: two of three line items chose Purchase, one chose Lead
    const plans = { "1": { primaryCv: ["Purchase"] }, "2": { primaryCv: ["Purchase"] }, "3": { primaryCv: ["Lead"] } };

    // When:
    const result = seedPrimaryCv(plans, ON, "9");

    // Then:
    expect(result).toEqual({ seed: ["Purchase"], reason: "seeded" });
  });

  it("seeds nothing and says the line items differ on a tie", () => {
    // Given:
    const plans = { "1": { primaryCv: ["Purchase"] }, "2": { primaryCv: ["Lead"] } };

    // When / Then:
    expect(seedPrimaryCv(plans, ON, "9")).toEqual({ seed: null, reason: "differ" });
  });

  it("seeds nothing while the pacing switch is off", () => {
    // Given:
    const plans = { "1": { primaryCv: ["Purchase"] } };

    // When / Then:
    expect(seedPrimaryCv(plans, { fetch_conversions: true }, "9")).toEqual({ seed: null, reason: "none" });
  });

  it("seeds nothing for a line item with no conversion data", () => {
    // Given: conversions are not fetched and no sheet maps any for it
    const plans = { "1": { primaryCv: ["Purchase"] } };

    // When / Then:
    expect(seedPrimaryCv(plans, { primary_cv_enabled: true }, "9")).toEqual({ seed: null, reason: "none" });
  });

  it("counts only line items fed by the same source", () => {
    // Given: line 2 is fed by a sheet tab, so its choice does not vote for a BigQuery line
    const data = {
      ...ON,
      sheet: { tabs: [{ sheet_id: 7, line_item_id: "2", conversion_actions: ["Signup"] }] },
    };
    const plans = { "1": { primaryCv: ["Purchase"] }, "2": { primaryCv: ["Signup"] } };

    // When / Then:
    expect(seedPrimaryCv(plans, data, "9")).toEqual({ seed: ["Purchase"], reason: "seeded" });
  });

  it("says the reference's sentence for one and for several line items", () => {
    expect(seedDifferText(1)).toBe("The new line item has no primary conversions: line items differ");
    expect(seedDifferText(3)).toBe("3 new line items have no primary conversions: line items differ");
  });
});
