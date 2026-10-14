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

  it("under period scope the detectors see only the selected period's days, as the reference's AlertsBlock windows them", () => {
    // Given: the data_gap case above, on a line item whose container splits the flight in two periods
    const plan = aPacingLineItemPlanV1({
      lineItemId: "400",
      flightStart: "2026-08-01",
      flightEnd: "2026-08-20",
      ctrTargetPct: null,
      vcrTargetPct: null,
      containers: [{
        id: "c1", name: "Two", fs: "2026-08-01", fe: "2026-08-20", target_impressions: 1_000_000,
        date_children: [
          { id: "d1", name: "1st", fs: "2026-08-01", fe: "2026-08-05", target_impressions: 250_000 },
          { id: "d2", name: "2nd", fs: "2026-08-06", fe: "2026-08-20", target_impressions: 750_000 },
        ],
        dim_children: [],
      }],
    });
    const data = aPacingDashboardV1({
      planByLineItem: { "400": plan },
      factsDaily: [
        { line_item_id: "400", date: "2026-08-01", impressions: 1000, clicks: 5, spend: 50, completes: 0, dynamic_cost: 50 },
        { line_item_id: "400", date: "2026-08-09", impressions: 1000, clicks: 5, spend: 50, completes: 0, dynamic_cost: 50 },
      ],
      notify: aPacingNotifySettingsV1(),
    });

    // When:
    const fullFlight = buildPacingAlerts(data, DEFAULT_FILTERS, "2026-08-10");
    const secondPeriod = buildPacingAlerts(data, DEFAULT_FILTERS, "2026-08-10",
      { scoped: true, periodKey: "2026-08-06|2026-08-20" });

    // Then: the 7-day gap spans the two periods; inside the second there is one day and no gap
    expect(fullFlight.find((a) => a.type === "data_gap")).toBeDefined();
    expect(secondPeriod.find((a) => a.type === "data_gap")).toBeUndefined();
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

/**
 * Scope pins against the reference's store selectors (`AlertsBlock.jsx` reads `useEffLIs` and
 * `useFullFlightMetrics`, both resolving `resolvePlanningScope` in `selectors.js`). One line item is
 * delivered in two geos at very different prices: TX at a $20 CPM, NY at a $1 CPM. Only the
 * campaign reading (`flCM`) takes the scoped delivery, so the campaign-level
 * `dsp_forecast_overspend` (forecast = delivered CPM x planned impressions) shows which delivery
 * it was given: TX alone forecasts far over budget, the blend does not.
 */
describe("buildPacingAlerts - container dim scope and dim-split Scope", () => {
  const days = ["2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"];
  const geoRows = (liId: string) => days.flatMap((date) => [
    { line_item_id: liId, date, geo: "TX", impressions: 10_000, clicks: 5, spend: 200, completes: 0, dynamic_cost: 200 },
    { line_item_id: liId, date, geo: "NY", impressions: 900_000, clicks: 5, spend: 900, completes: 0, dynamic_cost: 900 },
  ]);
  const geoPlan = (txPct: number, dateChildren: unknown[]) => aPacingLineItemPlanV1({
    lineItemId: "400",
    flightStart: "2026-08-01",
    flightEnd: "2026-08-20",
    ctrTargetPct: null,
    vcrTargetPct: null,
    containers: [{
      id: "c1", name: "Geo", fs: "2026-08-01", fe: "2026-08-20", target_impressions: 1_000_000,
      date_children: dateChildren,
      dim_children: [{ id: "g1", dim_key: "geo", dim_value: "TX", target_mode: "percent", target_value: txPct }],
    }],
  });
  const forecastOf = (alerts: ReturnType<typeof buildPacingAlerts>) =>
    alerts.find((a) => a.type === "dsp_forecast_overspend");

  it("under period scope, a container its dim splits cover counts only the declared values' delivery", () => {
    // Given: the same delivery under a container covered by geo:TX (100%) and one it only carves (50%)
    const periods = [
      { id: "d1", name: "1st", fs: "2026-08-01", fe: "2026-08-05", target_impressions: 250_000 },
      { id: "d2", name: "2nd", fs: "2026-08-06", fe: "2026-08-20", target_impressions: 750_000 },
    ];
    const dataFor = (txPct: number) => aPacingDashboardV1({
      planByLineItem: { "400": geoPlan(txPct, periods) },
      factsDaily: geoRows("400"),
      notify: aPacingNotifySettingsV1(),
    });
    const period = { scoped: true, periodKey: "2026-08-06|2026-08-20" };

    // When:
    const covered = buildPacingAlerts(dataFor(100), DEFAULT_FILTERS, "2026-08-10", period);
    const carvedOut = buildPacingAlerts(dataFor(50), DEFAULT_FILTERS, "2026-08-10", period);

    // Then: TX alone ($20 CPM x the period's 750k) is over the period's $6,000; the blend is not
    expect(forecastOf(covered)?.text).toMatch(/^DSP forecast \$15000\.00 exceeds cost budget \$6000\.00/);
    expect(forecastOf(carvedOut)).toBeUndefined();
    // and the per-line-item readings take the whole delivery in both, as the reference's liM does
    const pace = (alerts: typeof covered) => alerts.find((a) => a.type === "pacing_off_pace")?.text;
    expect(pace(covered)).toBe(pace(carvedOut));
  });

  describe("a breakdown chip naming a declared dim split", () => {
    // Given: line item 400 declares a geo:TX split (40% of its container); 500 declares none
    const dataWithSplit = () => aPacingDashboardV1({
      planByLineItem: {
        "400": geoPlan(40, []),
        "500": aPacingLineItemPlanV1({
          lineItemId: "500", channel: "Video", flightStart: "2026-08-01", flightEnd: "2026-08-20",
          ctrTargetPct: null, vcrTargetPct: null,
        }),
      },
      factsDaily: [
        ...geoRows("400"),
        ...days.map((date) => ({ line_item_id: "500", date, geo: "NY", impressions: 50_000, clicks: 5, spend: 100, completes: 0, dynamic_cost: 100 })),
      ],
      notify: aPacingNotifySettingsV1(),
    });

    it("cuts the alerts to the split's line items and judges the campaign on the split's delivery and plan", () => {
      // When:
      const baseline = buildPacingAlerts(dataWithSplit(), DEFAULT_FILTERS, "2026-08-10");
      const split = buildPacingAlerts(dataWithSplit(), { ...DEFAULT_FILTERS, brk: "geo", brkf: ["geo:TX"] }, "2026-08-10");

      // Then: 500 carries no TX split and drops out
      expect(baseline.some((a) => a.liId === "500")).toBe(true);
      expect(split.some((a) => a.liId === "500")).toBe(false);
      expect(split.some((a) => a.liId === "400")).toBe(true);
      // and the campaign reads TX only against the split's own plan: $20 CPM x 400k vs 40% of $8,000
      expect(forecastOf(baseline)).toBeUndefined();
      expect(forecastOf(split)?.text).toMatch(/^DSP forecast \$8000\.00 exceeds cost budget \$3200\.00/);
    });

    it("a chip with no declared split stays a Lens - the alert set is the baseline's", () => {
      // When:
      const baseline = buildPacingAlerts(dataWithSplit(), DEFAULT_FILTERS, "2026-08-10");
      const lens = buildPacingAlerts(dataWithSplit(), { ...DEFAULT_FILTERS, brk: "geo", brkf: ["geo:NY"] }, "2026-08-10");

      // Then:
      expect(lens).toEqual(baseline);
    });
  });
});
