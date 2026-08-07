import { describe, expect, it } from "vitest";
import { aCampaignV1 } from "../../../test/factories";
import { toPacingCampaign } from "./adapter";

describe("toPacingCampaign", () => {
  it("should carry the real campaign id as a string, for stable seeding", () => {
    // Given:
    const campaign = aCampaignV1({ id: 4821 });

    // When:
    const result = toPacingCampaign(campaign);

    // Then:
    expect(result.id).toBe("4821");
  });

  it("should map name, dates, channels, and parse the budget", () => {
    // Given:
    const campaign = aCampaignV1({
      name: "Summer Getaways 2026",
      start_date: "2026-06-01",
      end_date: "2026-08-31",
      budget: 250_000,
      channels: ["Display", "Video"],
    });

    // When:
    const result = toPacingCampaign(campaign);

    // Then:
    expect(result.name).toBe("Summer Getaways 2026");
    expect(result.start).toBe("2026-06-01");
    expect(result.end).toBe("2026-08-31");
    expect(result.budget).toBe(250_000);
    expect(result.channels).toEqual(["Display", "Video"]);
  });

  it("should default status to live when the real status is unrecognized", () => {
    // Given: a real, freeform status the mock's narrower vocabulary doesn't model
    const campaign = aCampaignV1({ status: "To Be Launched" });

    // When:
    const result = toPacingCampaign(campaign);

    // Then:
    expect(result.status).toBe("live");
  });

  it("should recognize a known status case-insensitively", () => {
    // Given:
    const campaign = aCampaignV1({ status: "Archived" });

    // When:
    const result = toPacingCampaign(campaign);

    // Then:
    expect(result.status).toBe("archived");
  });

  it("should default a missing budget to zero", () => {
    // Given:
    const campaign = aCampaignV1({ budget: undefined });

    // When:
    const result = toPacingCampaign(campaign);

    // Then:
    expect(result.budget).toBe(0);
  });

  it("should drop blank channel entries", () => {
    // Given:
    const campaign = aCampaignV1({ channels: ["Display", "", "Video"] });

    // When:
    const result = toPacingCampaign(campaign);

    // Then:
    expect(result.channels).toEqual(["Display", "Video"]);
  });
});
