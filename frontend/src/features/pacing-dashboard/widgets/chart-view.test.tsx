import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartViewRenderer, expectedCurve } from "./chart-view";
import type { ChartView } from "./widget-types";
import type { SeriesRow } from "../types-metrics";

/**
 * Which row field a chart's expected curve reads.
 *
 * jsdom lays nothing out, so Recharts inside a ResponsiveContainer draws nothing here - but the
 * "not available" note is rendered beside the chart, not inside it, and that note is exactly what
 * a missed field produces. Which makes it the thing worth asserting: a series that cannot find its
 * data does not fail loudly, it quietly draws one line fewer and says so in small grey text under
 * the chart.
 */

/** Rows as Pacing emits them: the expected curves are expIm / expCl / expCo / expVw. */
const ROWS: SeriesRow[] = [
  { date: "2026-08-01", im: 1000, sp: 10, cl: 5, coViews: 2, ctr: 0.5, expIm: 900, expCl: 4, expCo: 9, expVw: 2 },
  { date: "2026-08-02", im: 1100, sp: 11, cl: 6, coViews: 3, ctr: 0.6, expIm: 950, expCl: 5, expCo: 10, expVw: 3 },
];

function chart(basis: string, label: string): ChartView {
  return {
    kind: "chart",
    id: "v1",
    series: [
      { id: "actual", kind: "value", label: "Actual", value: { kind: "metric", metric: basis === "sp" ? "sp" : "im" }, axis: "left" },
      { id: "expected", kind: "calc", calc: "projection", basis, output: "cumulative", label, axis: "left" },
    ],
  } as unknown as ChartView;
}

describe("chart expected curve", () => {
  it("should find the cost curve a spend chart plots against", () => {
    // Given: "Cumulative Spend vs Cost Budget". Its expected series is `basis: "sp"`, and the field
    // that carries it is `expCo` - expected COST, despite a name that reads like completes beside
    // expIm and expCl. Deriving the field name from the basis produces `expSp`, which no row has.
    render(<ChartViewRenderer view={chart("sp", "Cost Budget")} rows={ROWS} scalars={{}} />);

    // Then: the budget curve is drawn, not quietly dropped with a note under the chart
    expect(screen.queryByText(/Not available in this view/)).toBeNull();
  });

  it("should find the views curve a completion chart plots against", () => {
    // Given: the same trap on the other basis - `coViews` reads `expVw`, not `expCoViews`.
    render(<ChartViewRenderer view={chart("coViews", "Expected")} rows={ROWS} scalars={{}} />);

    // Then:
    expect(screen.queryByText(/Not available in this view/)).toBeNull();
  });

  it("should say so when a basis really has no curve", () => {
    // Given: a basis Pacing computes no expected curve for. Silence would be the wrong answer -
    // the chart would look complete while missing a line.
    render(<ChartViewRenderer view={chart("cv", "Expected conversions")} rows={ROWS} scalars={{}} />);

    // Then:
    expect(screen.getByText(/Not available in this view: Expected conversions/)).toBeInTheDocument();
  });
});

/**
 * The same chart, stored the other way.
 *
 * Pacings migrating in from the original service carry the OLDER template shape: the expected
 * curve is a `guide` on the actual series rather than a series of its own. It stores neither
 * basis nor output on purpose - the series it hangs on already says both.
 */
function guideChart(metric: string, accumulate: "cumulative" | "daily", label: string): ChartView {
  return {
    kind: "chart",
    id: "v1",
    series: [
      {
        id: "actual",
        kind: "value",
        label: "Actual",
        value: { kind: "metric", metric },
        accumulate,
        axis: "left",
        guide: { calc: "projection", label, dashed: "medium", color: "expected" },
      },
    ],
  } as unknown as ChartView;
}

