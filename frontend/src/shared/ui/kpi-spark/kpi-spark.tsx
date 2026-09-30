import { memo, useState } from "react";
import { kpiBandStatus, type KpiBand } from "./kpi-band";
import "./kpi-spark.css";

/**
 * KpiSpark — compact 7-day sparkline(s) of a line item's KPI(s): CTR and/or VCR/ACR. Ported from
 * Pacing's own `KpiTrend`, colour split included (it avoids the "good week, today dipped → all red"
 * confusion):
 * - line  → WEEK status: the weighted KPI over the window (Σunit / Σimpr vs target)
 * - value / last dot → LAST DAY vs target
 * - hover dot → that day vs target
 */

/** One day as the sparkline reads it — a structural subset of `PacingRecentDayV1`. */
export interface KpiSparkDay {
  date?: string;
  impr?: number;
  clicks?: number;
  completes?: number;
  ctr?: number;
  vcr?: number;
}

/** One KPI target — a structural subset of `PacingKpiTargetV1`. */
export interface KpiSparkTarget {
  type?: string;
  tgt?: number | null;
  low?: number | null;
  high?: number | null;
}

/** Line/dot paint per band. */
const PAINT: Record<KpiBand, string> = {
  g: "var(--good)",
  w: "var(--attention)",
  b: "var(--bad)",
  n: "var(--muted)",
};

/** The printed value uses the text-safe amber — the fill amber is too light for 10px digits. */
const INK: Record<KpiBand, string> = {
  g: "var(--good)",
  w: "var(--attention-text)",
  b: "var(--bad)",
  n: "var(--muted)",
};

/**
 * Colour from the shared band. Falls back to the reference's sparkline defaults (0.7 / 1.3) when a
 * bound is absent; an explicit null bound stays null (that side disabled), exactly as the reference
 * distinguishes them.
 */
export function sparkBand(value: number, tgt: number | null | undefined, low?: number | null, high?: number | null): KpiBand {
  if (tgt == null || !(tgt > 0)) return "n";
  return kpiBandStatus(value / tgt, low === undefined ? 0.7 : low, high === undefined ? 1.3 : high);
}

/** Audio LIs label their completion-rate KPI "ACR"; the series is the same completes/impr as VCR. */
const isComplKpi = (type?: string) => type === "VCR" || type === "ACR";

const fmtKpi = (type: string | undefined, v: number) => (isComplKpi(type) ? `${v.toFixed(1)}%` : `${v.toFixed(2)}%`);

const H = 12;
const PAD = 1;

function MiniSpark({ kpi, pts, showValue, w }: { kpi: KpiSparkTarget; pts: KpiSparkDay[]; showValue: boolean; w: number }) {
  const [tip, setTip] = useState<{ i: number } | null>(null);
  const key = isComplKpi(kpi.type) ? "vcr" : "ctr";
  const unitKey = isComplKpi(kpi.type) ? "completes" : "clicks";
  const vals = pts.map((p) => Number(p[key]) || 0);
  const last = vals[vals.length - 1];

  // Week = weighted KPI over the window (not the mean of daily ratios — low volume days shouldn't
  // skew the colour).
  let su = 0;
  let si = 0;
  for (const p of pts) {
    su += Number(p[unitKey]) || 0;
    si += Number(p.impr) || 0;
  }
  const week = si > 0 ? (su / si) * 100 : 0;

  const lineBand = sparkBand(week, kpi.tgt, kpi.low, kpi.high);
  const lastBand = sparkBand(last, kpi.tgt, kpi.low, kpi.high);

  const n = vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => PAD + (n === 1 ? 0 : (i * (w - 2 * PAD)) / (n - 1));
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
  const line = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <span className="kpi-spark__item" onMouseLeave={() => setTip(null)}>
      <span className="kpi-spark__label">{kpi.type}</span>
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`}>
        <polyline
          points={line}
          fill="none"
          stroke={PAINT[lineBand]}
          strokeWidth="1.25"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.9"
        />
        <circle cx={x(n - 1)} cy={y(last)} r="1.6" fill={PAINT[lastBand]} />
        {tip && (
          <circle
            cx={x(tip.i)}
            cy={y(vals[tip.i])}
            r="2.2"
            fill={PAINT[sparkBand(vals[tip.i], kpi.tgt, kpi.low, kpi.high)]}
            stroke="var(--surface)"
            strokeWidth="1"
          />
        )}
        {vals.map((_, i) => (
          <rect
            key={i}
            x={x(i) - w / (2 * n)}
            y={-2}
            width={w / n}
            height={H + 4}
            fill="transparent"
            onMouseEnter={() => setTip({ i })}
          />
        ))}
      </svg>
      {showValue && (
        <span className="kpi-spark__value" style={{ color: INK[lastBand] }}>
          {fmtKpi(kpi.type, last)}
        </span>
      )}
      {tip && (
        <span className="kpi-spark__tip" role="tooltip">
          <span className="kpi-spark__tip-date">{pts[tip.i].date}</span>
          <span>
            {kpi.type}: {fmtKpi(kpi.type, vals[tip.i])}
            {kpi.tgt != null && kpi.tgt > 0 && ` / ${fmtKpi(kpi.type, kpi.tgt)}`}
          </span>
          <span>
            Impr: {(pts[tip.i].impr || 0).toLocaleString()}
            {" · "}
            {isComplKpi(kpi.type) ? "Compl" : "Clk"}: {(Number(pts[tip.i][unitKey]) || 0).toLocaleString()}
          </span>
        </span>
      )}
    </span>
  );
}

interface KpiSparkProps {
  /** Recent days, newest first as Pacing sends them; fewer than 2 renders a dash. */
  recent?: KpiSparkDay[] | null;
  kpis?: KpiSparkTarget[] | null;
}

/**
 * One mini sparkline per KPI in `kpis`. Width 54 with the printed value when there is one KPI, 32
 * without it when there are two — the reference's own trade for the row's fixed width. Memoized:
 * the SVGs re-render only when `recent`/`kpis` change.
 */
export const KpiSpark = memo(function KpiSpark({ recent, kpis }: KpiSparkProps) {
  if (!recent || recent.length < 2 || !kpis || kpis.length === 0) {
    return <span className="kpi-spark__na">—</span>;
  }
  const pts = [...recent].reverse(); // oldest → newest
  const single = kpis.length === 1;
  const w = single ? 54 : 32;
  return (
    <span className="kpi-spark">
      {kpis.map((k) => (
        <MiniSpark key={k.type} kpi={k} pts={pts} showValue={single} w={w} />
      ))}
    </span>
  );
});
