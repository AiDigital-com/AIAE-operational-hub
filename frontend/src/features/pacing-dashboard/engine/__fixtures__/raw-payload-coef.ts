/**
 * A third crown fixture: a USD pacing with `cost_coef: true` on one line item (coefficient-cost
 * mode, spec 2026-07-15), in Pacing's own wire format - see `raw-payload.ts`'s header for how this
 * feeds the crown test. Exists to prove the browser-side engine switches to per-fact-row margin
 * resolution (`PacingCore.coefDcForRow`/`resolveRowMargin`) exactly like Pacing's server does - the
 * gap closed by adding `costCoef` to `PacingLineItemPlanV1` and threading it through
 * `build-metrics.ts`'s `toEngineRaw`.
 *
 * LI 200's `dynamic_cost` is deliberately garbage (unrelated to `spend`) - the same "garbage
 * dynamic_cost the coef path must ignore" shape `tests/coef-summary-parity-test.mjs` uses - so a
 * build that forgets `cost_coef` (and falls through to the raw `dynamic_cost` path) produces a
 * materially different `dc`/margin than the correct margin-derived one
 * (`spend * 100 / (100 - marginTargetPct)`). LI 100 stays non-coef, proving the two line items'
 * cost models coexist correctly in the same pacing.
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
      dynamic_cost: 80 + i * 2, // non-coef LI: dc == spend, identity path.
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
      // Garbage, unrelated to spend/margin - the coef path must ignore this and derive dc from
      // spend * 100 / (100 - marginTargetPct) instead.
      dynamic_cost: 999,
      platform: "TTD",
      tactic: "retargeting",
      audience: "auto_intenders",
    });
  }
  return rows;
}

export const RAW_PAYLOAD_COEF = {
  campaign: {
    id: "initech-ctv",
    pacingId: "pacing-3",
    name: "Initech CTV Always-On",
    startDate: "2026-08-01",
    endDate: "2026-08-10",
    currency: "USD",
    status: "Live",
    orderNumber: "SO-3003",
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
      clientBudget: 1_000,
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
      converted: false,
      currency: null,
      native_budget: null,
    },
    "200": {
      lineItemId: "200",
      channel: "Video",
      dsp: "TTD",
      rateType: "CPM",
      clientBudget: 3_000,
      plannedImpressions: 300_000,
      // The MATH input the coef path resolves per fact row (PacingCore.buildMarginIndex's idx.mTgt
      // fallback) when no container/date/dim override applies - see class javadoc.
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
      // The MATH input this fixture exists to exercise - see PacingLineItemPlanV1.costCoef's
      // javadoc and buildCoefIndexMap/addFact in shared/dashboard-metrics.js.
      cost_coef: true,
      converted: false,
      currency: null,
      native_budget: null,
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
