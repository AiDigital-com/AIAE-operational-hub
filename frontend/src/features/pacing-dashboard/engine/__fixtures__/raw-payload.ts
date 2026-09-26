/**
 * A realistic dashboard payload in Pacing's OWN wire format (what `dash-gate/lib/merge.mjs`'s
 * `response` object looks like before the Hub reshapes it) - the crown test's single source of
 * truth. `to-hub-shape.ts` translates this into what the Hub's `PacingDashboardV1` actually looks
 * like on the wire; `engine-loader.ts`'s `buildServerMetricBag` (Pacing's own vendored
 * `buildMetricBag`) computes "what Pacing would have sent on `data.metrics`" straight from this
 * object. The crown test in `../build-metrics.crown.test.ts` asserts the wrapper's output, fed the
 * Hub-shaped translation with no filters, equals that exactly.
 *
 * Two line items (one plain, one with a container), five days of delivery, USD/no-coefficient -
 * the common case this wrapper is verified against (see `build-metrics.ts`'s docblock for the
 * documented, out-of-scope gap on converted/coefficient pacings).
 */

export interface RawFactRow {
  line_item_id: string;
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  completes: number;
  conversions?: number;
  post_click_conversions?: number;
  post_view_conversions?: number;
  dynamic_cost: number;
  platform: string;
  tactic?: string;
  audience?: string;
}

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
      dynamic_cost: 80 + i * 2,
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
      dynamic_cost: 300 + i * 5,
      platform: "TTD",
      tactic: "retargeting",
      audience: "auto_intenders",
    });
  }
  return rows;
}

export const RAW_PAYLOAD = {
  campaign: {
    id: "acme-q3",
    pacingId: "pacing-1",
    name: "Acme Q3 Always-On",
    startDate: "2026-08-01",
    endDate: "2026-08-10",
    currency: "USD",
    status: "Live",
    orderNumber: "SO-1001",
    // Deliberately absent - see build-metrics.ts's documented gap. A USD campaign has no rate to
    // begin with, so its absence here does not diverge from what a real USD pacing would carry.
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
