/**
 * `buildPacingAlerts` - item 3 of the 2026-09-25 dashboard filters follow-up ("Alerts should be
 * computed here, not taken from the server"). Reuses the crown test's own fixture (`toHubShape()`):
 * two line items, both delivering with `dynamic_cost === spend` (0% actual margin) against 20%/25%
 * margin targets and a 4pp gap threshold (`RAW_PAYLOAD.notify.alerts.margin_below_target.gap_pp`),
 * so `margin_below_target` fires for BOTH line items at every filter default - a clean, unambiguous
 * signal for "does a filter change the alert set."
 */
import { describe, expect, it } from "vitest";
import { buildPacingAlerts } from "./build-alerts";
import { toHubShape } from "./__fixtures__/to-hub-shape";
import { DEFAULT_FILTERS } from "../filters/types";
import {
  aPacingDashboardCampaignV1,
  aPacingDashboardV1,
  aPacingLineItemPlanV1,
  aPacingNotifySettingsV1,
} from "@/test/factories";

describe("buildPacingAlerts", () => {
  it("computes a non-trivial alert set with every filter at default", () => {
    const alerts = buildPacingAlerts(toHubShape(), DEFAULT_FILTERS);
    const marginAlerts = alerts.filter((a) => a.type === "margin_below_target");
    // Both line items are 0% actual margin against a 20%/25% target - both must alert.
    expect(marginAlerts.map((a) => a.liId).sort()).toEqual(["100", "200"]);
    // Shaped the same way `row.alerts` (health.mjs) always was - value/label off displayParts.
    const li100 = marginAlerts.find((a) => a.liId === "100")!;
    expect(li100.severity).toBe("critical");
    expect(li100.value).toMatch(/pp$/);
    expect(li100.label).toBe("margin below target");
    expect(li100.name).toBe("Prospecting display"); // LP["100"].description
    const li200 = marginAlerts.find((a) => a.liId === "200")!;
    expect(li200.name).toBe("Video"); // LP["200"].description is null - falls back to channel
  });

  it("returns [] for a null/malformed payload, never throws", () => {
    expect(buildPacingAlerts(null, DEFAULT_FILTERS)).toEqual([]);
    expect(buildPacingAlerts(undefined, DEFAULT_FILTERS)).toEqual([]);
    const broken = { ...toHubShape(), campaign: undefined } as unknown as Parameters<typeof buildPacingAlerts>[0];
    expect(buildPacingAlerts(broken, DEFAULT_FILTERS)).toEqual([]);
  });

  it("a channel filter (Scope) DOES change the alert set - narrows to the matching line item", () => {
    const displayOnly = buildPacingAlerts(toHubShape(), { ...DEFAULT_FILTERS, channels: ["Display"] });
    const liIds = new Set(displayOnly.map((a) => a.liId));
    expect(liIds.has("100")).toBe(true);
    expect(liIds.has("200")).toBe(false);
  });

  it("a selection filter (Scope) DOES change the alert set the same way", () => {
    const selected = buildPacingAlerts(toHubShape(), { ...DEFAULT_FILTERS, selection: ["200"] });
    const liIds = new Set(selected.map((a) => a.liId));
    expect(liIds.has("200")).toBe(true);
    expect(liIds.has("100")).toBe(false);
  });

  it("a platform filter (Lens) does NOT change the alert set - stays byte-identical to baseline", () => {
    const baseline = buildPacingAlerts(toHubShape(), DEFAULT_FILTERS);
    const platformFiltered = buildPacingAlerts(toHubShape(), { ...DEFAULT_FILTERS, platforms: ["dv_360_dlv"] });
    expect(platformFiltered).toEqual(baseline);
  });

  it("a brkf filter (Lens) does NOT change the alert set either", () => {
    const baseline = buildPacingAlerts(toHubShape(), DEFAULT_FILTERS);
    const brkfFiltered = buildPacingAlerts(toHubShape(), { ...DEFAULT_FILTERS, brkf: ["tactic:prospecting"] });
    expect(brkfFiltered).toEqual(baseline);
  });
});

/**
 * Reference-rule pins (owner decision, 2026-09-26 - see `build-alerts.ts`'s docblock): the
 * dashboard's alert inputs match `AlertsBlock.jsx` (the retired SPA's own dashboard alerts), NOT
 * `health.mjs` (the Overview list). Concretely: `liDaily` reaches `AlertsCore.buildState` UNCLIPPED
 * by any line item's flight window - a post-flight delivery row is real, recent data, so
 * `stale_data` measures from it and `post_flight_delivery` can actually see the rows it exists to
 * detect - and `today` is wall-clock, not `asOf`. `today` is passed explicitly below so the pins
 * don't drift as real time passes; production callers take the parameter's default
 * (`new Date().toISOString().slice(0, 10)`, exactly the reference's own call site).
 */
