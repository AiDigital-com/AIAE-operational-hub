/**
 * The top-level widget renderer (§6 fix): walks `display.widgets[]` -> each widget's `spec.views[]`
 * -> layout rows/cols/bricks | chart | kpi, exactly the structure the server sends. This REPLACES the
 * previous fixed five-chart block, which ignored `display.widgets` entirely and drew the same five
 * hand-rolled charts no matter what the widget list said - the bug this whole rework exists to fix.
 *
 * Degrade rule, applied at every dispatch point (widget kind, view kind, brick type): an unrecognized
 * value renders a small, visible, explained placeholder (`UnsupportedBrick`) - never a silent blank
 * box, and never a thrown error that takes the rest of the page down with it.
 */
import { useMemo } from "react";
import { cn } from "../../../shared/style/cn";
import { BrickColumn, UnsupportedBrick, BigStat } from "./brick-kit";
import { brickRenderer, columnBadge } from "./brick-registry";
import { resolveBindValue, type BrickCtx } from "./brick-data";
import { paceStatus } from "./widget-status";
import { fmtKpi } from "./widget-format";
import { ChartViewRenderer } from "./chart-view";
import type { PacingMetricsBag } from "../types-metrics";
import type { PacingWidgetGroup, PacingWidgetInstance } from "../types";
import { isChartView, isKpiView, isLayoutView, type Brick, type KpiView, type LayoutCol, type LayoutView, type WidgetSpec } from "./widget-types";
import "./widget-engine.css";

export interface WidgetRenderContext {
  brickCtx: BrickCtx;
  /** Everything Pacing computed for this pacing — figures, per-day series and the
   *  resolved bindings. Null while it loads, and on a pacing with no delivery. */
  metrics: PacingMetricsBag | null;
}

function renderBrick(brick: Brick, ctx: BrickCtx, key: string) {
  const Comp = brickRenderer(brick.type);
  if (!Comp) {
    return <UnsupportedBrick key={key} label={brick.label} message={`Unsupported element type "${String(brick.type)}".`} />;
  }
  return <Comp key={key} brick={brick} ctx={ctx} />;
}

function renderColumn(col: LayoutCol, ctx: BrickCtx, key: string) {
  const badge = columnBadge(col.badge, ctx);
  const colCtx: BrickCtx = badge?.status ? { ...ctx, status: badge.status } : ctx;
  const span = Math.max(1, Math.min(12, Number(col.span) || 12));
  return (
    <div key={key} className="wgt-layout__col" style={{ gridColumn: `span ${span} / span ${span}` }}>
      <BrickColumn frame={col.frame} title={col.title} sub={col.sub} badge={badge?.node}>
        {(col.bricks || []).map((b, i) => renderBrick(b, colCtx, `${key}-b${i}`))}
      </BrickColumn>
    </div>
  );
}

function renderLayoutView(view: LayoutView, ctx: BrickCtx) {
  return (
    <div className="wgt-layout">
      {(view.rows || []).map((row, ri) => (
        <div key={ri} className="wgt-layout__row">
          {(row.cols || []).map((col, ci) => renderColumn(col, ctx, `${ri}-${ci}`))}
        </div>
      ))}
    </div>
  );
}

/** Which KPI keys carry a real, computable target on this side - see `campaign-metrics.ts`'s doc
 *  comment on what is and isn't ported; every other key (delivery/cpm/cpc/cpv/vcr) shows the value
 *  alone, with no target chip rather than a guessed one. */
const KPI_TARGET: Record<string, (scalars: Record<string, number>) => number | null> = {
  margin: (fl) => fl.mTgt,
  spend: (fl) => fl.costBudTotal,
  ctr: (fl) => fl.ctrT,
  budget: () => 100,
};

function renderKpiView(view: KpiView, ctx: BrickCtx) {
  const value = resolveBindValue({ metric: view.value.key }, ctx);
  const targetFn = view.target ? KPI_TARGET[view.target.key] : undefined;
  const target = targetFn ? targetFn(ctx.metrics?.scalars ?? {}) : null;
  const delta = value != null && target != null ? value - target : null;
  const invert = !!view.target?.invert;
  const status = delta == null ? undefined : invert ? (delta <= 0 ? "g" : "b") : paceStatus(delta);
  return (
    <BigStat
      value={fmtKpi(value, view.format)}
      caption={target != null ? `vs ${fmtKpi(target, view.format)}` : null}
      status={status}
    />
  );
}

