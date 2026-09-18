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
import type { ChartCalcSeries, ChartSeriesDef, ChartValueSeries, ChartView } from "./widget-types";
import "./chart-view.css";

type Formatter = (n: number) => string;

function formatterFor(key: string | undefined): Formatter {
  switch (key) {
    case "currency":
    case "currency4":
      return (n) => fmtMoney(n);
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
  dashed: boolean;
  axis: "left" | "right";
  color: string;
  data: Array<number | null>;
  formatter: Formatter;
}

const PALETTE = ["var(--primary)", "hsl(var(--chart-sky))", "hsl(var(--chart-grey))"];

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
  const color = PALETTE[index % PALETTE.length];
  if (isValueSeries(series)) {
    const metric = series.value?.metric;
    const daily = metric ? fieldOf(rows, metric) : null;
    if (!metric || !daily) {
      return { resolved: null, unsupported: series.label || metric || series.id };
    }
    const data = series.accumulate === "cumulative" ? cumulativeOf(daily.map((v) => v ?? 0)) : daily;
    return {
      resolved: {
        key: series.id,
        label: series.label,
        kind: (series.style?.type as "area" | "bar" | "line") || "line",
        dashed: !!series.dashed,
        axis,
        // The spec names a semantic color slot ("actualFill", "impressions", …) from a palette this
        // build does not port - cycling our own small chart palette instead of trying to map it.
        color,
        data,
        formatter: seriesValueFormatter(metric),
      },
      unsupported: null,
    };
  }
  if (isProjectionSeries(series)) {
    // The expected curve is `exp` + the basis field, capitalised: expIm, expCo,
    // expCl, expVw. Pacing computes it per day with the container and pause rules
    // applied, which a straight-line guess on this side would have missed.
    const expectedField = "exp" + series.basis.charAt(0).toUpperCase() + series.basis.slice(1);
    const perDay = fieldOf(rows, expectedField);
    if (!perDay) {
      return { resolved: null, unsupported: series.label || series.basis };
    }
    const data = series.output === "perDay" ? perDay : cumulativeOf(perDay.map((v) => v ?? 0));
    return {
      resolved: {
        key: series.id,
        label: series.label,
        kind: "line",
        dashed: true,
        axis,
        color: "hsl(var(--chart-grey))",
        data,
        formatter: series.basis === "sp" ? (n) => fmtMoney(n) : (n) => fmtInt(n),
      },
      unsupported: null,
    };
  }
  return { resolved: null, unsupported: seriesLabel(series) };
}

/** Resolves a chart series' `guide` (target reference line) - only `ctr` has a real, computable
 *  target on this side (`fl.ctrT`, the same budget-weighted CTR target `campaign-metrics.ts` computes
 *  for the KPI bricks); every other guide key (`vcr`, `bidPlanCpm`, `cpc`, `cpv`) is unsupported for
 *  the same reason those value series are (see the module doc comment) and simply draws no line. */
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
}: {
  view: ChartView;
  rows: readonly SeriesRow[];
  scalars: Record<string, number>;
}) {
  const dates = useMemo(() => rows.map((r) => r.date), [rows]);

  const { series, unsupported } = useMemo(() => {
    const resolvedSeries: ResolvedSeries[] = [];
    const unsupportedLabels: string[] = [];
    (view.series || []).forEach((s, i) => {
      const { resolved, unsupported: label } = resolveSeries(s, i, rows);
      if (resolved) resolvedSeries.push(resolved);
      else if (label) unsupportedLabels.push(label);
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
          {series.map((s) => {
            const common = {
              dataKey: s.key,
              name: s.key,
              yAxisId: s.axis,
              stroke: s.color,
              connectNulls: false,
            };
            if (s.kind === "bar") return <Bar key={s.key} {...common} fill={s.color} radius={[2, 2, 0, 0]} />;
            if (s.kind === "area") return <Area key={s.key} {...common} fill={s.color} fillOpacity={0.18} strokeWidth={2} />;
            return (
              <Line
                key={s.key}
                {...common}
                strokeWidth={s.dashed ? 1.5 : 2}
                strokeDasharray={s.dashed ? "6 4" : undefined}
                dot={false}
              />
            );
          })}
          {view.series.map((s) => {
            const guide = (s as ChartValueSeries).guide;
            if (!guide) return null;
            const target = guideValueFor(guide.value.key, scalars);
            return target == null ? null : (
              <ReferenceLine
                key={`${s.id}-guide`}
                yAxisId="left"
                y={target}
                stroke="var(--muted)"
                strokeDasharray="2 4"
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
