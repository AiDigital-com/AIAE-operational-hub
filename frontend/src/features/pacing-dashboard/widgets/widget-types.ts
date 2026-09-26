/**
 * The wire shape of a `kind: "composite"` widget's own `spec` - Pacing's widget-spec engine, read
 * only (never authored byte-for-byte here; the Hub only adds/removes/reorders whole widget instances,
 * see `pacing-dashboard-library.tsx`). Modeled off the retired SPA's `shared/report-v2` grammar and
 * `shared/std-entries.js` (the seed templates every new pacing gets), NOT reinvented - see
 * `PacingWidgetInstance` in `../types.ts` for the outer envelope this nests inside.
 *
 * Deliberately loose (`[key: string]: unknown` on every node, `type`/`kind` left as bare `string`):
 * a value out of `config_json` must never be trusted as one of the closed types below without an
 * explicit own-property check at the point it's dispatched on (see `brick-registry.tsx`'s
 * `brickRenderer` and `widget-engine.tsx`'s view/kind dispatch) - the SAME reason the SPA's own
 * `brick-registry.jsx` builds `BRICKS` with `__proto__: null`.
 */

/** A bound value: either a canonical metric key (`METRIC_READINGS`/campaign-scalar key) or a small
 *  arithmetic expression string evaluated by `widget-formula.ts`. Never both. */
export interface BindSpec {
  metric?: string;
  expr?: string;
  [key: string]: unknown;
}

export interface StatRowCell {
  label: string;
  bind?: BindSpec;
  format?: string;
  [key: string]: unknown;
}

/** One brick inside a layout column. `type` is read ONLY through `brickRenderer`'s own-property
 *  guard - see that function's doc comment for why. */
export interface Brick {
  type: string;
  label?: string;
  sub?: string;
  bind?: BindSpec;
  target?: BindSpec;
  tick?: BindSpec;
  tickLabel?: string;
  format?: string;
  source?: string;
  align?: "start" | "center" | "end";
  variant?: string;
  cells?: StatRowCell[];
  layout?: string;
  invert?: boolean;
  spread?: number;
  role?: string;
  emphasis?: string;
  series?: string;
  text?: string;
  [key: string]: unknown;
}

export interface LayoutCol {
  span: number;
  frame?: "none" | "card" | "signal" | string;
  title?: string | null;
  sub?: string;
  badge?: unknown;
  bricks: Brick[];
}

export interface LayoutRow {
  cols: LayoutCol[];
}

export interface LayoutView {
  id: string;
  kind: "layout";
  title?: string;
  rows: LayoutRow[];
  [key: string]: unknown;
}

/** A stored series' presentation, straight off the wire (§6 grammar - see `chart-paint.ts` for how
 *  `color`/`fill`/`border` tokens resolve, and `chart-view.tsx`'s DASH_PATTERNS/STROKE_WIDTH/CURVE_TYPE
 *  tables for how `style`/`dashed` resolve to recharts props). `dashed` is `false | "short" | "medium" |
 *  "long" | true` - both a series and a guide use the same closed set. */
export interface ChartSeriesStyle {
  type?: "area" | "bar" | "line" | string;
  width?: number | string;
  curve?: "straight" | "smooth" | "step" | string;
  /** Area only: `"light" | "strong"` picks the fallback fill opacity when the series carries no
   *  explicit numeric `opacity` of its own. */
  fill?: "light" | "strong" | string;
  /** Bar only: `"grouped" | "stacked"`. */
  bars?: string;
  points?: boolean;
  [key: string]: unknown;
}

export interface ChartValueSeries {
  id: string;
  kind: "value";
  label: string;
  value: { kind: string; metric: string; source?: string; unitFamily?: string };
  style?: ChartSeriesStyle;
  axis?: "left" | "right";
  /** Semantic paint token (`"actual"`, `"spend"`, ...), a palette index, or `"auto"` - see
   *  `chart-paint.ts`. */
  color?: string | number;
  /** Fill token for area/bar; falls back to `color` when absent (chart-paint.ts / ReportChart parity). */
  fill?: string | number;
  /** Bar stroke token; falls back to `color` when absent. */
  border?: string | number;
  dashed?: boolean | "short" | "medium" | "long";
  /** Stroke/fill opacity multiplier - the CSS paint itself already carries the intended translucency
   *  (e.g. `--c-actual-fill` is a low-alpha rgba), so this is almost always `1` in real specs. */
  opacity?: number;
  accumulate?: "daily" | "cumulative";
  guide?: {
    value?: { key: string };
    label?: string;
    invert?: boolean;
    calc?: "projection" | string;
    color?: string | number;
    dashed?: boolean | "short" | "medium" | "long";
    style?: ChartSeriesStyle;
    opacity?: number;
    labelPlacement?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ChartCalcSeries {
  id: string;
  kind: "calc";
  calc: "projection" | string;
  basis: string;
  output: "cumulative" | "perDay";
  label: string;
  style?: ChartSeriesStyle;
  axis?: "left" | "right";
  color?: string | number;
  dashed?: boolean | "short" | "medium" | "long";
  opacity?: number;
  [key: string]: unknown;
}

export type ChartSeriesDef = ChartValueSeries | ChartCalcSeries | { id: string; kind: string; [key: string]: unknown };

export interface ChartView {
  id: string;
  kind: "chart";
  title?: string;
  titleAuto?: boolean;
  series: ChartSeriesDef[];
  formats?: { left?: string; right?: string };
  /** Draws the journal's highlighted-entry date as a vertical marker on this view (§15 follow-up) -
   *  only meaningful on this chart's date axis (every view here plots one row per day; see
   *  `ChartViewRenderer`'s `journalHighlight` prop). Ported from the reference's `report-v2.js`
   *  grammar, which refuses this flag on anything but a date axis for the same reason. */
  journal?: boolean;
  [key: string]: unknown;
}

export interface KpiView {
  id: string;
  kind: "kpi";
  title?: string;
  value: { key: string };
  target?: { key: string; invert?: boolean };
  format?: string;
  [key: string]: unknown;
}

/** Any other view kind this build does not speak (table/pie/compare/…) - degrades to a placeholder,
 *  never a crash; see `widget-engine.tsx`'s dispatch. */
export interface UnknownView {
  id?: string;
  kind: string;
  [key: string]: unknown;
}

export type WidgetView = LayoutView | ChartView | KpiView | UnknownView;

export interface WidgetSpec {
  views: WidgetView[];
  dataset?: unknown;
  controls?: unknown[];
  [key: string]: unknown;
}

/** Own-key checked helpers - a wire value must never be trusted as a member of a closed union
 *  without going through one of these. */
export function isLayoutView(view: WidgetView): view is LayoutView {
  return view?.kind === "layout" && Array.isArray((view as LayoutView).rows);
}
export function isChartView(view: WidgetView): view is ChartView {
  return view?.kind === "chart" && Array.isArray((view as ChartView).series);
}
export function isKpiView(view: WidgetView): view is KpiView {
  return view?.kind === "kpi" && !!(view as KpiView).value;
}
