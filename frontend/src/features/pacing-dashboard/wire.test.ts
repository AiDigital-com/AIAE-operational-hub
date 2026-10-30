/**
 * `wire.ts`, case for case the dashboard half of `PacingDashboardContractMapperTest` (the Java tests
 * deleted with the mapper on 2026-10-29), plus the rules the port had to make explicit: what Jackson
 * did to the wire on the way in, and what the Boot mapper wrote on the way out. The whole-body check
 * against real Pacing bodies is `wire.parity.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  bool,
  boolPrim,
  dbl,
  int32,
  parseDate,
  readDashboardWire,
  str,
  toJournalV1,
  WireError,
  type PacingDashboardWireV1,
} from "./wire";

const RESTRICTED = { ownPacingUserId: "pu-1", unrestricted: false };

/** The smallest body Pacing ever serves: `buildCampaign` always writes a campaign, the rest may be absent. */
function minimal(overrides: Record<string, unknown> = {}): PacingDashboardWireV1 {
  return {
    campaign: { id: "slug", pacingId: "p1", name: "Name", currency: "USD", rate: 1, status: "Live", orderNumber: "", sourceUrl: "", links: [] },
    planByLineItem: {},
    factsDaily: [],
    display: {},
    aggregate: {},
    journal: [],
    ...overrides,
  } as PacingDashboardWireV1;
}

const fullNotify = {
  alerts: {
    enabled: true,
    bid_fact_above_plan: { enabled: true, slack: true, window: 2, threshold_pct: 5 },
    data_gap: { enabled: true, slack: true, gap_days: 1 },
    ctr_below_target: { enabled: true, slack: true, factor: 0.7 },
    vcr_below_target: { enabled: true, slack: true, factor: 0.7 },
    ctr_above_target: { enabled: true, slack: true, factor: 2.0 },
    vcr_over_100: { enabled: true, slack: true },
    no_impressions_yet: { enabled: true, slack: true },
    pacing_off_pace: { enabled: true, slack: true, low: -5, high: 5 },
    margin_below_target: { enabled: true, slack: true, gap_pp: 3 },
    spend_overspend: { enabled: true, slack: true, warn_pct: 90, bad_pct: 100 },
    dsp_forecast_overspend: { enabled: true, slack: true },
    stale_data: { enabled: true, slack: true, days: 2 },
    rate_cost_above_plan: { enabled: true, slack: true, threshold_pct: 10 },
  },
  metrics: { vcr: true },
  hide_paused: true,
  summary_projection: "plan",
};

