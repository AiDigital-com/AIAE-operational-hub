import { memo } from "react";
import { HeatmapStrip } from "../../shared/ui/heatmap-strip/heatmap-strip";
import { KpiSpark } from "../../shared/ui/kpi-spark/kpi-spark";
import { MarginCell } from "../../shared/ui/margin-cell/margin-cell";
import { PacingBar } from "../../shared/ui/pacing-bar/pacing-bar";
import { Tooltip } from "../../shared/ui/tooltip/tooltip";
import { cn } from "../../shared/style/cn";
import { fmtBudget, fmtMD } from "../pacing/mock/format";
import type { PacingLineItemHealthV1, PacingRowV1 } from "../pacing-overview/types";

/** The group table's column count — the "no data" row spans everything after the chevron cell. */
const COLUMNS_AFTER_CHEVRON = 9;

/**
 * A line item's margin cell. A cost-coefficient line item has no margin target to be judged
 * against, so its figure renders neutrally instead of borrowing the good/warn/bad colours — same
 * rule as the reference. A line item with no margin data at all shows a dash.
 */
function LiMargin({ li }: { li: PacingLineItemHealthV1 }) {
  const actual = li.marginActualPct;
  if (actual == null) return <span className="overview__na">—</span>;
  if (li.costCoef || li.marginTargetPct == null) {
    return (
      <span className="overview__li-margin-neutral">
        {actual.toFixed(1)}%
        {li.marginTargetPct != null && <span className="overview__li-margin-target"> / {li.marginTargetPct.toFixed(0)}%</span>}
      </span>
    );
  }
  return <MarginCell actual={actual} target={li.marginTargetPct} />;
}

/**
 * The LI identity cell: an optional owner-assigned caption (the pacing's Display settings), the
 * `└ id · channel · rateType` line — hoverable when the line item carries a description — an
 * optional Paused badge, and the LI's own flight dates underneath.
 */
function LiIdentity({ li, name, desc }: { li: PacingLineItemHealthV1; name?: string; desc?: string }) {
  const idLine = (
    <span className="overview__li-id">
      <span className="overview__li-tree">└</span>
      <span className="overview__li-id-num">{li.lineItemId}</span>
      <span className="overview__li-dot">·</span>
      <span>{li.channel || "—"}</span>
      <span className="overview__li-dot">·</span>
      <span>{li.rateType}</span>
    </span>
  );
  return (
    <div className="overview__li-identity">
      {name && (
        <div className="overview__li-caption" title={name}>
          {name}
        </div>
      )}
      <div>
        {desc ? <Tooltip content={desc}>{idLine}</Tooltip> : idLine}
        {li.isPaused && <span className="overview__li-paused">Paused</span>}
      </div>
      {(li.flightStart || li.flightEnd) && (
        <div className="overview__li-flight">
          {li.flightStart ? fmtMD(li.flightStart) : "—"}
          <span className="overview__li-flight-sep">–</span>
          {li.flightEnd ? fmtMD(li.flightEnd) : "—"}
        </div>
      )}
    </div>
  );
}

/**
 * The expanded line-item rows of one pacing — native `<tr>`s of the SAME group table, so Budget /
 * Margin / Pacing line up under their column headers (the whole reason these are not a nested
 * table). Each row carries the 7-day delivery heatmap in the Flight column and the KPI sparklines
 * across the last three — LIs, NS diff and actions, none of which a line item has its own value for.
 * A row is washed red/amber when that LI's own pacing index is beyond ±5pp.
 */
export const LineItemRows = memo(function LineItemRows({ row }: { row: PacingRowV1 }) {
  const lineItems = row.lineItems ?? [];
  if (lineItems.length === 0) {
    return (
      <tr className="overview__li-row">
        <td />
        <td colSpan={COLUMNS_AFTER_CHEVRON} className="overview__li-none">
          No line item data
        </td>
      </tr>
    );
  }
  return (
    <>
      {lineItems.map((li) => {
        const liUnder = li.pacingIndex != null && li.pacingIndex < -5;
        const liOver = li.pacingIndex != null && li.pacingIndex > 5;
        return (
          <tr
            key={li.lineItemId}
            className={cn(
              "overview__li-row",
              liUnder && "overview__li-row--under",
              liOver && "overview__li-row--over",
            )}
          >
            <td />
            <td>
              <LiIdentity li={li} name={row.liNames?.[li.lineItemId]} desc={row.liDesc?.[li.lineItemId]} />
            </td>
            <td />
            <td className="overview__num overview__budget">{fmtBudget(li.budget ?? 0)}</td>
            <td className="overview__num">
              <LiMargin li={li} />
            </td>
            <td className="overview__num">
              <PacingBar pp={li.pacingIndex ?? null} />
            </td>
            <td className="overview__li-heat">
              <HeatmapStrip recent={li.recent} rateType={li.rateType} />
            </td>
            <td colSpan={3} className="overview__li-kpi">
              <KpiSpark recent={li.recent} kpis={li.kpis} />
            </td>
          </tr>
        );
      })}
    </>
  );
});
