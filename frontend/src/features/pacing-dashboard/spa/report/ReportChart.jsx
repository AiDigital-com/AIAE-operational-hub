// workspace/src/pages/Dashboard/components/Widgets/Report/ReportChart.jsx
//
// The v2 report's CHART view (widget-builder v2 spec 2026-08-19 §5.1; P2 plan Task 5).
// It draws `buildReportChartModel`'s answer and decides nothing: every number, every
// axis side, every guide and every skip note arrives on `model`, and the only questions
// answered here are recharts questions — which element a stored style is, how thick a
// stroke is, which way the chart runs.
//
// PROPS ONLY — nothing here reads the store, the router or the clock. This component is
// rendered by the tile, by the layout preview and by the gallery miniature, and a zustand
// hook inside it would answer with the store's INITIAL state on every surface that has no
// provider and quietly draw an empty chart. It carries exactly TWO hooks, both about this
// chart's own history and neither about the world: the `useRef`/`useEffect` pair under
// «Entrance once» below, which remembers whether this chart has ever drawn a plot.
//
// `currency` is accepted and prints nothing today, for the reason fmtV2 states in
// report-render.js: every money value the engine produces is already USD, and labelling
// a USD scalar «CAD» would be a wrong number rather than a formatting choice. It stays in
// the signature so the five view renderers take one shape.
import { Fragment, cloneElement, useEffect, useRef } from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Bar, Line, LabelList,
  XAxis, YAxis, Tooltip, Legend, ReferenceLine, CartesianGrid, Cell, Customized,
} from 'recharts';
import { formatYTick, formatTooltipValue } from '../chart-format.js';
import { chartCannotDraw, CM_ROW_REASON } from '../report-render.js';
import { chartPaint } from '../chart-paint.js';
import { highlightFill, highlightTextStyle, highlightTitle } from '../ui/highlight-style.js';
import ChartHighlightPaths from './ChartHighlightPaths.jsx';

/** Auto uses DRAWN position; authored palette slots and semantic tokens resolve through
 * the same helper the Builder swatch uses. */
const colorOf = (s, i) => chartPaint(s.color, i);

/**
 * Table F, translated into recharts once (§5.1 — the stored style is the whole look, and
 * the X axis never changes it). Every stored value has an entry: a style object is fully
 * materialized by the grammar, so nothing is filled in at read time.
 */
const STROKE_WIDTH = { thin: 1.25, normal: 2, bold: 3 };
const CURVE_TYPE = { straight: 'linear', smooth: 'monotone', step: 'stepAfter' };
const AREA_FILL = { light: 0.10, strong: 0.32 };
const DASH_PATTERN = '6 3';
const DASH_PATTERNS = { short: '4 3', medium: '6 3', long: '10 4' };
const dashOf = (value) => (value === true ? DASH_PATTERN : DASH_PATTERNS[value]);
/** Bars round the end the value grows towards — the top of a vertical bar, the right of a
 *  horizontal one. Same shape, read the way the chart runs. */
const BAR_RADIUS = { vertical: [3, 3, 0, 0], horizontal: [0, 3, 3, 0] };

/**
 * The gutter an on-bar value needs when the chart runs HORIZONTALLY.
 *
 * `valuesOnChart` puts the number at `position="right"` — past the end of the bar — and a
 * horizontal chart's longest bar ends AT the value axis' maximum by construction. With the
 * plain 8px margin that label is drawn outside the plot and clipped by the panel, so the
 * one row whose number a reader most wants is the one row that cannot print it. A vertical
 * chart has no such problem: `position="top"` grows into the 4px top margin over a bar that
 * is scaled to leave headroom.
 *
 * 64px is the widest number this renderer can produce at `--text-10` — `formatTooltipValue`'s
 * money form, "$3,207.61" and its thousands-separated kin. Applied ONLY when the chart runs
 * horizontally AND some drawn series prints its values, so every other chart keeps the 8px.
 */
const H_LABEL_GUTTER = 64;

