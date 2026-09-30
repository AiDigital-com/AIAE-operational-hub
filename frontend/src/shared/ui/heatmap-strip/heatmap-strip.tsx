import { memo, useState } from "react";
import "./heatmap-strip.css";

/**
 * One delivery day as the heatmap reads it — a structural subset of `PacingRecentDayV1`, kept
 * structural so the component depends on shapes, not on the generated schema module.
 */
export interface HeatmapDay {
  date?: string;
  impr?: number;
  cpm?: number;
  tgtCpm?: number;
  tgtImpr?: number;
  units?: number;
  tgtUnits?: number;
  tgtUnitsReforecast?: number;
  rate?: number;
  tgtRate?: number;
}

const STATUS = {
  ok: "var(--good)",
  warn: "var(--attention)",
  danger: "var(--bad)",
  muted: "var(--muted)",
} as const;

export interface HeatmapBand {
  color: string;
  opacity: number;
}

/**
 * Top cell = delivery volume in the rate type's NATIVE unit (CPM→impressions, CPC→clicks,
 * CPV→views): actual vs expected of the same unit. Within ±5% green, below red, above amber;
 * opacity scales with the ratio. Ported verbatim from Pacing's own HeatmapStrip so a day reads the
 * same colour here as it did there.
 */
export function heatmapDeliveryColor(dayUnits: number, dayTgtUnits: number): HeatmapBand {
  if (!dayTgtUnits) return { color: STATUS.muted, opacity: 0.3 };
  const ratio = dayUnits / dayTgtUnits;
  const pp = (ratio - 1) * 100;
  const color = pp >= -5 && pp <= 5 ? STATUS.ok : pp < -5 ? STATUS.danger : STATUS.warn;
  const opacity = Math.max(0.4, Math.min(0.9, ratio));
  return { color, opacity };
}

/**
 * Bottom strip = effective rate for the rate type (CPM/CPC/CPV) vs target rate. Lower-than-target
 * is good (cheaper); up to +15% over is amber, beyond that red. Ported verbatim.
 */
export function heatmapRateColor(dayRate: number, dayTgtRate: number): HeatmapBand {
  if (!dayTgtRate || !dayRate) return { color: STATUS.muted, opacity: 0.3 };
  const deviation = (dayRate - dayTgtRate) / dayTgtRate;
  if (deviation <= 0) return { color: STATUS.ok, opacity: 0.5 + Math.min(0.4, Math.abs(deviation)) };
  if (deviation <= 0.15) return { color: STATUS.warn, opacity: 0.5 + deviation * 2 };
  return { color: STATUS.danger, opacity: 0.7 + Math.min(0.2, deviation - 0.15) };
}

/** Native delivery unit label per rate type. */
export function unitLabel(rateType?: string | null): string {
  return rateType === "CPC" ? "Clicks" : rateType === "CPV" ? "Views" : "Impr";
}

/**
 * Currency formatting per rate type. CPM is conventionally 2 decimals even when sub-dollar ($0.48).
 * CPC/CPV can be fractions of a cent ($0.0005), so keep 4 decimals only when below $1.
 */
export function fmtRate(n: number | null | undefined, rateType?: string | null): string {
  if (n == null || !isFinite(n)) return "—";
  const dp = (rateType === "CPC" || rateType === "CPV") && Math.abs(n) < 1 ? 4 : 2;
  return "$" + n.toFixed(dp);
}

// Back-compat readers, same as the reference: new payloads carry units/tgtUnits/rate/tgtRate;
// CPM-only ones may only have impr/tgtImpr/cpm/tgtCpm. For CPM the pairs are identical.
const dlvVal = (r: HeatmapDay) => (r.units != null ? r.units : r.impr) || 0;
// Delivery target: always the pace-to-goal (reforecast) target, falling back to the static plan
// target on payloads that predate the field.
const dlvTgt = (r: HeatmapDay) =>
  (r.tgtUnitsReforecast != null ? r.tgtUnitsReforecast : r.tgtUnits != null ? r.tgtUnits : r.tgtImpr) || 0;
const rateVal = (r: HeatmapDay) => (r.rate != null ? r.rate : r.cpm) || 0;
const rateTgt = (r: HeatmapDay) => (r.tgtRate != null ? r.tgtRate : r.tgtCpm) || 0;