describe("readDashboardWire - the Java mapper's dashboard cases", () => {
  it("shouldMapFullDashboardPayloadTest", () => {
    // Given: everything the Java test's full payload carried, as Pacing writes it.
    const raw = minimal({
      campaign: {
        id: "nike-ss26", pacingId: "p1", name: "Nike SS26", startDate: "2026-08-01", endDate: "2026-09-30",
        currency: "USD", rate: 1.0, status: "Live", orderNumber: "SO-1",
        sourceUrl: "https://docs.google.com/spreadsheets/d/abc",
        links: [{ name: "Asana", url: "https://app.asana.com/0/123/456" }],
        netMode: true, periodScope: true, periodScopeKey: "2026-09-01|2026-09-07", rateLocked: true, nsRate: 0.26,
        timezone: "America/New_York",
      },
      planByLineItem: {
        "111": {
          lineItemId: "111", channel: "Display", dsp: "DV360", labels: ["VIP", "renewal"], description: "Nike SS26 - Display",
          rateType: "CPM", clientBudget: 5000.0, plannedImpressions: 1_000_000.0, marginTargetPct: 20.0, ctrTargetPct: null,
          vcrTargetPct: null, flightStart: "2026-08-01", flightEnd: "2026-09-30",
          pauseIntervals: [{ from: "2026-08-10", to: "2026-08-12" }],
          containers: [{ target_impressions: 200_000 }],
          dimGroups: [{ dim_key: "audience", name: "Brand", values: ["PMax_Brand", "Search_Brand"] }],
          native_budget: null, cost_coef: false, converted: false, currency: null,
          netRatio: 0.85, storedNetRatio: 0.85, netRatioLocked: true, nsNetRatio: 0.8,
          primaryConversions: ["Purchase"], storedPrimaryConversions: ["Purchase"], conversionData: true,
          bidCpm: 3.5,
        },
      },
      factsDaily: [{ date: "2026-08-01", impressions: 500 }],
      asOf: "2026-08-05",
      creatives: [{ creative_name: "Hero 15s" }],
      dimSources: { devices: { rows: [] } },
      display: { widgets: [] },
      aggregate: { groupBy: "day" },
      capabilities: { contextWidgetSpec: 2 },
      metrics: { campaign: { mA: 42.5 } },
      data: { source: "platform_mart_adjustments_view", fetch_creatives: true },
      journal: [{ id: "j1", ts: "2026-08-05", msg: "Kicked off", uid: "azat@aidigital.com", user_id: "pu-1", edited_at: null }],
      sourceFacts: { cm360: { configured: false } },
    });

    // When: the caller authored the journal entry themselves ("pu-1"), on a restricted scope.
    const result = readDashboardWire(raw, { ownPacingUserId: "pu-1", unrestricted: false });

    // Then: the "id" field Pacing calls the campaign is renamed to "slug" on this contract
    expect(result.campaign.slug).toBe("nike-ss26");
    // The metric bag rides through untouched.
    expect(result.metrics).toEqual({ campaign: { mA: 42.5 } });
    expect(result.campaign.pacingId).toBe("p1");
    expect(result.campaign.sourceUrl).toBe("https://docs.google.com/spreadsheets/d/abc");
    expect(result.campaign.links).toEqual([{ name: "Asana", url: "https://app.asana.com/0/123/456" }]);
    expect(result.campaign.startDate).toBe("2026-08-01");
    const plan = result.planByLineItem["111"];
    expect(plan.plannedImpressions).toBe(1_000_000);
    expect(plan.primaryConversions).toEqual(["Purchase"]);
    expect(plan.storedPrimaryConversions).toEqual(["Purchase"]);
    expect(plan.conversionData).toBe(true);
    expect(plan.pauseIntervals).toEqual([{ from: "2026-08-10", to: "2026-08-12" }]);
    expect(plan.labels).toEqual(["VIP", "renewal"]);
    expect(plan.description).toBe("Nike SS26 - Display");
    expect(result.campaign.netMode).toBe(true);
    expect(result.campaign.periodScope).toBe(true);
    expect(result.campaign.periodScopeKey).toBe("2026-09-01|2026-09-07");
    expect(result.campaign.rateLocked).toBe(true);
    expect(result.campaign.nsRate).toBe(0.26);
    expect(plan.netRatio).toBe(0.85);
    expect(plan.storedNetRatio).toBe(0.85);
    expect(plan.netRatioLocked).toBe(true);
    expect(plan.nsNetRatio).toBe(0.8);
    expect(result.factsDaily).toHaveLength(1);
    expect(result.asOf).toBe("2026-08-05");
    expect(result.creatives).toEqual([{ creative_name: "Hero 15s" }]);
    expect(result.conversions).toBeNull();
    expect(result.dimSources).toHaveProperty("devices");
    expect(result.display).toHaveProperty("widgets");
    expect(result.aggregate).toEqual({ groupBy: "day" });
    expect(result.libraryEntries).toBeNull();
    expect(result.data).toEqual({ source: "platform_mart_adjustments_view", fetch_creatives: true });
    expect(result.journal).toHaveLength(1);
    expect(result.journal[0].msg).toBe("Kicked off");
    expect(result.journal[0].canEdit).toBe(true);
    // What the Java records never declared is dropped, as Jackson dropped it.
    expect(result.campaign).not.toHaveProperty("timezone");
    expect(plan).not.toHaveProperty("bidCpm");
    expect(result).not.toHaveProperty("sourceFacts");
    expect(result.journal[0]).not.toHaveProperty("user_id");
  });

  it("shouldDefaultLineItemPlanLabelsToEmptyListWhenPacingOmitsThemTest", () => {
    const raw = minimal({
      campaign: { id: "nike-ss26", pacingId: "p1", name: "Nike SS26", startDate: "2026-08-01", endDate: "2026-09-30", currency: "USD", rate: 1.0, status: "Live", orderNumber: "SO-1", sourceUrl: "", links: [] },
      planByLineItem: { "111": { lineItemId: "111", channel: "Display", dsp: "DV360", rateType: "CPM", clientBudget: 5000, plannedImpressions: 1_000_000, marginTargetPct: 20, flightStart: "2026-08-01", flightEnd: "2026-09-30", pauseIntervals: [], containers: [], cost_coef: false, converted: false } },
    });

    const result = readDashboardWire(raw, RESTRICTED);

    expect(result.planByLineItem["111"].labels).toEqual([]);
    expect(result.planByLineItem["111"].description).toBeNull();
    expect(result.planByLineItem["111"].dimGroups).toEqual([]);
    // A pacing that never saved a period scope reads as scope off, with no key.
    expect(result.campaign.periodScope).toBe(false);
    expect(result.campaign.periodScopeKey).toBeNull();
    // A payload without rateLocked/nsRate reads as unlocked, with no NetSuite rate known.
    expect(result.campaign.rateLocked).toBe(false);
    expect(result.campaign.nsRate).toBeNull();
  });

  it("shouldAllowEditOnlyForTheEntrysOwnAuthorOrAnUnrestrictedScopeTest", () => {
    const entry = { id: "j1", ts: "2026-08-05", msg: "Note", uid: "someone@aidigital.com", user_id: "pu-1", edited_at: null };
    // a different, restricted-scope caller may not edit it
    expect(toJournalV1([entry], "pu-2", false)[0].canEdit).toBe(false);
    // the entry's own author may
    expect(toJournalV1([entry], "pu-1", false)[0].canEdit).toBe(true);
    // an unrestricted (admin) scope may edit any entry, authored by someone else
    expect(toJournalV1([entry], "pu-2", true)[0].canEdit).toBe(true);
    // a caller not yet synced into Pacing (null own id) on a restricted scope may not
    expect(toJournalV1([entry], null, false)[0].canEdit).toBe(false);
    // ...and an entry with no author is nobody's, even for a null caller (null.equals is never called)
    expect(toJournalV1([{ ...entry, user_id: null }], null, false)[0].canEdit).toBe(false);
  });

  it("shouldMapDeliveryStatsAndKeepAnUnmeasuredOneNullTest", () => {
    const measured = readDashboardWire(minimal({ deliveryStats: { rows: 120000, cells: 3600000, measuredAt: "2026-10-14T11:20:00.000Z", autoOffAt: null } }), RESTRICTED);
    const unmeasured = readDashboardWire(minimal({ deliveryStats: null }), RESTRICTED);

    expect(measured.deliveryStats).toEqual({ rows: 120000, cells: 3600000, measuredAt: "2026-10-14T11:20:00.000Z", autoOffAt: null });
    expect(unmeasured.deliveryStats).toBeNull();
  });

  it("shouldMapFullNotifySettingsToV1Test", () => {
    const result = readDashboardWire(minimal({ notify: fullNotify }), RESTRICTED);

    const alerts = result.notify!.alerts;
    expect(alerts.enabled).toBe(true);
    expect(alerts.bidFactAbovePlan).toEqual({ enabled: true, slack: true, window: 2, thresholdPct: 5 });
    expect(alerts.dataGap.gapDays).toBe(1);
    expect(alerts.ctrBelowTarget.factor).toBe(0.7);
    expect(alerts.vcrBelowTarget.factor).toBe(0.7);
    expect(alerts.ctrAboveTarget.factor).toBe(2.0);
    expect(alerts.vcrOver100.enabled).toBe(true);
    expect(alerts.noImpressionsYet.slack).toBe(true);
    expect(alerts.pacingOffPace).toEqual({ enabled: true, slack: true, low: -5, high: 5 });
    expect(alerts.marginBelowTarget.gapPp).toBe(3);
    expect(alerts.spendOverspend).toEqual({ enabled: true, slack: true, warnPct: 90, badPct: 100 });
    expect(alerts.dspForecastOverspend.enabled).toBe(true);
    expect(alerts.staleData.days).toBe(2);
    expect(alerts.rateCostAbovePlan.thresholdPct).toBe(10);
    expect(result.notify!.metrics.vcr).toBe(true);
    expect(result.notify!.hidePaused).toBe(true);
    expect(result.notify!.summaryProjection).toBe("plan");
  });

  it("shouldDefaultAbsentNotifyKeysLikePacingDoesTest", () => {
    // A notify block written before summary_projection and metrics existed - 236 of the 1337
    // production pacings carry one. Pacing reads both as their defaults, never as an error.
    const { metrics: _m, hide_paused: _h, summary_projection: _s, ...older } = fullNotify;
    const result = readDashboardWire(minimal({ notify: { ...older, alerts: { ...fullNotify.alerts, enabled: false }, metrics: null } }), RESTRICTED);

    expect(result.notify!.alerts.enabled).toBe(false);
    expect(result.notify!.metrics.vcr).toBe(false);
    expect(result.notify!.hidePaused).toBe(false);
    expect(result.notify!.summaryProjection).toBe("reforecast");
  });

  it("shouldDegradeMalformedFlightDatesToNullRatherThanFailTest", () => {
    const raw = minimal({ campaign: { id: "slug", pacingId: "p1", name: "Name", startDate: "not-a-date", endDate: "", currency: "USD", rate: 1.0, status: "Live" } });

    const result = readDashboardWire(raw, { ownPacingUserId: null, unrestricted: false });

    // Null stays null rather than flattening to an empty map, unlike display and aggregate.
    expect(result.metrics).toBeNull();
    expect(result.campaign.startDate).toBeNull();
    expect(result.campaign.endDate).toBeNull();
  });

  it("shouldFlattenNullCampaignLinksToEmptyListTest", () => {
    const raw = minimal({ campaign: { id: "slug", pacingId: "p1", name: "Name", startDate: "2026-08-01", endDate: "2026-09-30", currency: "USD", rate: 1.0, status: "Live", orderNumber: null, sourceUrl: "", links: null } });

    expect(readDashboardWire(raw, RESTRICTED).campaign.links).toEqual([]);
  });

  it("thirdPartyBecomesAnEmptyListWhileMappingsV3KeepsItsNull", () => {
    // The asymmetry is deliberate: a CM360 widget length-checks thirdParty, while null mappingsV3
    // means "predates the v3 model" and an empty list "migrated, nothing mapped".
    const result = readDashboardWire(minimal({ third_party: null, mappings_v3: null }), { ownPacingUserId: null, unrestricted: true });

    expect(result.thirdParty).toEqual([]);
    expect(result.mappingsV3).toBeNull();
  });

  it("thirdPartyAndMappingsV3RideThroughUntouched", () => {
    const blocks = [{ type: "cm360", campaigns: ["Spring Sale"] }];
    const mappings = [{ id: "m1" }];
    const result = readDashboardWire(minimal({ third_party: blocks, mappings_v3: mappings }), { ownPacingUserId: null, unrestricted: true });

    expect(result.thirdParty).toEqual(blocks);
    expect(result.mappingsV3).toEqual(mappings);
  });
});

