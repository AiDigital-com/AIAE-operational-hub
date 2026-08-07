import { describe, expect, it } from "vitest";
import {
  constructedNameParts,
  fmtMetric,
  inheritedDimValues,
  inheritedNamePrefix,
  levelDimLabel,
  resolveLevelTerms,
  rowMetricCell,
} from "./reports";

describe("report metrics", () => {
  it("should render a ratio the server computed, rather than deriving a second answer", () => {
    // Given: a row whose ratios came down with it. They are built on dynamic_cost with Added Value free
    // and gated by channel, so re-deriving them here from spend would disagree with the report.
    const row = { spend: 25, dynamic_cost: 30, clicks: 20, impressions: 1000, cpc: 1.5, cpm: 30 };

    // When / Then: the server's figures, not spend/clicks
    expect(rowMetricCell(row, "cpc")).toBe("$1.50");
    expect(rowMetricCell(row, "cpm")).toBe("$30.00");
  });

  it("should leave a ratio blank when the row does not have that metric at all", () => {
    // Given: a search line - it spends and it clicks, but a CPM on search means nothing, so the server
    // sends none. Blank, not zero: "no CPM" and "a CPM of zero" are different claims.
    const row = { spend: 25, clicks: 20, impressions: 1000, cpc: 1.25 };

    // When / Then:
    expect(rowMetricCell(row, "cpm")).toBe("—");
    expect(rowMetricCell(row, "cpv")).toBe("—");
    expect(rowMetricCell(row, "cpc")).toBe("$1.25");
  });

  it("should still render plain counted metrics off the row", () => {
    // Given / When / Then:
    expect(rowMetricCell({ impressions: 1234 }, "impressions")).toBe("1,234");
  });

  it("should format cost per click and cost per view as money", () => {
    // Given / When / Then:
    expect(fmtMetric("cpc", 1.25)).toBe("$1.25");
    expect(fmtMetric("cpv", 0.05)).toBe("$0.05");
  });

  it("should preserve fractional conversion values", () => {
    // Given / When / Then:
    expect(fmtMetric("conversions", 12.345)).toBe("12.35");
    expect(fmtMetric("post_click_conversions", 1.2)).toBe("1.20");
    expect(fmtMetric("post_view_conversions", 0.125)).toBe("0.13");
  });

  it("should keep count metrics as integers", () => {
    // Given / When / Then:
    expect(fmtMetric("impressions", 1234.56)).toBe("1,235");
  });
});

describe("resolveLevelTerms", () => {
  it("should resolve a single platform to its own hierarchy", () => {
    // Given / When / Then: on DV360 the levels run line item -> insertion order -> creative
    expect(resolveLevelTerms(["dv_360_dlv"])).toEqual({
      l1: "Line item",
      l2: "Insertion order",
      l3: "Creative",
    });
  });

  it("should resolve a platform whose level 1 is not the line item", () => {
    // Given / When / Then: Google Ads runs campaign -> ad set -> ad, and Amazon starts at the order
    expect(resolveLevelTerms(["Google Ads"])).toEqual({ l1: "Campaign", l2: "Ad set", l3: "Ad" });
    expect(resolveLevelTerms(["Amazon"])).toEqual({ l1: "Insertion order", l2: "Line item", l3: "Creative" });
  });

  it("should still resolve when several platforms agree, such as DV360's two instances", () => {
    // Given / When / Then:
    expect(resolveLevelTerms(["dv_360_dlv", "dv_360_jellyfish"])?.l1).toBe("Line item");
    expect(resolveLevelTerms(["Vistar", "Viant"])?.l1).toBe("Campaign");
  });

  it("should give up when the platforms disagree about what a level means", () => {
    // Given: level 1 is the line item on DV360 but the campaign on Google Ads
    // When / Then:
    expect(resolveLevelTerms(["dv_360_dlv", "Google Ads"])).toBeNull();
  });

  it("should give up on a platform that is not in the naming-levels table", () => {
    // Given: Snapchat, Reddit, Apple Ads, Criteo and Publica are absent from it - never guessed at
    // When / Then:
    expect(resolveLevelTerms(["Snapchat"])).toBeNull();
    expect(resolveLevelTerms(["dv_360_dlv", "Snapchat"])).toBeNull();
    expect(resolveLevelTerms([])).toBeNull();
  });
});