describe("a projection stored as a guide", () => {
  it("should draw the expected curve a migrated pacing carries", () => {
    // Given: "Cumulative Impressions" as the original service stores it
    render(<ChartViewRenderer view={guideChart("im", "cumulative", "Expected")} rows={ROWS} scalars={{}} />);

    // Then: the curve is drawn. Read as a target line instead, the guide has no `value.key` and
    // produces nothing at all - a chart missing its plan, with nothing to say it is missing.
    expect(screen.queryByText(/Not available in this view/)).toBeNull();
  });

  it("should take its basis from the series it hangs on", () => {
    // Given: a spend chart in the same shape - basis `sp`, which reads expCo
    render(<ChartViewRenderer view={guideChart("sp", "cumulative", "Cost Budget")} rows={ROWS} scalars={{}} />);

    // Then:
    expect(screen.queryByText(/Not available in this view/)).toBeNull();
  });

  it("should report a guide whose basis has no curve", () => {
    // Given: a series that plots fine (CTR is on the row) hanging a projection nobody computes an
    // expected curve for. The chart itself still draws - only the plan line is missing.
    render(<ChartViewRenderer view={guideChart("ctr", "daily", "Expected CTR")} rows={ROWS} scalars={{}} />);

    // Then: named, not silent
    expect(screen.getByText(/Not available in this view: Expected CTR/)).toBeInTheDocument();
  });

  it("should still draw a target guide as a reference line", () => {
    // Given: the other guide shape - CTR's horizontal target. Teaching the renderer about
    // projections must not cost it the guides it already understood.
    const view = {
      kind: "chart",
      id: "v1",
      series: [
        {
          id: "ctr",
          kind: "value",
          label: "CTR",
          value: { kind: "metric", metric: "ctr" },
          axis: "left",
          guide: { label: "Target", value: { kind: "canonical", key: "ctr" } },
        },
      ],
    } as unknown as ChartView;
    render(<ChartViewRenderer view={view} rows={ROWS} scalars={{ ctrT: 0.5 }} />);

    // Then: it resolved - no "not available" note for a guide that has a target
    expect(screen.queryByText(/Not available in this view/)).toBeNull();
  });
});

/**
 * The row field is ALREADY cumulative.
 *
 * `expIm` on a day is the plan from flight start through that day - it climbs by the daily plan
 * rate and its last value is the campaign's expected-to-date. Treating it as a per-day increment
 * and accumulating it again is quadratic: on the pacing this was found on, a cumulative chart's
 * expected line ended at 106.9M against a real 2.46M, and a daily chart drew that same climb where
 * a flat ~28,564/day target belonged.
 */
describe("expectedCurve", () => {
  // Three days of a plan running at 100/day, as Pacing stores it: 100, 200, 300.
  const ROWS_CUM: SeriesRow[] = [
    { date: "d1", expIm: 100, expCo: 1.5 },
    { date: "d2", expIm: 200, expCo: 3 },
    { date: "d3", expIm: 300, expCo: 4.5 },
  ];

  it("should plot a cumulative series as stored", () => {
    // Then: the curve IS the stored one - accumulating it again would end at 600, not 300
    expect(expectedCurve("im", "cumulative", ROWS_CUM)).toEqual([100, 200, 300]);
  });

  it("should plot a per-day series as the day-on-day delta", () => {
    // Then: a flat 100/day target, which is what a daily chart compares its bars against
    expect(expectedCurve("im", "perDay", ROWS_CUM)).toEqual([100, 100, 100]);
  });

  it("should round unit counts and leave money alone", () => {
    // Then: impressions are whole; a cost curve keeps its cents
    expect(expectedCurve("im", "perDay", [{ date: "d1", expIm: 0.4 }, { date: "d2", expIm: 1.1 }])).toEqual([0, 1]);
    expect(expectedCurve("sp", "perDay", ROWS_CUM)).toEqual([1.5, 1.5, 1.5]);
  });

  it("should treat a projection with no stated output as a daily one", () => {
    // Given: `cumulative` is the only value that plots the stored curve; the original tests for it
    // exactly and falls through to the delta. Defaulting the other way would draw a climbing total
    // where a flat daily target belongs.
    expect(expectedCurve("im", undefined, ROWS_CUM)).toEqual([100, 100, 100]);
  });

  it("should answer nothing for a basis with no expected curve", () => {
    expect(expectedCurve("cv", "perDay", ROWS_CUM)).toBeNull();
  });
});
