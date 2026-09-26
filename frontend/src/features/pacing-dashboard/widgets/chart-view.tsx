/**
 * Renders one widget's `kind: "chart"` view (§6, US-115) with recharts - proper axes, a grid, a
 * hover tooltip and human-formatted numbers, replacing the previous fixed hand-rolled-SVG five-chart
 * block. The "expected" reference series is always labelled with whatever the widget's own spec calls
 * it ("Expected", "Cost Budget", "Expected / day" - see `shared/std-entries.js`'s `chartSeed`) - never
 * relabelled "Forecast" (US-115).
 *
 * Metric/basis coverage is intentionally narrower than the SPA's full v2 report engine (see
 * `campaign-metrics.ts`'s doc comment): `im`, `sp`, `cl`, `coViews`, `cpm` and `ctr` are real
 * computations; `vcr`, `cpc` and `cpv` are not (no per-rate-type buying-rate/VCR-eligibility model on
 * this side) and render as a labelled, visible "not available" note instead of a silently missing
 * line or a crash.
 */
import { useMemo } from "react";
import {
  Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from "recharts";
import { fmtDate } from "../../pacing/mock/format";
import { fmtInt, fmtMoney, fmtMoneyPrecise, fmtPercent } from "../format";
import type { SeriesRow } from "../types-metrics";
import { chartPaint } from "./chart-paint";
import type { ChartCalcSeries, ChartSeriesDef, ChartValueSeries, ChartView } from "./widget-types";
import "./chart-view.css";

type Formatter = (n: number) => string;

function formatterFor(key: string | undefined): Formatter {
  switch (key) {
    case "currency":
      return (n) => fmtMoney(n);
    // Below one cent, two decimals rounds every value to "$0.00" - the reason fmtMoneyPrecise exists
    // (CPC/CPV-scale axes). Same split the SPA's chart-format.js draws between "currency"/"currency4".
    case "currency4":
      return (n) => fmtMoneyPrecise(n);
    case "kilo":
      return (n) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
    case "percent2":
    case "percent1":
      return (n) => fmtPercent(n);
    case "number":
    default:
      return (n) => fmtInt(n);
  }
}

/**
 * Table F, translated once - ported from the SPA's ReportChart.jsx so a stored `style`/`dashed` value
 * resolves to the same recharts prop it did there. The Hub's chart is vertical-only (no `orientation`
 * concept yet), so only the vertical bar radius is carried over.
 */
const STROKE_WIDTH: Record<string, number> = { thin: 1.25, normal: 2, bold: 3 };
const CURVE_TYPE: Record<string, "linear" | "monotone" | "stepAfter"> = {
  straight: "linear",
  smooth: "monotone",
  step: "stepAfter",
};
const AREA_FILL: Record<string, number> = { light: 0.1, strong: 0.32 };
const DASH_PATTERN = "6 3";
const DASH_PATTERNS: Record<string, string> = { short: "4 3", medium: "6 3", long: "10 4" };
const BAR_RADIUS: [number, number, number, number] = [3, 3, 0, 0];

function dashOf(value: boolean | string | undefined): string | undefined {
  if (value === true) return DASH_PATTERN;
  if (typeof value === "string") return DASH_PATTERNS[value];
  return undefined;
}

function strokeWidthOf(width: number | string | undefined, fallback: number): number {
  if (typeof width === "number") return width;
  if (typeof width === "string" && width in STROKE_WIDTH) return STROKE_WIDTH[width];
  return fallback;
}

/** Full-precision formatter for a series' own value (tooltip/legend), distinct from the axis tick
 *  formatter above which favors compact ("12.3k") ticks. */
function seriesValueFormatter(metric: string | undefined): Formatter {
  if (metric === "sp" || metric === "cpm" || metric === "cpc" || metric === "cpv") {
    return metric === "cpv" ? (n) => fmtMoneyPrecise(n) : (n) => fmtMoney(n);
  }
  if (metric === "ctr" || metric === "vcr") return percentReadable;
  return (n) => fmtInt(n);
}

/**
 * A percentage with enough decimals to actually read.
 *
 * The two-decimal form is right for the figures this product usually shows — a
 * 98.54% completion rate, a 70.11% margin. It is useless for a CTV campaign's
 * click-through rate, which runs around 0.0005%: every point on the curve reads
 * "0.00%", and a tooltip is precisely where somebody goes to find out what the
 * number actually is.
 *
 * So: two decimals down to 0.01%, and below that as many as it takes to show two
 * significant digits, capped at six so a float's tail never leaks into the UI.
 * Deliberately NOT applied to the axis ticks, which stay on the canonical
 * two-decimal form — an axis is a scale, and five decimals on it is noise.
 */
function percentReadable(n: number): string {
  if (n == null || Number.isNaN(n)) return fmtPercent(n);
  const magnitude = Math.abs(n);
  if (magnitude === 0 || magnitude >= 0.01) return fmtPercent(n);
  // Below the cap the honest answer is a bound, not a row of zeroes: "0.000000%"
  // claims a precision it does not have and reads as "nothing", which for a rate
  // that is merely very small is the wrong thing to tell someone.
  if (magnitude < 0.000001) return n < 0 ? "> -0.000001%" : "< 0.000001%";
  const decimals = Math.min(6, Math.ceil(-Math.log10(magnitude)) + 1);
  // toFixed pads to a fixed width, so 0.0005 comes out "0.00050". Drop the tail:
  // a trailing zero here suggests a measured digit that was never measured.
  return `${Number(n.toFixed(decimals))}%`;
}

function seriesLabel(series: ChartSeriesDef): string {
  const label = (series as { label?: unknown }).label;
  return typeof label === "string" && label ? label : series.id;
}

function isValueSeries(s: ChartSeriesDef): s is ChartValueSeries {
  return s.kind === "value";
}
function isProjectionSeries(s: ChartSeriesDef): s is ChartCalcSeries {
  return s.kind === "calc" && (s as ChartCalcSeries).calc === "projection";
}

/**
 * Which row field carries the expected curve for a projection series' basis.
 *
 * A TABLE, not a rule. The obvious rule - "exp" + the capitalised basis - is right for two of
 * the four and wrong for the other two, and wrong in the quietest possible way: the field simply
 * is not on the row, the series reports itself unsupported, and the chart draws without its
 * expected line while everything else about it looks correct. That is what happened to
 * "Cumulative Spend vs Cost Budget" and "Daily Spend & CPM" - both plot spend, both lost their
 * budget curve, neither said so.
 *
 * `sp` is the trap. Its expected field is `expCo`, and `expCo` is expected COST - not completes,
 * which is what the name suggests beside `expIm`/`expCl`. Pacing computes it as
 * `liExpCost(p, to) - base.co`.
 */
/** Is this series' guide a projection curve rather than a horizontal target line? */
function isProjectionGuide(guide: unknown): boolean {
  return !!guide && typeof guide === "object" && (guide as { calc?: string }).calc === "projection";
}

/**
 * The expected curve a Pacing-authored chart attaches to its actual series.
 *
 * Two stored shapes mean the same thing. A pacing built from the newer templates carries the
 * projection as its own `kind: "calc"` series; one built from the older ones carries it as a
 * `guide` hanging off the actual series - and the guide deliberately stores NEITHER basis nor
 * output, because the series it hangs on already says both: its `value.metric` is the basis and
 * its `accumulate` decides per-day versus cumulative.
 *
 * Both shapes are live. The Hub understood only the first, so a pacing created before the
 * template change - which is every pacing migrated from the original service - drew its charts
 * with no expected curve at all, and said nothing, because a guide it could not read as a target
 * line simply produced no line.
 */
function resolveProjectionGuide(
  parent: ChartValueSeries,
  index: number,
  rows: readonly SeriesRow[]
): { resolved: ResolvedSeries | null; unsupported: string | null } {
  const guide = parent.guide;
  const basis = parent.value?.metric;
  const label = guide?.label || "Expected";
  // The guide stores no output of its own - the series it hangs on decides, and `accumulate`
  // is where it says so.
  const data = basis
    ? expectedCurve(basis, parent.accumulate === "cumulative" ? "cumulative" : "perDay", rows)
    : null;
  if (!data) return { resolved: null, unsupported: label };
  const style = guide?.style;
  // A guide's own color/dashed win when the spec carries them; "expected" is the semantic default for
  // a plan curve when it does not - the same default the SPA's ReportChart (`fixedGuideColor`) takes.
  const paint = chartPaint(guide?.color ?? "expected", index);
  return {
    resolved: {
      key: `${parent.id}-expected`,
      label,
      axis: parent.axis === "right" ? "right" : "left",
      color: paint,
      fill: paint,
      border: paint,
      kind: "line",
      curve: CURVE_TYPE[style?.curve ?? ""] || "monotone",
      strokeWidth: strokeWidthOf(style?.width, 1.5),
      // Dashed for the same reason the stored guide is: it is a plan, drawn beside a fact.
      dash: dashOf(guide?.dashed ?? true),
      fillOpacity: 1,
      strokeOpacity: guide?.opacity ?? 1,
      points: !!style?.points,
      data,
      formatter: seriesValueFormatter(basis as string),
    },
    unsupported: null,
  };
}

const EXPECTED_FIELD: Record<string, { field: string; round: boolean }> = {
  im: { field: "expIm", round: true },
  cl: { field: "expCl", round: true },
  coViews: { field: "expVw", round: true },
  // Money is not rounded to whole units; the other three are counts.
  sp: { field: "expCo", round: false },
};

/**
 * The expected curve for one basis, at the output the series asks for.
 *
 * THE ROW FIELD IS ALREADY CUMULATIVE. `expIm` on a given day is the plan from flight start
 * THROUGH that day - it climbs by the daily plan rate and its last value equals the campaign's
 * expected-to-date exactly. So a cumulative series plots it as it stands, and a per-day series
 * plots the delta between consecutive days.
 *
 * This was backwards, and the result was not subtle. A cumulative chart accumulated an
 * already-accumulated curve, so its expected line left the top of the plot: 106.9M against a real
 * 2.46M on the pacing this was found on. A daily chart drew the cumulative climb where a flat
 * ~28,564/day target belonged. Every chart with an expected line was wrong, in one direction or
 * the other, while the actual line beside it was right - which is what made it read as a drawing
 * problem rather than an arithmetic one.
 */
export function expectedCurve(
  basis: string,
  output: string | undefined,
  rows: readonly SeriesRow[]
): Array<number | null> | null {
  const spec = EXPECTED_FIELD[basis];
  if (!spec) return null;
  const cumulative = fieldOf(rows, spec.field);
  if (!cumulative) return null;
  const round = (v: number) => (spec.round ? Math.round(v) : v);
  // `cumulative` is the only value that plots the curve as stored; anything else - including an
  // absent output - is a day-on-day series. That polarity is the original's (`projectionPlan`
  // tests `output === 'cumulative'` and falls through to the delta), and it matters for a
  // projection authored without an explicit output: defaulting the other way would draw a
  // climbing total where a flat daily target belongs.
  if (output === "cumulative") return cumulative.map((v) => (v == null ? null : round(v)));
  let previous = 0;
  return cumulative.map((v) => {
    const current = v ?? 0;
    const delta = current - previous;
    previous = current;
    return round(delta);
  });
}






/** Sums the plan-derived expected cumulative curve for `basis` (im/cl/coViews use the line item's
 *  own `plannedImpressions` per the shared PacingCore convention that a CPC/CPV plan repurposes that
 *  field for its own unit - see `campaign-metrics.ts`; `sp` uses `clientBudget`). */




function cumulativeOf(values: number[]): number[] {
  let running = 0;
  return values.map((v) => (running += v));
}

interface ResolvedSeries {
  key: string;
  label: string;
  kind: "area" | "bar" | "line";
  axis: "left" | "right";
  /** Stroke (line/area) or legend-swatch paint. */
  color: string;
  /** Area/bar fill paint - falls back to `color` when the spec carries no separate `fill` token. */
  fill: string;
  /** Bar stroke paint - falls back to `color` when the spec carries no separate `border` token. */
  border: string;
  curve: "linear" | "monotone" | "stepAfter";
  strokeWidth: number;
  /** recharts `strokeDasharray`, or `undefined` for a solid line. */
  dash: string | undefined;
  fillOpacity: number;
  strokeOpacity: number;
  points: boolean;
  data: Array<number | null>;
  formatter: Formatter;
}

/**
 * Pull one named field out of the per-day rows Pacing computed.
 *
 * Every row carries the flow fields, the expected curve and the rates, worked
 * out by the same engine as the headline figures — so a chart and the number
 * above it cannot disagree. There is no supported-metric list here any more:
 * whatever the row carries, a series can plot, and a name the rows do not carry
 * is reported as unsupported rather than silently drawn as zeroes.
 */
function fieldOf(rows: readonly SeriesRow[], field: string): Array<number | null> | null {
  if (!rows.length || !(field in rows[0])) return null;
  return rows.map((r) => {
    const v = r[field];
    return typeof v === "number" ? v : null;
  });
}

function resolveSeries(
  series: ChartSeriesDef,
  index: number,
  rows: readonly SeriesRow[]
): { resolved: ResolvedSeries | null; unsupported: string | null } {
  const axis = (series as ChartValueSeries).axis === "right" ? "right" : "left";
  if (isValueSeries(series)) {
    const metric = series.value?.metric;
    const daily = metric ? fieldOf(rows, metric) : null;
    if (!metric || !daily) {
      return { resolved: null, unsupported: series.label || metric || series.id };
    }
    const data = series.accumulate === "cumulative" ? cumulativeOf(daily.map((v) => v ?? 0)) : daily;
    const style = series.style;
    const kind = (style?.type as "area" | "bar" | "line") || "line";
    // Fill/border fall back to the series' own `color` token, exactly as ReportChart's
    // `chartPaint(s.fill == null ? s.color : s.fill, i)` does - most stored series set only `color`
    // and expect the fill/border to follow it (e.g. the CTR/VCR lines have no `fill` of their own).
    return {
      resolved: {
        key: series.id,
        label: series.label,
        kind,
        axis,
        color: chartPaint(series.color, index),
        fill: chartPaint(series.fill ?? series.color, index),
        border: chartPaint(series.border ?? series.color, index),
        curve: CURVE_TYPE[style?.curve ?? ""] || "monotone",
        strokeWidth: kind === "bar" ? strokeWidthOf(style?.width, 1) : strokeWidthOf(style?.width, 2),
        dash: dashOf(series.dashed),
        // The stored `opacity` (almost always `1`) is a multiplier on top of the paint's OWN alpha -
        // an area/bar fill token like "actualFill"/"spendFill" is already a low-alpha rgba, so
        // opacity:1 means "draw the token as authored", not "draw it solid". AREA_FILL only kicks in
        // when a series carries no explicit opacity at all.
        fillOpacity:
          kind === "area" ? series.opacity ?? AREA_FILL[style?.fill ?? ""] ?? AREA_FILL.light : series.opacity ?? 0.75,
        strokeOpacity: series.opacity ?? 1,
        points: !!style?.points,
        data,
        formatter: seriesValueFormatter(metric),
      },
      unsupported: null,
    };
  }
  if (isProjectionSeries(series)) {
    // Pacing computes the expected curve per day with the container and pause rules applied,
    // which a straight-line guess on this side would have missed. Looked up, not derived: see
    // EXPECTED_FIELD.
    const data = expectedCurve(series.basis, series.output, rows);
    if (!data) {
      return { resolved: null, unsupported: series.label || series.basis };
    }
    const style = series.style;
    const paint = chartPaint(series.color ?? "expected", index);
    return {
      resolved: {
        key: series.id,
        label: series.label,
        kind: "line",
        axis,
        color: paint,
        fill: paint,
        border: paint,
        curve: CURVE_TYPE[style?.curve ?? ""] || "monotone",
        strokeWidth: strokeWidthOf(style?.width, 1.5),
        dash: dashOf(series.dashed ?? true),
        fillOpacity: 1,
        strokeOpacity: series.opacity ?? 1,
        points: !!style?.points,
        data,
        formatter: series.basis === "sp" ? (n) => fmtMoney(n) : (n) => fmtInt(n),
      },
      unsupported: null,
    };
  }
  return { resolved: null, unsupported: seriesLabel(series) };
}

/** Resolves a chart series' `guide` (target reference line) by the convention Pacing stores its
 *  targets under: a guide named `ctr` reads `ctrT`, `vcr` reads `vcrT`. Both are in the scalar bag,
 *  budget-weighted the same way the KPI bricks read them. A key with no `<key>T` beside it draws no
 *  line, which is the honest answer - there is nothing to compare against. */
function guideValueFor(key: string, scalars: Record<string, number>): number | null {
  // Guide keys name a TARGET, and Pacing computes those into the scalar bag with
  // the same budget weighting it uses everywhere else - "ctr" reads ctrT. A key
  // with no target in the bag draws no line, which is the honest answer: there is
  // nothing to compare against.
  const v = scalars[key + "T"];
  return typeof v === "number" ? v : null;
}

export function ChartViewRenderer({
  view,
  rows,
  scalars,
  journalHighlight = null,
}: {
  view: ChartView;
  rows: readonly SeriesRow[];
  scalars: Record<string, number>;
  /** The journal's highlighted-entry date (§15 follow-up, from `pacing-dashboard.tsx`'s page-level
   *  state) - draws a vertical marker on this view when its own spec carries `journal: true`. Every
   *  view this renderer draws already plots one row per day (`dataKey="date"` below), so the
   *  reference's "date axis only" rule holds trivially here - there is no categorical-axis chart on
   *  this side to accidentally draw it on. */
  journalHighlight?: string | null;
}) {
  const dates = useMemo(() => rows.map((r) => r.date), [rows]);

  const { series, unsupported } = useMemo(() => {
    const resolvedSeries: ResolvedSeries[] = [];
    const unsupportedLabels: string[] = [];
    (view.series || []).forEach((s, i) => {
      const { resolved, unsupported: label } = resolveSeries(s, i, rows);
      if (resolved) resolvedSeries.push(resolved);
      else if (label) unsupportedLabels.push(label);
      // A projection guide is a second CURVE on this series, not a property of the first, so it
      // is resolved alongside rather than inside resolveSeries.
      if (isValueSeries(s) && isProjectionGuide((s as ChartValueSeries).guide)) {
        const g = resolveProjectionGuide(s as ChartValueSeries, i + 1, rows);
        if (g.resolved) resolvedSeries.push(g.resolved);
        else if (g.unsupported) unsupportedLabels.push(g.unsupported);
      }
    });
    return { series: resolvedSeries, unsupported: unsupportedLabels };
  }, [view.series, rows]);

  const leftFormatter = formatterFor(view.formats?.left);
  const rightFormatter = formatterFor(view.formats?.right);
  const hasRight = series.some((s) => s.axis === "right");

  if (series.length === 0) {
    return (
      <div className="cview cview--empty">
        {unsupported.length > 0 ? `Not available in this view: ${unsupported.join(", ")}.` : "No data yet"}
      </div>
    );
  }

  const data = dates.map((date, i) => {
    const row: Record<string, unknown> = { date };
    for (const s of series) row[s.key] = s.data[i];
    return row;
  });

  return (
    <div className="cview">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 4, right: hasRight ? 8 : 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => fmtDate(d)}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            yAxisId="left"
            tickFormatter={leftFormatter}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          {hasRight && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={rightFormatter}
              tick={{ fontSize: 11, fill: "var(--muted)" }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
          )}
          <Tooltip
            labelFormatter={(d: string) => fmtDate(d)}
            formatter={(value: number, name: string) => {
              const s = series.find((x) => x.key === name || x.label === name);
              return [s ? s.formatter(value) : fmtInt(value), s?.label ?? name];
            }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} formatter={(value: string) => {
            const s = series.find((x) => x.key === value);
            return s?.label ?? value;
          }} />}
          {view.journal && journalHighlight && (
            <ReferenceLine
              yAxisId="left"
              x={journalHighlight}
              stroke="var(--attention)"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={{ value: "Journal", position: "insideTopLeft", fill: "var(--attention)", fontSize: 10 }}
            />
          )}
          {series.map((s) => {
            const common = { dataKey: s.key, name: s.key, yAxisId: s.axis, connectNulls: false };
            if (s.kind === "bar") {
              return (
                <Bar
                  key={s.key}
                  {...common}
                  fill={s.fill}
                  fillOpacity={s.fillOpacity}
                  stroke={s.border}
                  strokeWidth={s.strokeWidth}
                  radius={BAR_RADIUS}
                />
              );
            }
            if (s.kind === "area") {
              return (
                <Area
                  key={s.key}
                  {...common}
                  type={s.curve}
                  stroke={s.color}
                  strokeWidth={s.strokeWidth}
                  strokeDasharray={s.dash}
                  strokeOpacity={s.strokeOpacity}
                  fill={s.fill}
                  fillOpacity={s.fillOpacity}
                  dot={false}
                />
              );
            }
            return (
              <Line
                key={s.key}
                {...common}
                type={s.curve}
                stroke={s.color}
                strokeWidth={s.strokeWidth}
                strokeDasharray={s.dash}
                strokeOpacity={s.strokeOpacity}
                dot={s.points ? { r: 2.5, fill: s.color, stroke: s.color } : false}
              />
            );
          })}
          {view.series.map((s) => {
            const guide = (s as ChartValueSeries).guide;
            const guideKey = guide?.value?.key;
            // A projection guide is already drawn as a curve above; only a target guide belongs here.
            if (!guide || isProjectionGuide(guide) || !guideKey) return null;
            const target = guideValueFor(guideKey, scalars);
            // No `guide.color` on a target line in real specs (see pacingogan.json's CTR/VCR guides) -
            // "expected" is the same default ReportChart's `fixedGuideColor` falls back to.
            const paint = chartPaint(guide.color ?? "expected", 0);
            return target == null ? null : (
              <ReferenceLine
                key={`${s.id}-guide`}
                yAxisId="left"
                y={target}
                stroke={paint}
                strokeDasharray={dashOf(guide.dashed ?? true)}
                label={{ value: guide.label || "Target", fontSize: 10, fill: "var(--muted)" }}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
      {unsupported.length > 0 && (
        <div className="cview__note">Not available in this view: {unsupported.join(", ")}.</div>
      )}
    </div>
  );
}
