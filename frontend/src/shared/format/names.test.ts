import { describe, expect, it } from "vitest";
import { CAMPAIGN_WITHOUT_NAME, campaignDisplayName } from "./names";

describe("campaignDisplayName", () => {
  it("should return the real campaign name untouched", () => {
    // Given / When / Then:
    expect(campaignDisplayName("Ourisman Ford 2026")).toBe("Ourisman Ford 2026");
  });

  it("should fall back to the placeholder for an empty name", () => {
    // Given: BigQuery yields an empty string for a campaign with no naming-convention name
    // When / Then:
    expect(campaignDisplayName("")).toBe(CAMPAIGN_WITHOUT_NAME);
  });

  it("should fall back to the placeholder for a whitespace-only name", () => {
    // Given / When / Then:
    expect(campaignDisplayName("   ")).toBe(CAMPAIGN_WITHOUT_NAME);
  });

  it("should fall back to the placeholder for a null or undefined name", () => {
    // Given / When / Then:
    expect(campaignDisplayName(null)).toBe(CAMPAIGN_WITHOUT_NAME);
    expect(campaignDisplayName(undefined)).toBe(CAMPAIGN_WITHOUT_NAME);
  });

  it("should treat the literal string null as missing, never showing it as a name", () => {
    // Given: BigQuery sometimes yields the literal text "null" rather than a SQL NULL
    // When / Then:
    expect(campaignDisplayName("null")).toBe(CAMPAIGN_WITHOUT_NAME);
    expect(campaignDisplayName("NULL")).toBe(CAMPAIGN_WITHOUT_NAME);
  });

  it("should trim a padded real name", () => {
    // Given / When / Then:
    expect(campaignDisplayName("  Spring Sales Event  ")).toBe("Spring Sales Event");
  });
});