describe("buildPacingAlerts - reference rule (AlertsBlock.jsx): unclipped liDaily, wall-clock today", () => {
  /** One line item whose (and whose campaign's) flight ended 2026-08-10, with real delivery on the
   *  last flight day and a post-flight row 8 days later - the Grapefest 2026 shape. */
  const postFlightData = () =>
    aPacingDashboardV1({
      campaign: aPacingDashboardCampaignV1({ endDate: "2026-08-10" }),
      planByLineItem: {
        "300": aPacingLineItemPlanV1({
          lineItemId: "300",
          flightStart: "2026-08-01",
          flightEnd: "2026-08-10",
          ctrTargetPct: null,
          vcrTargetPct: null,
        }),
      },
      factsDaily: [
        { line_item_id: "300", date: "2026-08-10", impressions: 1000, clicks: 5, spend: 50, completes: 0, dynamic_cost: 50 },
        // Post-flight delivery. Under the revoked health.mjs clip this row was invisible to every
        // detector; under the reference rule it is real, recent delivery.
        { line_item_id: "300", date: "2026-08-18", impressions: 40, clicks: 0, spend: 2, completes: 0, dynamic_cost: 2 },
      ],
      notify: aPacingNotifySettingsV1(),
    });

  it("stale_data measures from the TRUE latest date (post-flight row included) against wall-clock today", () => {
    const alerts = buildPacingAlerts(postFlightData(), DEFAULT_FILTERS, "2026-08-26");
    const stale = alerts.find((a) => a.type === "stale_data");
    expect(stale).toBeDefined();
    expect(stale!.severity).toBe("warning");
    expect(stale!.value).toBe("8d"); // 08-26 minus 08-18; the revoked clip would have said 16d from 08-10
    expect(stale!.label).toBe("data is stale");
  });

  it("a recent post-flight row keeps the data FRESH - no stale_data inside the threshold", () => {
    const alerts = buildPacingAlerts(postFlightData(), DEFAULT_FILTERS, "2026-08-19");
    expect(alerts.find((a) => a.type === "stale_data")).toBeUndefined();
  });

  it("post_flight_delivery fires while the post-flight delivery is recent - the unclipped rows are exactly what it exists to see", () => {
    const alerts = buildPacingAlerts(postFlightData(), DEFAULT_FILTERS, "2026-08-19");
    const post = alerts.find((a) => a.type === "post_flight_delivery");
    expect(post).toBeDefined();
    expect(post!.severity).toBe("warning");
  });

  it("post_flight_delivery goes silent once delivery has wound down past active_days", () => {
    const alerts = buildPacingAlerts(postFlightData(), DEFAULT_FILTERS, "2026-08-26"); // 8d after the last row
    expect(alerts.find((a) => a.type === "post_flight_delivery")).toBeUndefined();
  });

  it("data_gap still fires on real gaps inside the data", () => {
    const plan = aPacingLineItemPlanV1({
      lineItemId: "400",
      flightStart: "2026-08-01",
      flightEnd: "2026-08-20",
      ctrTargetPct: null,
      vcrTargetPct: null,
    });
    const data = aPacingDashboardV1({
      planByLineItem: { "400": plan },
      factsDaily: [
        { line_item_id: "400", date: "2026-08-01", impressions: 1000, clicks: 5, spend: 50, completes: 0, dynamic_cost: 50 },
        // 8-day gap between consecutive delivery days.
        { line_item_id: "400", date: "2026-08-09", impressions: 1000, clicks: 5, spend: 50, completes: 0, dynamic_cost: 50 },
      ],
      notify: aPacingNotifySettingsV1(),
    });

    const alerts = buildPacingAlerts(data, DEFAULT_FILTERS, "2026-08-10");
    const gap = alerts.find((a) => a.type === "data_gap");
    expect(gap).toBeDefined();
    expect(gap!.value).toBe("7d"); // 7 days with no data between 08-01 and 08-09
  });

  it("vcr_over_100 (data-integrity) fires regardless of the window rule", () => {
    const plan = aPacingLineItemPlanV1({
      lineItemId: "500",
      channel: "Video",
      flightStart: "2026-08-01",
      flightEnd: "2026-08-10",
      ctrTargetPct: null,
      vcrTargetPct: 70,
    });
    const data = aPacingDashboardV1({
      planByLineItem: { "500": plan },
      factsDaily: [
        // completes > impressions - physically invalid, inside the flight window.
        { line_item_id: "500", date: "2026-08-05", impressions: 100, clicks: 0, spend: 10, completes: 150, dynamic_cost: 10 },
      ],
      notify: aPacingNotifySettingsV1(),
    });

    const alerts = buildPacingAlerts(data, DEFAULT_FILTERS);
    const bad = alerts.find((a) => a.type === "vcr_over_100");
    expect(bad).toBeDefined();
    expect(bad!.severity).toBe("critical");
    expect(bad!.liId).toBe("500");
  });
});