/**
 * How long a chart animates when its data CHANGES — milliseconds, and 0 means snap.
 *
 * recharts animates on EVERY data change, for 1.5 s a line or an area and 0.4 s a bar,
 * re-deriving each series' whole path geometry every frame of it. On the biggest pacing
 * one range click therefore costs ~520 k calls inside recharts and ~1.7 s of DOM churn
 * after the click — measured, 2026-09-02 trace §5.2 — for an animation the reader did not
 * ask for and is waiting out. What the animation is genuinely worth is the OPENING: a
 * dashboard whose charts draw themselves in reads as alive rather than as a screenshot.
 *
 * So the mount keeps recharts' own entrance animation untouched and only UPDATES are
 * shortened, by this one number. It is the whole knob: 250 ms is a movement the eye reads
 * as «this changed» without becoming a wait, and 0 turns updates into an instant redraw.
 */
export const UPDATE_ANIMATION_MS = 250;

/** The animation props an UPDATE carries, from that one number. A duration of 0 is not a
 *  0 ms animation to recharts — it still schedules the tween and renders the from-state —
 *  so 0 turns the animation OFF instead, which is the path `ReportPie` and the legacy
 *  Breakdown already take (`ReportPie.jsx:121`, `Breakdown.jsx:840`). */
export const updateAnimationProps = (ms) => (
  ms > 0 ? { isAnimationActive: true, animationDuration: ms } : { isAnimationActive: false }
);

const UPDATE_ANIM = updateAnimationProps(UPDATE_ANIMATION_MS);
/** The mount passes NOTHING and so keeps recharts' own defaults — 1.5 s for a line and an
 *  area, 0.4 s for a bar. The entrance is the behaviour this change is preserving; writing
 *  our own numbers over it here would be changing it. */
