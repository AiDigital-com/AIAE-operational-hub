/**
 * A second crown fixture: a NON-USD (EUR) pacing with a real campaign `rate`, in Pacing's own wire
 * format (same shape as `raw-payload.ts`, see that file's header for the full explanation of how
 * this feeds the crown test). Exists to prove the browser-side engine converts delivery cost with
 * the campaign's currency rate exactly like Pacing's server does - the gap closed by adding `rate`
 * to `PacingDashboardCampaignV1` and threading it through `build-metrics.ts`'s `toEngineRaw`.
 *
 * `dynamic_cost` (native EUR) is deliberately set well above `spend` (already USD, per merge.mjs's
 * C3 rule) on both line items, the same "native amount clearly bigger than the USD spend" shape
 * `tests/pacing-build-margin-currency-test.mjs` uses - so a build that forgets to apply `rate` (or
 * applies it as an identity no-op) produces a materially different `dc`/margin than one that does.
 */

import type { RawFactRow } from "./raw-payload";

function facts(): RawFactRow[] {
  const days = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"];
  const rows: RawFactRow[] = [];
  for (const [i, date] of days.entries()) {
    rows.push({
      line_item_id: "100",
      date,
      impressions: 10_000 + i * 500,
      clicks: 50 + i,
      spend: 80 + i * 2,
      completes: 0,
      // Native EUR, well above spend - rate (1.35) must be applied to reach the USD dc.
      dynamic_cost: 150 + i * 3,
      platform: "dv_360_dlv",
      tactic: "prospecting",
      audience: "sports_fans",
    });
    rows.push({
      line_item_id: "200",
      date,
      impressions: 20_000 + i * 800,
      clicks: 0,
      spend: 300 + i * 5,
      completes: 15_000 + i * 600,
      dynamic_cost: 560 + i * 9,
      platform: "TTD",
      tactic: "retargeting",
      audience: "auto_intenders",
    });
  }
  return rows;
}

export const RAW_PAYLOAD_CURRENCY = {
  campaign: {
    id: "globex-emea",
    pacingId: "pacing-2",
    name: "Globex EMEA Always-On",
    startDate: "2026-08-01",
    endDate: "2026-08-10",
    currency: "EUR",
    // The MATH input this fixture exists to exercise - see PacingDashboardCampaignV1.rate's
    // javadoc and Currency.currencyToUsd in shared/dashboard-metrics.js.
    rate: 1.35,
    status: "Live",
    orderNumber: "SO-2002",
  },
  types: [
    { line_item_id: "100", type: "Display" },
    { line_item_id: "200", type: "Video" },
  ],
  planByLineItem: {
    "100": {
      lineItemId: "100",
      channel: "Display",
      dsp: "DV360",
      rateType: "CPM",
      clientBudget: 1_000, // already USD (C3) - unaffected by rate.
      plannedImpressions: 100_000,
      marginTargetPct: 20,
      ctrTargetPct: 0.5,
      vcrTargetPct: null,
      flightStart: "2026-08-01",
      flightEnd: "2026-08-10",
      containers: [],
      labels: ["brand", "always-on"],
      pauseIntervals: [],
      description: "Prospecting display",
      cost_coef: false,
      converted: true,
      currency: "EUR",
      native_budget: 741, // ~1000 / 1.35, display-only (contract-total badge).
    },
    "200": {
      lineItemId: "200",
      channel: "Video",
      dsp: "TTD",
      rateType: "CPM",
      clientBudget: 3_000,
      plannedImpressions: 300_000,
      marginTargetPct: 25,
      ctrTargetPct: null,
      vcrTargetPct: 70,
      flightStart: "2026-08-01",
      flightEnd: "2026-08-10",
      containers: [
        {
          id: "c1",
          name: "Week 1",
          fs: "2026-08-01",
          fe: "2026-08-07",
          target_impressions: 150_000,
          date_children: [],
          dim_children: [],
        },
      ],
      labels: [],
      pauseIntervals: [],
      description: null,
      cost_coef: false,
      converted: true,
      currency: "EUR",
      native_budget: 2_222, // ~3000 / 1.35, display-only.
    },
  },
  factsDaily: facts(),
  aggregate: {},
  display: {
    rev: 1,
    widgets: [
      {
        id: "w1",
        kind: "detailCard",
        source: "planUnits",
      },
      {
        id: "w2",
        kind: "stat",
        bind: { metric: "margin" },
      },
      {
        id: "w3",
        kind: "stat",
        bind: { expr: "sp / im" },
      },
      {
        id: "w4",
        kind: "rateRows",
        type: "rateRows",
        series: "bid",
      },
    ],
  },
  notify: {
    alerts: {
      margin_below_target: { gap_pp: 4 },
    },
  },
  journal: [],
};