function widgetTitle(widget: PacingWidgetInstance): string {
  return widget.title?.trim() || "Untitled widget";
}

export function WidgetTile({ widget, ctx }: { widget: PacingWidgetInstance; ctx: WidgetRenderContext }) {
  let body: JSX.Element;

  if (widget.kind !== "composite") {
    body = <UnsupportedBrick message={`Unsupported widget kind "${String(widget.kind)}".`} />;
  } else if (typeof widget.schemaVersion === "number" && widget.schemaVersion > 2) {
    body = <UnsupportedBrick message="This widget needs a newer version of the app." />;
  } else {
    const spec = widget.spec as WidgetSpec | undefined;
    if (!spec || !Array.isArray(spec.views) || spec.views.length === 0) {
      body = <UnsupportedBrick message="This widget has no content." />;
    } else {
      body = (
        <>
          {spec.views.map((view, i) => {
            const key = (view as { id?: string }).id || String(i);
            if (isLayoutView(view)) return <div key={key}>{renderLayoutView(view, ctx.brickCtx)}</div>;
            if (isChartView(view))
              return (
                <div key={key}>
                  <ChartViewRenderer view={view} rows={ctx.metrics?.series ?? []} scalars={ctx.metrics?.scalars ?? {}} />
                </div>
              );
            if (isKpiView(view)) return <div key={key}>{renderKpiView(view, ctx.brickCtx)}</div>;
            return <UnsupportedBrick key={key} message={`Unsupported view kind "${String(view.kind)}".`} />;
          })}
        </>
      );
    }
  }

  return (
    <div className={cn("wgt-tile", widget.profile === "section" && "wgt-tile--section")}>
      <div className="wgt-tile__title">
        <span>{widgetTitle(widget)}</span>
        <span className="wgt-tile__badge">widget</span>
      </div>
      <div className="wgt-tile__body">{body}</div>
    </div>
  );
}

interface RenderUnit {
  key: string;
  kind: "widget" | "group";
  widget?: PacingWidgetInstance;
  group?: PacingWidgetGroup;
  members?: PacingWidgetInstance[];
}

/** Clusters the flat `widgets[]` array into standalone tiles and grouped runs, in the order widgets
 *  already appear (this build has no drag-drop grid geometry to lay groups out over - see the
 *  migration report) - the SAME grouping the widget-library management panel below already shows, so
 *  the two never disagree about which tiles are grouped. */
function buildRenderUnits(widgets: PacingWidgetInstance[], groups: PacingWidgetGroup[]): RenderUnit[] {
  const groupByWidgetId = new Map<string, PacingWidgetGroup>();
  for (const group of groups) {
    if (group.bg === "none") continue;
    for (const id of group.tileIds) groupByWidgetId.set(id, group);
  }
  const emitted = new Set<string>();
  const units: RenderUnit[] = [];
  for (const widget of widgets) {
    const group = groupByWidgetId.get(widget.id);
    if (group) {
      if (emitted.has(group.id)) continue;
      emitted.add(group.id);
      units.push({ key: group.id, kind: "group", group, members: widgets.filter((w) => group.tileIds.includes(w.id)) });
    } else {
      units.push({ key: widget.id, kind: "widget", widget });
    }
  }
  return units;
}

export function WidgetBoard({
  widgets,
  groups,
  ctx,
}: {
  widgets: PacingWidgetInstance[];
  groups: PacingWidgetGroup[];
  ctx: WidgetRenderContext;
}) {
  const units = useMemo(() => buildRenderUnits(widgets, groups), [widgets, groups]);
  if (units.length === 0) return null;

  return (
    <div className="wgt-board">
      {units.map((unit) =>
        unit.kind === "group" && unit.group && unit.members ? (
          <div key={unit.key} className={cn("wgt-group", `wgt-group--${unit.group.bg}`)}>
            {!unit.group.hideTitle && unit.group.title && <div className="wgt-group__title">{unit.group.title}</div>}
            <div className="wgt-group__members">
              {unit.members.map((widget) => (
                <WidgetTile key={widget.id} widget={widget} ctx={ctx} />
              ))}
            </div>
          </div>
        ) : unit.widget ? (
          <WidgetTile key={unit.key} widget={unit.widget} ctx={ctx} />
        ) : null
      )}
    </div>
  );
}