describe("readDashboardWire - what the port had to make explicit", () => {
  it("writes every key of the model, null where the Java side held null, on the sparsest body", () => {
    // The Boot mapper wrote every field of PacingDashboardV1 - `null` as `null`. A consumer that
    // reads `payload.types` sees null today, and must keep seeing null, not undefined.
    const out = JSON.parse(JSON.stringify(readDashboardWire(minimal(), RESTRICTED)));

    expect(Object.keys(out).sort()).toEqual([
      "aggregate", "asOf", "availableMetrics", "availableSplits", "campaign", "capabilities", "conversionTags",
      "conversions", "creatives", "data", "deliveryStats", "dimSources", "display", "factsDaily", "journal",
      "libraryEntries", "mappingsV3", "metrics", "notify", "planByLineItem", "thirdParty", "types",
    ]);
    expect(out.asOf).toBeNull();
    expect(out.types).toBeNull();
    expect(out.conversionTags).toBeNull();
    expect(out.capabilities).toBeNull();
    expect(out.thirdParty).toEqual([]);
    expect(Object.keys(out.campaign).sort()).toEqual([
      "currency", "endDate", "links", "name", "netMode", "nsRate", "orderNumber", "pacingId", "periodScope",
      "periodScopeKey", "rate", "rateLocked", "slug", "sourceUrl", "startDate", "status",
    ]);
  });

  it("reads a null campaign as the empty model - every field null, links []", () => {
    // `new PacingDashboardCampaignV1()` (mapper 405-407): the generated model's own defaults.
    const out = readDashboardWire(minimal({ campaign: null }), RESTRICTED);

    expect(out.campaign).toEqual({
      slug: null, pacingId: null, name: null, startDate: null, endDate: null, currency: null, rate: null,
      rateLocked: null, nsRate: null, netMode: null, periodScope: null, periodScopeKey: null, status: null,
      orderNumber: null, sourceUrl: null, links: [],
    });
  });

  it("passes cost_coef and converted through as Booleans, null included", () => {
    // Unlike rateLocked/netMode/periodScope/netRatioLocked (`Boolean.TRUE.equals`), the mapper set
    // these two straight from the record (489, 494) - so an absent one stays null, not false.
    const plan = { lineItemId: "1", channel: "Display", rateType: "CPM", clientBudget: 1, plannedImpressions: 1, marginTargetPct: 1 };
    const out = readDashboardWire(minimal({ planByLineItem: { "1": plan } }), RESTRICTED).planByLineItem["1"];

    expect(out.costCoef).toBeNull();
    expect(out.converted).toBeNull();
    expect(out.netRatioLocked).toBe(false);
    expect(out.pauseIntervals).toEqual([]);
    expect(out.primaryConversions).toBeNull();
  });

  it("fails on a conversionTags outside the enum, as fromValue did", () => {
    expect(() => readDashboardWire(minimal({ conversionTags: "partial" }), RESTRICTED)).toThrow(WireError);
    expect(readDashboardWire(minimal({ conversionTags: "dropped" }), RESTRICTED).conversionTags).toBe("dropped");
  });

  it("fails on a notify block with a missing detector, as the NPE did", () => {
    const { stale_data: _gone, ...twelve } = fullNotify.alerts;
    expect(() => readDashboardWire(minimal({ notify: { ...fullNotify, alerts: twelve } }), RESTRICTED)).toThrow(WireError);
    expect(() => readDashboardWire(minimal({ notify: { metrics: { vcr: true } } }), RESTRICTED)).toThrow(WireError);
  });

  it("parses dates the way LocalDate.parse did: strict shape, real calendar, malformed to null", () => {
    expect(parseDate("2026-08-01")).toBe("2026-08-01");
    expect(parseDate("2024-02-29")).toBe("2024-02-29");
    expect(parseDate("2026-02-29")).toBeNull();
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("2026-3-1")).toBeNull();
    expect(parseDate("2026-03-01T00:00")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate("   ")).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });

  it("coerces scalars the way Jackson did on the way into the records", () => {
    expect(str(123)).toBe("123");
    expect(str(true)).toBe("true");
    expect(str(null)).toBeNull();
    expect(() => str({})).toThrow(WireError);
    expect(dbl("1.5")).toBe(1.5);
    expect(dbl(null)).toBeNull();
    expect(() => dbl("abc")).toThrow(WireError);
    expect(int32(2.7)).toBe(2);
    expect(int32(undefined)).toBe(0);
    expect(bool("true")).toBe(true);
    expect(bool(0)).toBe(false);
    expect(bool(null)).toBeNull();
    expect(boolPrim(undefined)).toBe(false);
    expect(() => bool("yes")).toThrow(WireError);
  });

  it("applies those coercions where the records declared the type", () => {
    const plan = { lineItemId: 111, channel: "Display", rateType: "CPM", clientBudget: "5000", plannedImpressions: 1, marginTargetPct: 1, labels: [1, "two"] };
    const out = readDashboardWire(
      minimal({
        campaign: { id: 7, pacingId: "p1", name: "N", rate: "1.5", rateLocked: "true", startDate: 20260801 },
        planByLineItem: { "111": plan },
        notify: { ...fullNotify, alerts: { ...fullNotify.alerts, bid_fact_above_plan: { enabled: "true", slack: 1, window: "3", threshold_pct: "5.5" } } },
        journal: [{ id: 42, ts: "2026-01-01", msg: "m", uid: "", user_id: 99 }],
      }),
      { ownPacingUserId: "99", unrestricted: false },
    );

    expect(out.campaign.slug).toBe("7");
    expect(out.campaign.rate).toBe(1.5);
    expect(out.campaign.rateLocked).toBe(true);
    expect(out.campaign.startDate).toBeNull(); // "20260801" is not an ISO date
    expect(out.planByLineItem["111"].lineItemId).toBe("111");
    expect(out.planByLineItem["111"].clientBudget).toBe(5000);
    expect(out.planByLineItem["111"].labels).toEqual(["1", "two"]);
    expect(out.notify!.alerts.bidFactAbovePlan).toEqual({ enabled: true, slack: true, window: 3, thresholdPct: 5.5 });
    expect(out.journal[0].id).toBe("42");
    expect(out.journal[0].canEdit).toBe(true); // "99".equals(String.valueOf(99))
  });
});