describe("levelDimLabel", () => {
  it("should name a level column after the platform's own term once it is resolved", () => {
    // Given:
    const terms = resolveLevelTerms(["dv_360_dlv"]);

    // When / Then:
    expect(levelDimLabel("line_item_id", "Constructed id L1", terms)).toBe("Line item id");
    expect(levelDimLabel("insertion_order_name", "Constructed name L2", terms)).toBe("Insertion order name");
    expect(levelDimLabel("campaign_constructed_name", "Constructed name L3", terms)).toBe("Creative name");
  });

  it("should keep the neutral level label when the platform mix is ambiguous", () => {
    // Given / When / Then:
    expect(levelDimLabel("line_item_id", "Constructed id L1", null)).toBe("Constructed id L1");
  });

  it("should leave every non-level dimension alone", () => {
    // Given:
    const terms = resolveLevelTerms(["dv_360_dlv"]);

    // When / Then: `campaign_name` is the campaign's real name, not a constructed level
    expect(levelDimLabel("campaign_name", "Campaign", terms)).toBe("Campaign");
    expect(levelDimLabel("date", "Date", terms)).toBe("Date");
  });
});

describe("inheritedDimValues", () => {
  it("should inherit the agency/client fields every row agrees on", () => {
    // Given: two rows of the same campaign
    const rows = [
      { account: "Proxim Agency", account_id: "8256421370", client: "FPCU", agency_id: "ProximAgency" },
      { account: "Proxim Agency", account_id: "8256421370", client: "FPCU", agency_id: "ProximAgency" },
    ];

    // When:
    const inherited = inheritedDimValues(rows);

    // Then:
    expect(inherited).toEqual({
      account: "Proxim Agency",
      account_id: "8256421370",
      client: "FPCU",
      agency_id: "ProximAgency",
    });
  });

  it("should not inherit a field the rows disagree on, so a new line is never locked to one of several", () => {
    // Given: one campaign running on two DSPs has two different DSP accounts
    const rows = [
      { account: "Proxim Agency", account_id: "8256421370", client: "FPCU" },
      { account: "Proxim Google", account_id: "99", client: "FPCU" },
    ];

    // When:
    const inherited = inheritedDimValues(rows);

    // Then: only the genuinely campaign-wide field is inherited
    expect(inherited).toEqual({ client: "FPCU" });
  });

  it("should ignore blank and missing values rather than inheriting an empty string", () => {
    // Given:
    const rows = [{ client: "", account: undefined, agency_id: "ProximAgency" }];

    // When:
    const inherited = inheritedDimValues(rows);

    // Then:
    expect(inherited).toEqual({ agency_id: "ProximAgency" });
  });

  it("should inherit nothing when there are no rows to learn from", () => {
    // Given / When / Then:
    expect(inheritedDimValues([])).toEqual({});
  });
});

describe("constructed name segments", () => {
  it("should split a full constructed name into the sixteen fields the view derives from it", () => {
    // Given: a name carrying the whole convention
    const name = "AGY_FPCU_FIN_Q1 Launch_CTV_Prospecting_CPM_Auto Intenders_LI99_x_US_300x250_Msg_KW_F1_EN";

    // When:
    const parts = constructedNameParts(name);

    // Then:
    expect(parts.agency_id).toBe("AGY");
    expect(parts.client).toBe("FPCU");
    expect(parts.campaign_name).toBe("Q1 Launch");
    expect(parts.channel).toBe("CTV");
    expect(parts.tactic).toBe("Prospecting");
    expect(parts.language).toBe("EN");
  });

  it("should leave trailing fields blank for a half-typed name rather than failing", () => {
    // Given: only the first four segments typed so far - BigQuery's SAFE_OFFSET yields null past the end
    const parts = constructedNameParts("AGY_FPCU_FIN_Q1 Launch_");

    // When / Then:
    expect(parts.campaign_name).toBe("Q1 Launch");
    expect(parts.channel).toBe("");
    expect(parts.language).toBe("");
  });

  it("should seed a new line's name with the segments the campaign already fixes", () => {
    // Given: rows agreeing on agency, client, industry and campaign
    const rows = [
      { agency_id: "AGY", client: "FPCU", industry_code: "FIN", campaign_name: "Q1 Launch" },
      { agency_id: "AGY", client: "FPCU", industry_code: "FIN", campaign_name: "Q1 Launch" },
    ];

    // When:
    const prefix = inheritedNamePrefix(rows);

    // Then: the four known segments, left open for the user to continue
    expect(prefix).toBe("AGY_FPCU_FIN_Q1 Launch_");
  });

  it("should stop the prefix at the first segment the rows disagree on, since a name is positional", () => {
    // Given: one campaign name across two clients - segment 1 is ambiguous, so segments 2+ cannot follow
    const rows = [
      { agency_id: "AGY", client: "FPCU", industry_code: "FIN", campaign_name: "Q1 Launch" },
      { agency_id: "AGY", client: "OTHER", industry_code: "FIN", campaign_name: "Q1 Launch" },
    ];

    // When / Then: only the agency, not agency + industry with the client silently skipped
    expect(inheritedNamePrefix(rows)).toBe("AGY_");
  });

  it("should seed nothing when the campaign has no rows to learn from", () => {
    // Given / When / Then:
    expect(inheritedNamePrefix([])).toBe("");
  });
});