const ENTRANCE_ANIM = {};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(d) {
  if (!d) return '';
  const [, m, day] = String(d).split('-');
  return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(day, 10)}`;
}

/** The legend and tooltip name: §6's ⇄ marks the series that FOLLOW the metric switch, and
 *  it is visible to the viewer, not only to the author. */
const seriesName = (s) => (s.bound ? `${s.label} ⇄` : s.label);

/** What a GUIDE is called in the legend. It used to be written inside the plot, where a
 *  horizontal chart drew it across its own row labels and a filled bar left it in
 *  --chart-tick over the fill (P2 handoff §5.4). The legend is where every other line on
 *  this chart is named, and nothing overlaps anything there. */
const guideName = (owner) => (owner && owner.label ? `Guide · ${owner.label}` : 'Guide');

/** Read by own-key, for the reason the model states: a series id is a NodeId and
 *  `constructor` is a legal one, so a bare lookup would hang a note about the Object
 *  constructor under a line that drew perfectly well (ReportTable's colErrorOf, same rule). */
const seriesErrorOf = (model, id) => (
  Object.prototype.hasOwnProperty.call(model.errors, id) ? model.errors[id] : null
);

/** A fixed guide's tooltip row. The guide is one number with no data key, so recharts'
 *  payload never carries it: the chart hands the rows over, already named and formatted. */
const guideTooltipRow = (g) => (
  <div key={`guide:${g.ownerKey}`} className="recharts-tooltip-row" style={{ color: g.color }}>
    <span className="recharts-tooltip-name">{g.name}:</span>
    <span className="recharts-tooltip-value">{g.value}</span>
  </div>
);

/**
 * The series' value labels as a layer of their own, for a chart that also draws a fixed guide.
 *
 * recharts nests a series' labels inside the series, so a guide painted above the bars would be
 * painted above their numbers too, and a target sitting where the bars end struck the digits
 * through. Drawn here, after the guide, the numbers stay on top. `LabelList` is recharts' own
 * and is handed the same rectangles or points the series would have handed it, so every label
 * lands where it did. The nested labels wait for the series' animation; `entranceMs` is that
 * wait on the first draw, so the numbers do not hang over bars that have not grown yet.
 */
function ChartValueLabels({ formattedGraphicalItems, labelOf, entranceMs }) {
  return (
    <g
      className="rpt-value-labels" pointerEvents="none"
      style={entranceMs ? { animation: `rpt-value-labels-in 150ms ease-out ${entranceMs}ms both` } : undefined}
    >
      {(formattedGraphicalItems || []).map((entry) => {
        const key = entry.item?.props?.dataKey;
        const label = labelOf(key);
        // The halo is the plot's own surface: invisible on the background the numbers stand on,
        // and it parts the guide's dashes behind a number the line runs through.
        return label ? cloneElement(label, { key, data: entry.props?.data || entry.props?.points || [],
          stroke: 'var(--surface)', strokeWidth: 3, strokeLinejoin: 'round', paintOrder: 'stroke' }) : null;
      })}
    </g>
  );
}
/** recharts' own entrance: 0.4 s a bar, 1.5 s a line or an area (`ENTRANCE_ANIM` below). */
const ENTRANCE_MS = { bar: 400, line: 1500, area: 1500 };

function ReportTooltip({ active, payload, label, isDate, formatOf, baseColorOf, guideRows = [] }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="recharts-tooltip-custom">
      <div className="recharts-tooltip-label">{isDate ? fmtDate(label) : label}</div>
      {/* A fixed guide reads right under the series it is measured against, the place a
          calculated guide already takes by being drawn after its owner. */}
      {payload.map((entry) => (
        <Fragment key={entry.dataKey}>
          <div className="recharts-tooltip-row" style={{ color: baseColorOf(entry.dataKey) ?? entry.color, ...highlightTextStyle(entry.payload?.highlights?.[entry.dataKey]) }} title={highlightTitle(entry.payload?.highlights?.[entry.dataKey])}>
            <span className="recharts-tooltip-name">{entry.name}:</span>
            <span className="recharts-tooltip-value">
              {entry.value == null
                ? '—'
                : formatTooltipValue(formatOf(entry.dataKey), entry.value)}
            </span>
          </div>
          {guideRows.filter((g) => g.ownerKey === entry.dataKey).map(guideTooltipRow)}
        </Fragment>
      ))}
      {guideRows.filter((g) => !payload.some((entry) => entry.dataKey === g.ownerKey)).map(guideTooltipRow)}
      {[...new Set(payload.flatMap((entry) => entry.payload?.highlights?.[entry.dataKey]?.notes || []))].map((note, index) => <div key={index} className="text-10">{note}</div>)}
      {/* Why a line draws no CM360 bar (docs/2026-09-29-cm360-by-line.md): the table's sentence. */}
      {payload[0]?.payload?.[CM_ROW_REASON] && <div className="recharts-tooltip-note">{payload[0].payload[CM_ROW_REASON]}</div>}
    </div>
  );
}

export default function ReportChart({ view, model, heightPx = 220, currency = null, journalHighlight = null }) {
  // ── Entrance once, updates cheap ────────────────────────────────────────────────
  // The question is «has THIS chart ever drawn a plot», not «has this component ever
  // rendered»: a tile whose window is empty, whose model is refused, or whose CM360
  // numbers have not landed yet renders no chart at all, and its real entrance is the
  // render where the plot finally appears. Hooks first, above every early return, because
  // a hook that some renders skip is a hook React cannot keep in order.
  //
  // The flag is set from an EFFECT, so it turns only after a render that was committed —
  // a concurrent render that React starts and throws away (this dashboard does that ~70
  // times per open) must not spend the entrance on a tree nobody saw.
  //
  // `chartCannotDraw` is asked once, here, and read again by the body below: it is a call
  // rather than a model field because it is asked of the model being DRAWN — attachCmData
  // can refuse a series the build accepted.
  const hidden = !model || model.hidden;
  const cannotDraw = hidden ? null : chartCannotDraw(model);
  const plotted = !hidden && !cannotDraw && model.rows.length > 0;
  const drawn = useRef(false);
  useEffect(() => { if (plotted) drawn.current = true; }, [plotted]);
  const anim = drawn.current ? UPDATE_ANIM : ENTRANCE_ANIM;

  if (hidden) return null;
  const { rows, formats, mode } = model;
  const series = model.series.map((s, index) => {
    if (s.style?.type === 'bar' || !rows.some((row) => {
      const style = row.highlights?.[s.key]?.style;
      return style && (style.color || style.strokeWidth != null);
    })) return s;
    return { ...s, highlightStroke: {
      color: colorOf(s, index),
      width: typeof s.style?.width === 'number' ? s.style.width : STROKE_WIDTH[s.style?.width] || 2,
      curve: CURVE_TYPE[s.style?.curve] || 'monotone',
      dash: dashOf(s.dashed),
    } };
  });
  const dynamicGuides = model.guides.filter((guide) => guide.dynamic && rows.some((row) => Number.isFinite(row[guide.key])));
  const dynamicGuideOf = (owner) => dynamicGuides.find((guide) => guide.seriesId === owner.id);
  const horizontal = model.orientation === 'horizontal';
  const isDate = mode === 'date';
  const leftFormat = formats.left;
  const rightFormat = formats.right;
  const hasRight = series.some((s) => s.axisSide === 'right');
  const formatOf = (key) => {
    const found = series.find((s) => s.key === key) || dynamicGuides.find((guide) => guide.key === key);
    return found?.valueFormat || (found?.axisSide === 'right' ? rightFormat : leftFormat);
  };
  // Recharts takes tooltip colors from the original stroke, which is transparent
  // when highlight curves paint it. Keep that rendering detail out of the text color.
  const tooltipBaseColorOf = (key) => series.find((s) => s.key === key)?.highlightStroke?.color;

  // When NOTHING can be drawn, the reasons are the state in the middle of the tile rather
  // than a footnote under an empty plot (the model writes that sentence, and it carries
  // every series' own reason). `cannotDraw` is computed at the top of this function, with
  // the animation decision that needs the same answer.

  // One muted line for everything the chart could not draw: a Plan/Needed line with no
  // date axis to stand on (§5.1's own sentence, once however many series carry it), then
  // any series whose stored expression the engine refuses, named so the reader knows which
  // line is missing. Both are kept on the tile rather than swallowed — a series that
  // vanished silently is the config nobody can fix. The refusals are dropped here when the
  // state above is already carrying them: saying it twice is not saying it clearly.
  const notes = [];
  for (const s of model.skipped) if (!notes.includes(s.reason)) notes.push(s.reason);
  if (!cannotDraw) {
    for (const s of series) {
      const err = seriesErrorOf(model, s.id);
      if (err) notes.push(s.label ? `${s.label}: ${err}` : err);
    }
    // Coverage qualifies a chart that actually drew source-backed dimension rows. It is
    // not an empty-state explanation and therefore stays out when there is no plot.
    if (rows.length > 0 && model.note && !notes.includes(model.note)) notes.push(model.note);
  }

  const axisCommon = {
    tick: { fill: 'var(--chart-tick)', fontSize: 'var(--text-10)' },
    tickLine: false,
  };
  // The VALUE axis and the CATEGORY axis swap places when the chart runs horizontally —
  // `layout="vertical"` is recharts' name for it, and under that layout the numbers run
  // along X while the categories run down Y. The series bind to whichever of the two
  // carries the scale, which is why the axis id below rides `xAxisId` there and `yAxisId`
  // here; nothing else about a series changes.
  const valueAxis = (side, format) => (horizontal ? (
    <XAxis
      key={side} xAxisId={side} type="number"
      orientation={side === 'right' ? 'top' : 'bottom'}
      tickFormatter={(v) => formatYTick(format, v)}
      axisLine={false} {...axisCommon}
    />
  ) : (
    <YAxis
      key={side} yAxisId={side} orientation={side === 'right' ? 'right' : 'left'}
      tickFormatter={(v) => formatYTick(format, v)}
      axisLine={false} width={56} {...axisCommon}
    />
  ));
  const axisIdOf = (side) => (horizontal ? { xAxisId: side } : { yAxisId: side });
  const legendName = (value, entry) => {
    const owner = series.find((s) => s.key === (entry && entry.dataKey));
    // Two markers, one of them not a colour: `.rpt-sw` takes the switch-hover accent, and
    // `.rpt-sw-leg` underlines the same entry — a legend entry is already drawn in its
    // series' own hue, so a change of hue alone is a signal a reader cannot be sure they
    // saw (§10.3: colour is never the only distinction).
    return <span className={owner && owner.bound ? 'rpt-sw rpt-sw-leg' : undefined}>{value}</span>;
  };

  // A guide is a chart element with no data key, so recharts has nothing to build a legend
  // entry from: the payload is written here instead, series first and in drawn order, then
  // one dashed entry per guide that has a number. Both halves reproduce what recharts would
  // have built for the series — the icon a Bar/Line/Area carries, and its own colour — so
  // the legend looks exactly as it did with the guides added to it.
  const drawnGuides = model.guides.filter((g) => g.value != null);
  const legendGuides = drawnGuides.filter((g) => g.labelPlacement !== 'plotTopRight');
  const fixedGuideColor = (guide) => guide.color === undefined ? 'var(--c-expected)'
    : chartPaint(guide.color, series.findIndex((s) => s.id === guide.seriesId));
  const fixedGuideDash = (guide) => guide.dashed === undefined ? DASH_PATTERN : dashOf(guide.dashed);
  const fixedGuideWidth = (guide) => typeof guide.style?.width === 'number' ? guide.style.width
    : STROKE_WIDTH[guide.style?.width] || 1.5;
  const fixedGuideOwner = (guide) => series.find((s) => s.id === guide.seriesId);
  const fixedGuideValue = (guide) => formatTooltipValue(formatOf(fixedGuideOwner(guide)?.key), guide.value);
  const fixedGuideLabel = (guide) => {
    const value = [guide.labelPlacement === 'plotTopRight' ? guide.label : null,
      guide.valuesOnChart ? fixedGuideValue(guide) : null]
      .filter(Boolean).join(' · ');
    // The line is painted above the series now, and its label with it: the halo keeps the
    // words legible where they land on a bar instead of on the plot's own background.
    return value ? { value, position: 'insideTopRight', fill: 'var(--chart-tick)', fontSize: 'var(--text-10)',
      stroke: 'var(--surface)', strokeWidth: 3, strokeLinejoin: 'round', paintOrder: 'stroke' } : undefined;
  };
  // The tooltip names a fixed guide the way the legend does, wherever its label is placed.
  const tooltipGuideRows = drawnGuides.map((g) => ({
    ownerKey: fixedGuideOwner(g)?.key ?? g.seriesId,
    name: g.label || guideName(fixedGuideOwner(g)),
    value: fixedGuideValue(g),
    color: fixedGuideColor(g),
  }));
  const legendPayload = [
    ...series.flatMap((s, i) => {
      const guide = dynamicGuideOf(s);
      return [{
        id: s.key, dataKey: s.key, value: seriesName(s),
        type: s.style && s.style.type === 'bar' ? 'rect' : 'line', color: colorOf(s, i),
      }, ...(guide && guide.labelPlacement !== 'plotTopRight' ? [{
        id: guide.key, dataKey: guide.key, value: guide.label, type: 'line', color: colorOf(guide, i),
      }] : [])];
    }),
    ...legendGuides.map((g) => ({
      id: `guide:${g.seriesId}`,
      value: g.label || guideName(fixedGuideOwner(g)),
      type: 'plainline',
      color: fixedGuideColor(g),
      payload: { strokeDasharray: fixedGuideDash(g) },
    })),
  ];

  // Which key a series prints beside its marks, or null for none. A STACK is one bar to
  // whoever looks at it: the total rides the LAST segment, whose end is the end of the bar,
  // and the segments below print nothing — theirs are the numbers the tooltip lists.
  const stackKeys = model.stackTotal ? model.stackTotal.keys : null;
  const stackEnd = stackKeys ? stackKeys[stackKeys.length - 1] : null;
  const labelKeyOf = (s) => {
    if (stackKeys && stackKeys.indexOf(s.key) !== -1) {
      return s.key === stackEnd ? model.stackTotal.key : null;
    }
    return s.valuesOnChart ? s.key : null;
  };

  const valueLabelOf = (s) => {
    const labelKey = labelKeyOf(s);
    return labelKey ? (
      <LabelList
        dataKey={labelKey}
        position={horizontal ? 'right' : 'top'}
        formatter={(v) => formatTooltipValue(formatOf(s.key), v)}
        fill="var(--chart-tick)"
        fontSize="var(--text-10)"
      />
    ) : null;
  };
  // A fixed guide is painted above the series; the numbers are then lifted above the guide
  // (ChartValueLabels). A chart with no fixed guide keeps them nested, byte for byte.
  const liftLabels = drawnGuides.length > 0 && series.some((s) => labelKeyOf(s));
  const liftedLabelOf = (key) => {
    const owner = series.find((s) => s.key === key);
    return owner ? valueLabelOf(owner) : null;
  };
  const labelEntranceMs = anim === ENTRANCE_ANIM
    ? Math.max(...series.filter((s) => labelKeyOf(s)).map((s) => ENTRANCE_MS[s.style?.type] || ENTRANCE_MS.line), 0) : 0;

  const seriesElement = (s, i) => {
    const color = colorOf(s, i);
    const fill = chartPaint(s.fill == null ? s.color : s.fill, i);
    const border = chartPaint(s.border == null ? s.color : s.border, i);
    const style = s.style || { type: 'line', width: 'normal', curve: 'smooth', points: false };
    const common = { dataKey: s.key, name: seriesName(s), ...axisIdOf(s.axisSide) };
    const labels = liftLabels ? null : valueLabelOf(s);
    const guideLabel = s.dynamic && s.labelPlacement === 'plotTopRight' ? (
      <LabelList dataKey={s.key} content={({ index, viewBox }) => (
        index === rows.findLastIndex((row) => Number.isFinite(row[s.key])) && viewBox ? (
          <text x={viewBox.x} y={viewBox.y} dy={-8} textAnchor="end"
            fill="var(--chart-tick)" fontSize="var(--text-10)">{s.label}</text>
        ) : null
      )} />
    ) : null;

    if (style.type === 'bar') {
      return (
        <Bar
          key={s.key}
          {...common} fill={fill} fillOpacity={s.opacity ?? 0.75} stroke={border}
          strokeWidth={typeof style.width === 'number' ? style.width : (STROKE_WIDTH[style.width] || 1)}
          radius={BAR_RADIUS[horizontal ? 'horizontal' : 'vertical']}
          stackId={style.bars === 'stacked' ? 's' : undefined}
          {...anim}
        >
          {rows.some((row) => row.highlights?.[s.key]?.style?.color || row.highlights?.[s.key]?.style?.strokeWidth != null) && rows.map((row, rowIndex) => {
            const highlight = row.highlights?.[s.key];
            return <Cell key={rowIndex} fill={highlightFill(highlight) || fill}
              stroke={highlightFill(highlight) || border}
              strokeWidth={highlight?.style?.strokeWidth ?? (typeof style.width === 'number' ? style.width : STROKE_WIDTH[style.width] || 1)} />;
          })}
          {labels}
        </Bar>
      );
    }
    const stroke = {
      stroke: s.highlightStroke ? 'transparent' : color,
      strokeWidth: typeof style.width === 'number' ? style.width : (STROKE_WIDTH[style.width] || 2),
      strokeDasharray: dashOf(s.dashed),
      strokeOpacity: s.opacity ?? 1,
      type: CURVE_TYPE[style.curve] || 'monotone',
      dot: rows.some((row) => row.highlights?.[s.key]?.style?.points != null || row.highlights?.[s.key]?.style?.color)
        ? (props) => {
          const highlight = props.payload?.highlights?.[s.key];
          if (!(highlight?.style?.points ?? style.points) || !Number.isFinite(props.cx) || !Number.isFinite(props.cy)) return <g key={props.key} />;
          return <circle key={props.key} cx={props.cx} cy={props.cy} r={2.5} fill={highlightFill(highlight) || color} stroke={highlightFill(highlight) || color}><title>{highlightTitle(highlight)}</title></circle>;
        }
        : style.points ? { r: 2.5, fill: color, stroke: color } : false,
      activeDot: s.highlightStroke ? (props) => (
        <circle cx={props.cx} cy={props.cy} r={3}
          fill={highlightFill(props.payload?.highlights?.[s.key]) || color}
          stroke={highlightFill(props.payload?.highlights?.[s.key]) || color} />
      ) : { r: 3 },
      connectNulls: false,
    };
    if (style.type === 'area') {
      return (
        <Area key={s.key} {...common} {...stroke} fill={fill} fillOpacity={s.opacity ?? (AREA_FILL[style.fill] ?? AREA_FILL.light)} {...anim}>
          {labels}
        </Area>
      );
    }
    return <Line key={s.key} {...common} {...stroke} {...anim}>{labels}{guideLabel}</Line>;
  };

  return (
    <div className="rpt-view">
      {model.title ? (
        <div className="text-11 rpt-view-title" style={{ padding: '10px 12px 0', fontWeight: 600, color: 'var(--text-secondary)' }}>
          {model.title}
        </div>
      ) : null}
      {cannotDraw ? (
        // A chart with no drawable series is not a chart with no data: drawing the axes and
        // the empty plot for it spent a view's worth of height on a picture of nothing, with
        // the reason in small type underneath. This is the tile's own compact state — the
        // same `.rpt-state` box a missing dimension source gets — and it says which field.
        <div className="rpt-state">{cannotDraw}</div>
      ) : (
      <div className="chart-panel__body" style={{ height: heightPx }}>
        {rows.length === 0 ? (
          <div className="chart-panel__empty">{model.emptyNote || 'No data for selected filters'}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={rows}
              layout={horizontal ? 'vertical' : 'horizontal'}
              margin={{
                top: 4,
                right: horizontal && series.some((s) => s.valuesOnChart) ? H_LABEL_GUTTER : 8,
                left: 0,
                bottom: 0,
              }}
            >
              <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={horizontal} horizontal={!horizontal} />
              {horizontal ? (
                <YAxis
                  dataKey="x" type="category" width={110}
                  axisLine={{ stroke: 'var(--chart-grid)' }} interval={0} {...axisCommon}
                />
              ) : (
                <XAxis
                  dataKey="x"
                  tickFormatter={isDate ? fmtDate : undefined}
                  axisLine={{ stroke: 'var(--chart-grid)' }}
                  interval={isDate ? 'preserveStartEnd' : 0}
                  {...axisCommon}
                />
              )}
              {valueAxis('left', leftFormat)}
              {hasRight && valueAxis('right', rightFormat)}
              <Tooltip content={(
                <ReportTooltip
                  isDate={isDate} formatOf={formatOf} baseColorOf={tooltipBaseColorOf}
                  guideRows={tooltipGuideRows}
                />
              )} />
              {/* The legend NAME is untouched (the tooltip reads the same string); the
                  bound entries only gain the marker the tile's switch-hover highlight
                  accents — §6 asks that hovering the switch show exactly what will move,
                  and inside a chart that is one series among several. The payload is ours
                  because a guide has no data key of its own to be built from. */}
              <Legend
                wrapperStyle={{ fontSize: 'var(--text-11)', color: 'var(--chart-legend)' }}
                payload={legendPayload}
                formatter={legendName}
              />
              {/* The line names the value axis it is measured against: recharts' default axis
                  id is 0, the value axes here are `left`/`right`, and a missing id throws. */}
              {model.journal && journalHighlight && isDate && (horizontal ? (
                <ReferenceLine
                  y={journalHighlight} {...axisIdOf('left')}
                  stroke="var(--status-amber)" strokeDasharray="4 3" strokeWidth={1.5}
                  label={{ value: 'Journal', position: 'insideTopLeft', fill: 'var(--status-amber)', fontSize: 'var(--text-9)' }}
                />
              ) : (
                <ReferenceLine
                  x={journalHighlight} {...axisIdOf('left')}
                  stroke="var(--status-amber)" strokeDasharray="4 3" strokeWidth={1.5}
                  label={{ value: 'Journal', position: 'insideTopLeft', fill: 'var(--status-amber)', fontSize: 'var(--text-9)' }}
                />
              ))}
              {series.flatMap((s, index) => {
                const guide = dynamicGuideOf(s);
                return [seriesElement(s, index), ...(guide ? [seriesElement(guide, index)] : [])];
              })}
              {series.some((s) => s.highlightStroke) && <Customized component={<ChartHighlightPaths series={series} horizontal={horizontal} />} />}
              {/* A guide with no value is CM-fed and the adapter has not answered yet: the
                  model keeps the slot so the number has somewhere to land, and there is no
                  line to draw until it does. It is named in the legend unless the author
                  placed its label or value on the plot.
                  LAST among the chart's children: recharts paints in child order, so a guide
                  emitted before the series lay under every bar it was meant to be read
                  against (`isFront` is not read by this recharts version). */}
              {drawnGuides.map((g) => (horizontal ? (
                <ReferenceLine
                  key={g.seriesId} xAxisId={g.axisSide} x={g.value} ifOverflow="extendDomain"
                  stroke={fixedGuideColor(g)} strokeDasharray={fixedGuideDash(g)} strokeWidth={fixedGuideWidth(g)} strokeOpacity={g.opacity}
                  label={fixedGuideLabel(g)}
                />
              ) : (
                <ReferenceLine
                  key={g.seriesId} yAxisId={g.axisSide} y={g.value} ifOverflow="extendDomain"
                  stroke={fixedGuideColor(g)} strokeDasharray={fixedGuideDash(g)} strokeWidth={fixedGuideWidth(g)} strokeOpacity={g.opacity}
                  label={fixedGuideLabel(g)}
                />
              )))}
              {liftLabels && <Customized component={<ChartValueLabels labelOf={liftedLabelOf} entranceMs={labelEntranceMs} />} />}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      )}
      {notes.length > 0 && (
        <div className="text-10" style={{ padding: '0 12px 8px', color: 'var(--text-muted)' }}>
          {notes.map((n) => <div key={n}>{n}</div>)}
        </div>
      )}
    </div>
  );
}
