import { describe, expect, it } from "vitest";
import { aCampaignV1 } from "../../../test/factories";
import { buildOverview } from "./overview";

describe("buildOverview", () => {
  it("should never invent a campaign - every row traces back to the real input", () => {
    // Given:
    const campaigns = [aCampaignV1({ id: 1 }), aCampaignV1({ id: 2 }), aCampaignV1({ id: 3 })];

    // When:
    const overview = buildOverview(campaigns);
    const rowIds = overview.campaigns.map((c) => c.id);

    // Then:
    expect(rowIds.sort()).toEqual(["1", "2", "3"]);
  });

  it("should roll up campaign count, line-item count, and budget across all campaigns", () => {
    // Given:
    const campaigns = [aCampaignV1({ id: 1 }), aCampaignV1({ id: 2 })];

    // When:
    const overview = buildOverview(campaigns);
    const expectedLineItems = overview.campaigns.reduce((sum, row) => sum + row.li, 0);
    const expectedBudget = overview.campaigns.reduce((sum, row) => sum + row.budget, 0);

    // Then:
    expect(overview.summary.campaigns).toBe(2);
    expect(overview.summary.lineItems).toBe(expectedLineItems);
    expect(overview.summary.budget).toBe(expectedBudget);
  });

  it("should treat a zero-budget campaign as no-data with null margin and pacing", () => {
    // Given:
    const campaigns = [aCampaignV1({ id: 1, budget: 0 })];

    // When:
    const overview = buildOverview(campaigns);
    const [row] = overview.campaigns;

    // Then:
    expect(row.marginA).toBeNull();
    expect(row.pp).toBeNull();
    expect(row.pace).toBe("nodata");
  });

  it("should carry the campaign's real line_item_count onto its row, not a mock-derived count", () => {
    // Given:
    const campaigns = [aCampaignV1({ id: 1, line_item_count: 4 })];

    // When:
    const overview = buildOverview(campaigns);
    const [row] = overview.campaigns;

    // Then:
    expect(row.li).toBe(4);
  });

  it("should default a null line_item_count to zero", () => {
    // Given:
    const campaigns = [aCampaignV1({ id: 1, line_item_count: null })];

    // When:
    const overview = buildOverview(campaigns);
    const [row] = overview.campaigns;

    // Then:
    expect(row.li).toBe(0);
  });

  it("should carry the real status, agency, and client names onto each row", () => {
    // Given:
    const campaigns = [
      aCampaignV1({ id: 1, status: "To Be Launched", agency_name: "King & Partners", client_name: "Sterlings" }),
    ];

    // When:
    const overview = buildOverview(campaigns);
    const [row] = overview.campaigns;

    // Then: the real status string is preserved verbatim, not narrowed to the mock's own vocabulary
    expect(row.status).toBe("To Be Launched");
    expect(row.agency).toBe("King & Partners");
    expect(row.client).toBe("Sterlings");
  });
});