/** Cell layout: up to 7 cells, 7px wide, 2px gap; 7px delivery fill over a 2px rate bar. */
const CELL_W = 7;
const GAP = 2;
const FILL_H = 7;
const BORDER_H = 2;
const GAP_Y = 1;
const TOTAL_H = FILL_H + GAP_Y + BORDER_H;

interface HeatmapStripProps {
  /** Recent days, newest first as Pacing sends them; fewer than 2 renders a dash. */
  recent?: HeatmapDay[] | null;
  rateType?: string | null;
}

/**
 * A tiny SVG heatmap of the last (up to) 7 delivery days: per day, a delivery-volume cell over a
 * thin rate bar, each banded good/warn/bad by the ported colour rules above. Hover raises a small
 * tooltip with the day's actual/target volume and rate, each beside a swatch matching its band.
 *
 * Memoized: the 21-rect SVG re-renders only when `recent`/`rateType` change, so unrelated row
 * re-renders skip it.
 */
export const HeatmapStrip = memo(function HeatmapStrip({ recent, rateType }: HeatmapStripProps) {
  const [tooltip, setTooltip] = useState<{ i: number; r: HeatmapDay } | null>(null);

  if (!recent || recent.length < 2) return <span className="heatmap-strip__na">—</span>;

  const pts = [...recent].reverse().slice(-7);
  const totalW = pts.length * CELL_W + (pts.length - 1) * GAP;

  return (
    <span className="heatmap-strip" onMouseLeave={() => setTooltip(null)}>
      <svg width={totalW} height={TOTAL_H} viewBox={`0 0 ${totalW} ${TOTAL_H}`}>
        {pts.map((r, i) => {
          const x = i * (CELL_W + GAP);
          const dlv = heatmapDeliveryColor(dlvVal(r), dlvTgt(r));
          const rate = heatmapRateColor(rateVal(r), rateTgt(r));
          const isHovered = tooltip?.i === i;
          return (
            <g key={i} onMouseEnter={() => setTooltip({ i, r })}>
              {/* Delivery fill (native unit) */}
              <rect
                x={x}
                y={isHovered ? -1 : 0}
                width={CELL_W}
                height={isHovered ? FILL_H + 1 : FILL_H}
                rx={1.5}
                fill={dlv.color}
                opacity={isHovered ? Math.min(1, dlv.opacity + 0.3) : dlv.opacity}
              />
              {/* Rate border-bottom */}
              <rect
                x={x}
                y={FILL_H + GAP_Y}
                width={CELL_W}
                height={BORDER_H}
                rx={0.5}
                fill={rate.color}
                opacity={isHovered ? Math.min(1, rate.opacity + 0.3) : rate.opacity}
              />
              {/* Hover target (invisible, full height) */}
              <rect x={x} y={-2} width={CELL_W} height={TOTAL_H + 4} fill="transparent" />
            </g>
          );
        })}
      </svg>
      {tooltip &&
        (() => {
          const r = tooltip.r;
          const dlv = heatmapDeliveryColor(dlvVal(r), dlvTgt(r));
          const rate = heatmapRateColor(rateVal(r), rateTgt(r));
          return (
            <span className="heatmap-strip__tip" role="tooltip">
              <span className="heatmap-strip__tip-date">{r.date}</span>
              {/* Delivery first — matches the top cell. Square swatch = the fill block. */}
              <span className="heatmap-strip__tip-line">
                <span
                  className="heatmap-strip__swatch heatmap-strip__swatch--fill"
                  style={{ background: dlv.color, opacity: Math.min(1, dlv.opacity + 0.2) }}
                />
                <span>
                  {unitLabel(rateType)}: {dlvVal(r).toLocaleString()} / {dlvTgt(r).toLocaleString()}
                </span>
              </span>
              {/* Rate second — matches the bottom strip. Thin swatch = the rate bar. */}
              <span className="heatmap-strip__tip-line">
                <span
                  className="heatmap-strip__swatch heatmap-strip__swatch--bar"
                  style={{ background: rate.color, opacity: Math.min(1, rate.opacity + 0.2) }}
                />
                <span>
                  {rateType || "CPM"}: {fmtRate(rateVal(r), rateType)} / {fmtRate(rateTgt(r), rateType)}
                </span>
              </span>
            </span>
          );
        })()}
    </span>
  );
});
