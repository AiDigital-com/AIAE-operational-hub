// workspace/src/lib/dashboard/report-render.js
//
// The v2 report's PURE value layer (widget-builder v2 spec 2026-08-19 §2/§6/§8; P2 plan
// Task 3). Five questions, answered once, for every view kind that follows:
//
//   what does this value MEAN right now  → resolveValue  (a bound value follows the switch)
//   what do we ask the ENGINE for        → valueToExpr
//   what does a chart SERIES evaluate    → seriesExpr (engine input, or a CM360 source)
//   what does the viewer READ            → autoLabel / fmtV2
//   against WHICH campaign               → scopedCampCtx / canonicalValue
//
// …and then, on those five, one MODEL per view kind — everything a renderer draws and
// nothing about how it looks (Task 5: buildReportChartModel; Task 6: buildReportTableModel).
//
// No React, no DOM, no store: everything arrives as an argument, so the same functions
// serve the tile, the layout preview, the gallery miniature and a host test. The renderers
// (T5-T9) hold no second opinion about any of it — a number that disagrees with its label,
// or a legend that disagrees with the axis, is what one more copy of this logic buys.
//
// It NEVER re-derives `unitFamily` (P2 global constraint): the client stamped it when the
// value was minted and the server checked it. What is stored is what is rendered.
import { CM_FIELDS, BASIS_FAMILY, FORMATS_BY_FAMILY, ROW_SORT_KEY, leafViews, anyCmHighlight } from './report-v2.js';
// The CM360 vocabulary (spec 2026-09-16 §2.1/§2.2) and the two sentences that used to live in
// this file. They moved to `widget-formula.js` because the SAVE GATE has to answer with the
// same characters the tile prints: a refusal the builder words differently from the renderer
// is two products telling one author two things about one expression.
// `FIELDS_PLAN` travels with them: it is the plan vocabulary a WINDOW reading carries, which
// is what every window slot on the models below stands on.
import { NO_CM_JOIN, PIE_NO_CM, SHARE_NO_WINDOW, FIELDS_PLAN, evaluateMaskedSeries, dateAxisRefusal } from './widget-formula.js';
// One absence rule and one field-set gate (§2.2, §2.4). `cmFieldRefusal` answers the engine's
// own sentence for a name the slot cannot carry, and it answers it in ONE place, so the
// runtime refusal and the editor's cannot drift into two spellings of one rule.
import { CM_IDS, cmEvalAt, cmFieldRefusal, cmMarkerOf, cmSeriesContext, cmValueAt, isCmBearing } from './cm-formula-context.js';
import { campM } from './metrics.js';
import { brickValue, coefModeOf, netModeOf } from './brick-data.js';
import {
  buildSeriesModel, buildCategoryModel, buildTabularModel, kpiValue, expressionsShowEmptyWithoutFacts,
  dimSourceCoverageNote, leftoverRank, sourceFilterReason, windowFactCount,
  tableRowKey, campaignWindowScalars, windowFnName, ABSENT_ROW_PLAN,
  expressionReadsConversions, primaryCvInView,
} from './widget-data.js';
import { dimAxisLabel, dimSourceNote } from './dim-sources-norm.js';
// The two halves of §5.3's KPI addition (section-widget parity, 2026-09-04): which line items
// a cell is a reading of, and which alert corridor judges its distance from its target. Both
// are the LEGACY Targets band's own — `kpi-basis.js` is the band's four gates, and
// `kpi-band.js` has been the one source of CTR/VCR colouring since before v2 existed.
import { kpiBasisLines } from './kpi-basis.js';
import { bandFromNotify, kpiBandStatus } from './kpi-band.js';
// The two words a PACING owns rather than the catalogue (section-widget parity, 2026-09-04):
// the coefficient-cost relabel the legacy sections apply to `dc` and `cpm`, and the
// completion label an audio campaign gives `vcr` (already imported below, for the VCR trend
// chart's own title). Both are the legacy surfaces' own helpers, imported rather than
// restated — a second table would let one header disagree with another.
import {
  anyCoef, anyNet, basisForKey, basisForReading, basisLabel, coefLabels, BASIS_NAMES,
} from './coef-rebuild.js';
// The 41 delivery field names — the catalog is their home since P3 Task 0 (it is a pure
// module, so this file may import it; FormulaField.jsx, a React module, could not be).
// DIM_LABELS travels with them: it is the Breakdown panel's own table of dimension names,
// and the row header of a v2 dim table has to print the same word the tab bar does.
import {
  AUX_DIMS, DIM_LABELS, DIM_NOTES, FIELD_LABELS, dimsWithValues, noDimValues,
} from './metric-catalog.js';
// The value and Highlight paths share the same source inventory gate; it imports no renderer
// or data engine, so the evaluator can read it without forming a cycle.
import { unavailableMetric } from './metric-availability.js';
// The unit a pacing is bought on (sections cutover 2026-09-07, spec §4) — the same FUNCTION
// the tile's own pre-step runs for its metric switch, asked over two DIFFERENT sets of line
// items. The pre-step (useAutoInventory) asks it over the DASHBOARD's set: the store's
// `liPlan` and `useEffLIs`, which is what the filter bar decides. The column gate below asks
// it over `sources.liPlan` / `sources.effLIs` — the same list re-derived by useWidgetData
// under this widget's own §0.8 scope, where a pinned channel, line-item list or dimension
// REPLACES the global filter on that axis. With nothing pinned the two sets are the same set
// and the two answers cannot disagree. They differ in one case: a Breakdown copy carrying its
// own entity scope on a mixed-rate campaign — scoped to the click-bought lines of a campaign
// paced on impressions, the table reads 'cl' here while the switch default reads 'im'. That
// is on purpose: a table's columns follow the lines the table is SHOWING, and the switch
// default follows the dashboard's set, which is the pacing-wide answer the legacy section
// gave its tab bar.
import { buyUnitOf } from './auto-controls.js';
// report-calc.js imports scopedCampCtx from HERE, so these two modules form a cycle. It is
// safe and stays that way for one reason: neither file calls into the other while its
// module body evaluates — both sides are hoisted function declarations, reached only from
// inside another function. Do not add a top-level call across this edge.
import { calcSeriesValues, projectionFactDates } from './report-calc.js';
// The CM360 half arrives through the §8.5 seams and nowhere else (P2 decision 4). The
// daily comparison is the KERNEL's own — the same call projectCm360Comparison makes — so a
// v2 view and the compare panel beside it cannot bucket the two sides differently; and the
// tuple label is compare-project's, so they cannot name a row differently either.
import { buildComparisonDaily } from './third-party-range.js';
import { tupleLabel } from './compare-project.js';
import { readingFor } from './widget-metric-readings.js';
import { fD, fI, f$, f$precise, fP } from './format.js';
import { formatConversion, isConversionValue } from './conversion-format.js';
import { upgradeConversionDefaults } from './standard-conversion-format.js';
import { completionLabel } from './completion-label.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** The empty-cell placeholder, and the ONLY em dash this path prints (copy rules). */
export const EM = '—';

/**
 * The human names a v2 auto label is written from (§2). The v2 value union reaches three
 * vocabularies, and this file owns two of them:
 *
 *   FIELD_LABELS     the 31 delivery formula fields — IMPORTED from the metric catalog
 *                    (P3 Task 0). It used to be a mirror of FormulaField.jsx's table, kept
 *                    honest by a deep-equal in the suite, because that table lived in a
 *                    React component module and this file is imported by pure host tests.
 *                    The catalog is that pure module, so the mirror is gone and the two
 *                    sides are one object.
 *   V2_CM_LABELS     the three CM360 fields (§4). Keyed by the SAME strings CM_FIELDS
 *                    holds, which is also how a dual-source bq value ('impressions' on a
 *                    CM360 widget, P1 Table B) finds its name.
 *   V2_CANON_LABELS  canonical metrics which have no title in the shared metric-reading
 *                    catalog. The test pins that every neutral WidgetMetrics key resolves.
 */
export const V2_CM_LABELS = {
  __proto__: null,
  impressions: 'Impressions', clicks: 'Clicks', completions: 'Completions',
};

export const V2_CANON_LABELS = {
  __proto__: null,
  neededSpendPerDay: 'Needed spend / day', neededPerDayImpr: 'Needed impressions / day',
  neededPerDayClicks: 'Needed clicks / day', neededPerDayViews: 'Needed views / day',
  neededPerDayInstalls: 'Needed installs / day',
  imprToDatePct: 'Impressions vs plan-to-date', imprActual: 'Actual impressions to date',
  imprExpected: 'Expected impressions to date', imprDeviation: 'Impressions deviation to date',
  forecastDspSpend: 'Forecast DSP spend', costBudTotal: 'Cost budget (full flight)',
  costRemaining: 'Cost remaining', clientPlanCpm: 'Client plan CPM',
  clientPlanCpc: 'Client plan CPC', clientPlanCpv: 'Client plan CPV',
  bidPlanCpm: 'Bid plan CPM', dynCpm: 'Dynamic CPM', paceDeltaImpr: 'Impressions pace delta',
  // The buy-unit seven (2026-10-05); same words as metric-catalog.js's CANON_ONLY_LABELS.
  unitToDatePct: 'Buy unit vs plan-to-date', unitActual: 'Actual buy units to date',
  unitExpected: 'Expected buy units to date', unitPlan: 'Planned buy units',
  unitDeviation: 'Buy unit deviation to date', neededPerDayUnit: 'Needed buy units / day',
  paceDeltaUnit: 'Buy unit pace delta',
};

/** The one metric switch a spec may carry (Table C caps it at one, which is WHY a bound
 *  value names no control). Returns null on a spec with none — a bound value then has
 *  nothing to follow, and every caller reads that as "draw nothing". */
function metricControl(spec) {
  const list = spec && Array.isArray(spec.controls) ? spec.controls : [];
  for (const c of list) if (c && c.type === 'metric') return c;
  return null;
}

function periodControl(spec) {
  const list = spec && Array.isArray(spec.controls) ? spec.controls : [];
  for (const c of list) if (c && c.type === 'period') return c;
  return null;
}

/**
 * The metric a calculated Guide plans against, read off the parent's RESOLVED value — the
 * option the viewer is on when the value follows a metric switch. Null for anything the
 * pacing engine has no plan for: a formula, a canonical scalar, a CM360 metric, or a metric
 * outside the four projection bases (completes and conversions included).
 */
export function guideBasisOf(resolved) {
  return resolved && resolved.kind === 'metric' && resolved.source !== 'cm'
    && hasOwn(BASIS_FAMILY, resolved.metric) ? resolved.metric : null;
}

/** The derived name of a calculated Guide (spec 2026-09-10 «The child»): Expected for Plan
 *  and for the viewer switch, Needed for a fixed Reforecast; «/ day» unless the parent
 *  accumulates. An authored `label` wins over this everywhere it is shown. */
export function calculatedGuideLabel(guide, accumulate) {
  const cumulative = accumulate === 'cumulative';
  const needed = !!guide && !guide.modeControlId && guide.mode === 'reforecast';
  if (needed) return cumulative ? 'Needed' : 'Needed / day';
  return cumulative ? 'Expected' : 'Expected / day';
}

function projectionMode(series, spec, controlState) {
  const id = series && typeof series.modeControlId === 'string' ? series.modeControlId : null;
  if (!id) return 'plan';
  const controls = spec && Array.isArray(spec.controls) ? spec.controls : [];
  if (!controls.some((control) => control && control.type === 'projection' && control.id === id)) return 'plan';
  const selected = controlState && controlState.projectionModes
    ? controlState.projectionModes[id] : null;
  return selected === 'reforecast' ? 'reforecast' : 'plan';
}

/** …and the one dimension switch (M4), on the same rule: Table C caps it at one, which is
 *  why a control-bound grain resolves to whatever this switch is on. */
function dimensionControl(spec) {
  const list = spec && Array.isArray(spec.controls) ? spec.controls : [];
  for (const c of list) if (c && c.type === 'dimension') return c;
  return null;
}

/**
 * dimensionPick(spec, controlState) → the dimension key every control-bound grain on this
 * widget is cut by right now, or null when the widget carries no dimension switch.
 *
 * ONE read of the switch for the whole tile, which is what makes the donut and the table
 * beside it two views of the same cut — the legacy Breakdown panel has one tab bar over
 * both, and this is that tab bar.
 *
 * A viewer pick naming a dimension the switch does not offer falls back to `defaultOption`,
 * exactly as `resolveValue` falls back to `defaultOptionId` and `effectivePeriod` to the
 * period control's default: stale viewer state may not blank a view.
 */
export function dimensionPick(spec, controlState) {
  const ctl = dimensionControl(spec);
  if (!ctl) return null;
  const options = Array.isArray(ctl.options) ? ctl.options : [];
  const wanted = controlState && typeof controlState.dimensionKey === 'string'
    ? controlState.dimensionKey : null;
  if (wanted && options.indexOf(wanted) !== -1) return wanted;
  return typeof ctl.defaultOption === 'string' ? ctl.defaultOption : (options[0] || null);
}

/**
 * resolveGrain(grain, spec, controlState) → the grain this view runs down right now.
 *
 * A stored `{type:'control', controlId}` becomes the `{type:'dim', key}` the viewer picked;
 * every other grain resolves to ITSELF, the same object (resolveValue's own rule, for the
 * same reason). A control grain on a widget whose switch is gone resolves to a dim with a
 * null key, which every model already reads as "no buckets" and draws its empty view for —
 * unreachable on a stored spec, because the grammar refuses the reference.
 *
 * The three dim slots spell their grain differently — a chart's `x`, a table's `rows`, a
 * pie's `sliceBy` — so a pie's is normalized to the same `{type, key}` shape on the way in
 * (`sliceGrain` below) and this function answers for all three.
 */
export function resolveGrain(grain, spec, controlState) {
  if (!grain || typeof grain !== 'object' || grain.type !== 'control') return grain;
  return { type: 'dim', key: dimensionPick(spec, controlState) };
}

/**
 * grainTypeOf(grain) → the TYPE a slot's grain is judged by with no viewer in the room:
 * `resolveGrain`'s answer with the control state left out, which is the BUILDER's question.
 *
 * A stored `{type:'control'}` is a DIMENSION grain to every rule that judges a pick. Each
 * option the switch offers is a dimension key, so whichever one the viewer lands on the
 * rows are dimension buckets — and the rules that care (`entriesFor`'s «Dimension buckets
 * carry no plan and no expected curve», the formula palette's shorter field set, a chart's
 * category axis) are true for all of them at once. Asking `view.rows.type` instead offers
 * the author a field the tile then refuses on the very grain it was offered for.
 *
 * An absent grain answers `date`, which is what each of those slots defaults to anyway.
 */
export function grainTypeOf(grain) {
  const g = resolveGrain(grain, null, null);
  return g && typeof g === 'object' && typeof g.type === 'string' ? g.type : 'date';
}

/** A pie's slice dimension as the other two slots spell theirs — `{key}` or `{controlId}`
 *  into `{type:'dim'|'control', …}`, so `resolveGrain` answers for the pie as well. */
function sliceGrain(view) {
  const s = (view && view.sliceBy) || null;
  if (s && hasOwn(s, 'controlId')) return { type: 'control', controlId: s.controlId };
  return { type: 'dim', key: (s && s.key) || null };
}

/**
 * resolveValue(value, spec, controlState) → the value this element SHOWS right now.
 *
 * `controlState` is the viewer's live control state, the shape T10's useReportControls
 * produces: `{ metricOptionId: string|null, breakdownIds: string[]|null,
 * periodValue: RangeValue|null }`. Only the first key matters here.
 *
 * A FIXED value (metric / formula / canonical) resolves to ITSELF — the same object, not a
 * copy: it shows its own metric in every switch position (§2, the binding rule), and a
 * copy would only invite a caller to mutate what the store still holds.
 *
 * A BOUND value resolves to the SELECTED option's value, with two extra keys stamped on:
 * `bound: true` (the ⇄ glyph the legend appends is the viewer's cue that this element
 * follows the switch) and `option` — the switch entry it came from, so `autoLabel` writes
 * the caption from the SAME read of the switch that produced the number. A selection
 * naming no option falls back to `defaultOptionId`, exactly as a stored period selection
 * outside its control's options falls back to the default: a stale viewer state may not
 * blank an element.
 *
 * A RESOLVED bound value is RENDER-ONLY and must never be written back: `bound` and
 * `option` are not value keys, and the grammar's onlyKeys would refuse the save (P3's
 * concern — P2 stores nothing, and the store still holds the `{kind:'bound'}` it read).
 */
export function resolveValue(value, spec, controlState) {
  if (!value || typeof value !== 'object') return null;
  if (value.kind === 'metric' || value.kind === 'formula' || value.kind === 'canonical') return value;
  if (value.kind !== 'bound') return null;

  const ctl = metricControl(spec);
  if (!ctl) return null;
  const options = Array.isArray(ctl.options) ? ctl.options : [];
  const wanted = controlState && typeof controlState.metricOptionId === 'string'
    ? controlState.metricOptionId : null;
  let picked = null;
  if (wanted) for (const o of options) if (o && o.id === wanted) { picked = o; break; }
  if (!picked) for (const o of options) if (o && o.id === ctl.defaultOptionId) { picked = o; break; }
  if (!picked || !picked.value || typeof picked.value !== 'object') return null;

  return {
    ...picked.value,
    bound: true,
    option: { id: picked.id, label: picked.label, labelAuto: picked.labelAuto },
  };
}


/**
 * valueToExpr(resolved, datasetType) → the expression engine's input, or null.
 *
 * P2 decision 3: v2 values are TRANSLATED onto the existing widget engine rather than
 * evaluated by a second one — which is how the 30-field set, the dim sources, the window
 * functions, the division-by-zero canon and the P0-corrected Others fold arrive for free.
 * A bare metric IS its field key; a formula is already an expression.
 *
 * null means "not engine-evaluable, the caller branches" — it is never an error:
 *   - `canonical` values read the scoped campaign context (canonicalValue below);
 *   - everything `cmFeedOf` claims is fed by the CM360 adapter (attachCmData, below).
 *
 * `datasetType` is REQUIRED, and a missing one throws rather than defaulting. It is the
 * only thing that tells a dual-source field apart from a plain one, so omitting it does
 * not produce a null the caller can branch on: it produces the WRONG expression, silently
 * handing the engine a CM360 field it has no column for. Every model builder here computes
 * it once as `(spec.dataset.type) || 'delivery'` — a string, always. `null` is allowed and
 * means "no CM360 comparison"; only `undefined` (the forgotten argument) is refused.
 */
export function valueToExpr(resolved, datasetType) {
  if (datasetType === undefined) {
    throw new TypeError('valueToExpr: datasetType is required (pass the widget spec\'s dataset type)');
  }
  if (!resolved || typeof resolved !== 'object') return null;
  if (resolved.kind === 'formula') {
    if (typeof resolved.expr !== 'string') return null;
    // A formula naming cmIm / cmCl / cmCo is ADAPTER-fed (§2.2), so the answer here is the
    // same null a cm metric gets: the engine has no column for a CM360 count on any grain,
    // and handing it one draws «Unknown field "cmIm"» under a header the author wrote about
    // CM360. Every caller already branches on this null — a series marks its slot, a column
    // pushes `{kind:'none'}`, a KPI waits — so the whole second pass hangs off this line.
    return isCmBearing(resolved.expr) ? null : resolved.expr;
  }
  if (resolved.kind !== 'metric') return null;
  if (cmFeedOf(resolved, datasetType)) return null;
  if (resolved.source !== 'bq') return null;
  if (typeof resolved.metric !== 'string' || !resolved.metric) return null;
  return resolved.metric;
}

/**
 * cmFeedOf(resolved, datasetType) → `{metric, side}` when this value is fed by the CM360
 * ADAPTER rather than by the widget engine, else null. `side` is which half of the
 * comparison the number comes from: `'cm'` the CM360 file, `'bq'` the delivery half of the
 * same comparison.
 *
 * Two forms reach it, and they are one rule read from both ends (§4 + P1 Table B):
 *   · `source:'cm'` — read from the CM360 aux file, which no engine field exists for. The
 *     dataset is not consulted: a cm value IS a cm value, and since widget value sources
 *     phase 1 (spec 2026-08-25 §3) it is legal on a `delivery` widget too, where it is served
 *     by the same `attachCmData` join as on a CM360 one.
 *   · the DUAL-SOURCE canonical form — a `source:'bq'` COUNT of one of CM_FIELDS
 *     ('impressions', 'clicks', 'completions') on a `deliveryCm360` widget. That is the
 *     delivery-side half of a comparison, and it comes from the adapter's own deliveryDaily
 *     so that the two lines describe the same population (§8.3: a breakdown narrows the
 *     comparison to overlap tuples, and the engine knows nothing about that). The engine's
 *     own fields are `im`/`cl`/`co`, so handing it "impressions" would draw «Unknown field».
 *
 * THIS IS WHERE THE TWO DATASETS PART, and the `deliveryCm360` conjunct on the second form is
 * the whole of it (spec §3's one deliberate divergence). On a CM360 widget BOTH halves of a
 * dual-source pair are adapter-fed, so the pair describes one joined population. On a delivery
 * widget only the cm half is: the bq twin beside it stays engine-fed, because an ordinary
 * widget's bq numbers must not change because a cm series joined the tile. That is also why a
 * delivery widget's bq+cm pair can disagree with the Compare view's pair, and the picker copy
 * («CM360 · via mapping») owns it.
 *
 * The four conjuncts are `shared/report-v2.js`'s `isDualSource`, plus the dataset — which
 * is this side's own question and the reason the predicate is not imported. `unitFamily ===
 * 'count'` is load-bearing: a value that says `impressions` in the MONEY family is not the
 * twin of anything, and it goes to the engine, which owns the field universe and answers
 * for a key it does not have.
 */
export function cmFeedOf(resolved, datasetType) {
  if (!resolved || typeof resolved !== 'object') return null;
  // The second shape a CM-fed value can have (§2.2): a FORMULA that names the CM360 side.
  // `cmMarkerOf` is memoised behind a regex pre-gate, which is what makes this affordable —
  // it runs per column, per series, per share and per guide on every builder keystroke. The
  // marker's own shape is `{kind:'formula', …}`, so every reader that dereferences
  // `.cm.metric` today dispatches on `cm.kind` instead; absent `kind` is the metric shape.
  // The dataset is not consulted, for the same reason a `source:'cm'` metric does not consult
  // it: a CM360 identifier IS a CM360 read, on a delivery widget as much as on a CM360 one.
  if (resolved.kind === 'formula') return cmMarkerOf(resolved.expr);
  if (resolved.kind !== 'metric') return null;
  if (typeof resolved.metric !== 'string' || !resolved.metric) return null;
  if (resolved.source === 'cm') return { metric: resolved.metric, side: 'cm' };
  if (resolved.source !== 'bq' || datasetType !== 'deliveryCm360') return null;
  if (CM_FIELDS.indexOf(resolved.metric) === -1 || resolved.unitFamily !== 'count') return null;
  return { metric: resolved.metric, side: 'bq' };
}

/** metric → the CM360 identifier that names it: the one reverse of `CM_IDS`, built from it
 *  rather than retyped, so the two lists cannot drift apart. */
const CM_ID_FOR_METRIC = new Map(Object.keys(CM_IDS).map((id) => [CM_IDS[id], id]));

/**
 * The SOURCE text a CM360 series is evaluated from — `seriesExpr`'s cm arm, and the one
 * author of the synthesised identifier (CM360-in-formulas §2.9).
 *
 * Two values reach it, both of which `valueToExpr` answers null for:
 *   · a cm-bearing FORMULA — its own text, on any dataset; a cm identifier is a namespace,
 *     not a dataset.
 *   · a CM360 METRIC, and only under the Cumulative switch — a metric carries no text to
 *     wrap, so the switch used to be dropped and the line drew the daily column under a
 *     cumulative label. The identifier is synthesised so the marker carries what the label
 *     promises. On `daily` this answers null and the series keeps its METRIC marker, its
 *     per-row path and its numbers to the bit: the change is visible on exactly the series
 *     whose label was wrong.
 *
 * The dual-source BQ half (`cmFeedOf`'s `side: 'bq'` — a count on a `deliveryCm360` widget)
 * is deliberately NOT synthesised. The text that names it is `im`, which is not cm-bearing:
 * `cmMarkerOf` would answer null, the series would fall through to the engine arm, and the
 * engine answers the unnarrowed campaign rather than the population §8.3 narrowed the
 * comparison to. It keeps the marker and the behaviour it has today.
 */
function cmSeriesSource(resolved, accumulate, datasetType) {
  if (!resolved || typeof resolved !== 'object') return null;
  if (resolved.kind === 'formula') {
    return typeof resolved.expr === 'string' && isCmBearing(resolved.expr) ? resolved.expr : null;
  }
  if (accumulate !== 'cumulative') return null;
  const feed = cmFeedOf(resolved, datasetType);
  return feed && feed.side === 'cm' ? (CM_ID_FOR_METRIC.get(feed.metric) || null) : null;
}

/**
 * seriesExpr(resolved, accumulate, datasetType) → the TEXT a chart series is evaluated from.
 *
 * `accumulate: 'cumulative'` wraps it in `cumsum(...)` — the engine's own in-window running
 * total (widget-formula.js), which is what the built-in cumulative charts already draw, so
 * a v2 series and the built-in beside it can never diverge. `daily` is the bare expr.
 *
 * THE RETURN IS NO LONGER ALWAYS ENGINE INPUT (CM360-in-formulas §2.9). A CM360 source comes
 * back too, wrapped the same way — and `buildReportChartModel` mints the CM360 marker off
 * this text rather than off the stored value, so the switch is part of what is evaluated and
 * of what is validated. `valueToExpr` still answers null for every cm value, which is what
 * keeps the delivery engine from ever being handed a `cmIm`; the two functions ask different
 * questions now, and a caller that means «what do we ask the engine for» must ask that one.
 * report-highlights.js's chart branch drops the cm arm for exactly that reason.
 *
 * Before this, the wrap was minted and thrown away with the null, so a cm series switched to
 * Cumulative drew daily numbers under a label that said cumulative — for a formula, which had
 * text nobody kept, and for a METRIC, which had no text at all. `cmSeriesSource` above answers
 * for both, and says which cm values it deliberately leaves alone.
 *
 * `datasetType` is REQUIRED and rides through to valueToExpr so the dual-source rule holds
 * on this path too: a value the engine cannot evaluate returns null here, never the string
 * `cumsum(null)`. It answers for itself rather than letting valueToExpr's refusal surface
 * under the wrong name — a chart series is what this caller was building.
 */
export function seriesExpr(resolved, accumulate, datasetType) {
  if (datasetType === undefined) {
    throw new TypeError('seriesExpr: datasetType is required (pass the widget spec\'s dataset type)');
  }
  const engine = valueToExpr(resolved, datasetType);
  const src = engine != null ? engine : cmSeriesSource(resolved, accumulate, datasetType);
  if (src == null) return null;
  return accumulate === 'cumulative' ? `cumsum(${src})` : src;
}

/**
 * What `auto` RESOLVES to for a value of one unit family — the family's own first named
 * format, which is `FORMATS_BY_FAMILY`'s own order and the same answer the client's catalog
 * mints as a metric's `defaultFormat`. One derivation, no second table.
 *
 * A value with no family (an unresolvable bound one) keeps `auto`, and `fmtV2` prints the
 * neutral number it always did — there is nothing to consult.
 */
const autoFormat = (family) => (FORMATS_BY_FAMILY[family] || [])[1] || 'auto';

/**
 * pacingWording(sources, campCtx) → `{coef, net, hasAudio}`, or null when there is nothing
 * to ask.
 *
 * The three facts about a PACING that change what a delivery metric is called (section-widget
 * parity, 2026-09-04; net cost mode 2026-09-07). All are the legacy sections' own reads:
 * `anyCoef` is what relabels «Dynamic Cost» to «Client Cost» and «CPM» to «DSP CPM» on a
 * coefficient-cost pacing (coef-rebuild.js, spec §8), `anyNet` is what makes a client money
 * caption say which basis its big figure is on (spec 2026-09-07 §7), and `hasAudio` is what
 * makes the completion column read «VCR/ACR» where a campaign carries audio
 * (completion-label.js).
 *
 * `hasAudio` is read off `campCtx` — campM over THIS widget's line set, the same set the
 * numbers under the header are counted over, and the same reading the legacy section's own
 * `pt.hasAudio` is.
 *
 * `net` is judged on the RAW plan (fix round 1): the virtual plans period scope and dim
 * scope hand over enumerate their fields explicitly and DROP `k`, so reading the scoped map
 * would strip the suffix off a scoped widget that still draws the gross/net pair. Same rule,
 * and the same reason, as `grossAgg` (widget-data.js) — which is what draws that pair.
 */
export function pacingWording(sources, campCtx) {
  if (!sources && !campCtx) return null;
  return {
    coef: anyCoef(sources && sources.liPlan),
    net: anyNet(sources && (sources.rawLiPlan || sources.liPlan)),
    hasAudio: !!(campCtx && campCtx.hasAudio),
  };
}

/**
 * The pacing's own word for a delivery metric, or null where it has none (§2's auto caption,
 * section-widget parity 2026-09-04).
 *
 * Three metrics are named differently on different pacings, and on all three the catalogue's
 * static name is WRONG somewhere: `dc` is called «Client cost» there, which is the coefficient
 * wording, so on the majority of pacings that calls a dynamic estimate the client's real cost;
 * `cpm` is the DSP's own CPM once a coefficient sits between the two; and a completion rate on
 * an audio line is a listen-through and not a view-through.
 *
 * It answers for the TILE, and for the WHOLE tile since fix round 1: the header, the legend
 * and the metric switch's own chips (ReportWidget's `switchChips`), because a chip and the
 * column it moves are one number and may not be called two things.
 *
 * The Builder keeps the catalogue's neutral name: a stored definition travels (a library push
 * puts the same widget on another pacing), the editor's own vocabulary IS the catalogue's —
 * the Spotlight the author picked `dc` from calls it «Client cost» — and the editor holds no
 * scoped read of the pacing to name it with. That leaves an author on a non-coefficient pacing
 * reading «Client cost» on a card whose preview says «Dynamic Cost»; it is a wording decision
 * on the owner's screen and it is open (fix round 1, finding 2).
 */
function pacingMetricLabel(metric, wording) {
  if (!wording) return null;
  if (metric === 'dc') return coefLabels(wording.coef, wording.net).dcCol;
  // No net basis on this one: `cpmCol` is the DSP's own buying rate, and `coefLabels`
  // returns it unsuffixed either way.
  if (metric === 'cpm') return coefLabels(wording.coef).cpmCol;
  if (metric === 'vcr') return completionLabel(wording.hasAudio);
  // Everything else that HAS a basis takes it from the ONE rule the bricks read (spec
  // 2026-09-07 §7): client money prints net with no gross twin beside it, and margin is
  // computed from net. Before this was generic, only `mA` and `mTgt` were named here, so a
  // report scalar bound to `budget` sat bare beside a tile that said «(net)».
  //
  // This is the DELIVERY-FIELD half of the rule, which is the vocabulary `metric` is in
  // here: `v.kind === 'metric'` and a bare-field formula. The canonical readings are asked
  // separately, in `valueLabel` below. `BASIS_NAMES` covers the one key the catalogue has
  // no entry for; the rest read the catalogue and fall back to the key exactly as
  // `valueLabel` did for them before, so a plain pacing's caption is unchanged either way.
  const kind = basisForKey(metric);
  if (kind) {
    return basisLabel(BASIS_NAMES.get(metric) || FIELD_LABELS[metric] || metric, kind, wording.net);
  }
  return null;
}

/** The name ONE value goes by, with no switch in the picture. */
function valueLabel(v, wording) {
  if (!v || typeof v !== 'object') return '';
  if (v.kind === 'metric') {
    const k = typeof v.metric === 'string' ? v.metric : '';
    // A cm-side value keeps the CM360 export's own word: the pacing's coefficient model is a
    // fact about delivery, and an ad server's completions are not a listen-through either.
    if (v.source !== 'cm') {
      const said = pacingMetricLabel(k, wording);
      if (said) return said;
    }
    return FIELD_LABELS[k] || V2_CM_LABELS[k] || k;
  }
  if (v.kind === 'formula') {
    // A bare field typed as a formula reads as that field. Arithmetic reads as itself:
    // nobody can name an expression but its author, which is exactly what a manual label
    // is for.
    const e = typeof v.expr === 'string' ? v.expr.trim() : '';
    const said = pacingMetricLabel(e, wording);
    if (said) return said;
    return FIELD_LABELS[e] || V2_CM_LABELS[e] || e;
  }
  if (v.kind === 'canonical') {
    // The READING half of the basis rule (fix round 1, finding 3). The name is this
    // file's own table first, the shared reading catalogue's title second — but the basis
    // is asked of the KEY either way, so a canonical «Client plan CPM» (named here) and a
    // brick bound to the same reading cannot say two different things. Keyed, not
    // title-matched: a reworded title must not silently drop the basis.
    const k = typeof v.key === 'string' ? v.key : '';
    const title = V2_CANON_LABELS[k] || readingFor(k)?.title;
    if (!title) return k;
    const kind = basisForReading(k);
    return kind ? basisLabel(title, kind, wording && wording.net) : title;
  }
  return '';
}

/**
 * autoLabel(resolved, controlState, wording) → the caption an AUTO label prints (§2).
 *
 * Manual labels are the caller's business: `labelAuto: false` means the user typed it and
 * it sticks, so a renderer keeps the stored label and never calls this.
 *
 * For a BOUND element the caption comes from the current switch selection — read off the
 * `option` resolveValue already stamped on, so the label and the number can never come
 * from two different reads of the switch. An option carrying its OWN auto label (the
 * grammar allows it: `labelAuto: true` stores an empty label) derives from the option's
 * value, one level down.
 *
 * `controlState` is part of the contract every caller passes and is deliberately NOT read
 * here: resolveValue is where a selection turns into a value, and reading the state a
 * second time is how a caption starts disagreeing with the number beside it. A RAW,
 * unresolved `{kind:'bound'}` therefore has no name — the caller resolves first.
 *
 * `wording` is `pacingWording`'s answer, and it is OPTIONAL: a caller that has no pacing to
 * read (every Builder surface) gets the metric's own catalogue name, which is what an editor
 * should show. A TILE passes it, so its header says what this pacing calls the metric.
 */
export function autoLabel(resolved, controlState, wording = null) {
  if (!resolved || typeof resolved !== 'object') return '';
  if (resolved.option) {
    if (resolved.option.labelAuto) return valueLabel(resolved, wording);
    return resolved.option.label || valueLabel(resolved, wording);
  }
  return valueLabel(resolved, wording);
}

/**
 * nameColumns(list) → the captions ONE view's columns really print.
 *
 * §2 derives an auto caption from the value alone, and a value knows nothing about the
 * column beside it. On a CM360 report «Both sources» plus a Δ% is three columns of the same
 * field — `Impressions`, `Impressions`, `Impressions` — and a header that repeats itself
 * three times is a table nobody can read. Only the VIEW can see that, so the disambiguation
 * is here rather than in `autoLabel`.
 *
 * It fires only on a COLLISION, and only over AUTO captions: a caption the author typed is
 * theirs, and a field that appears once reads better as its own name than as its name plus
 * a pill nothing is being told apart from.
 *
 *   list  `[{label, labelAuto, kind, source, cm}]` in view order — `kind` is the stored column
 *         kind (`delta` prints the subtraction rather than a side), `source` is `cm` or
 *         anything else, and `cm` says this column is fed by a FORMULA that names the CM360
 *         side (§2.10). The second tell exists because a formula carries no `source` key at
 *         all: the source is in the identifier. It is NOT «this column has a cm marker» — the
 *         dual-source bq half carries one too and is the delivery number, which is the very
 *         pair these captions tell apart.
 */
export function nameColumns(list) {
  const rows = Array.isArray(list) ? list : [];
  const seen = new Map();
  for (const c of rows) if (c && c.labelAuto && c.label) seen.set(c.label, (seen.get(c.label) || 0) + 1);
  return rows.map((c) => {
    if (!c || !c.labelAuto || !c.label || (seen.get(c.label) || 0) < 2) return c ? c.label : '';
    if (c.kind === 'delta') return `${DELTA_MARK} ${c.label}`;
    return `${c.label} · ${c.source === 'cm' || c.cm ? 'CM' : 'BQ'}`;
  });
}
/** The mark a Δ% column wears when its field is on the table twice over. The same two
 *  characters the builder's own column row and the spec use for it. */
const DELTA_MARK = 'Δ%';

/**
 * fmtV2(value, format, currency) → the string a v2 cell, KPI or slice prints.
 *
 * This is the one canonical format vocabulary: `percent2` forces two decimals AND groups
 * thousands, and `auto` prints a whole number as an integer. Every View prints the same
 * metric the same way.
 *
 * `pp` is fmtCell's own, not format.js's `fPP`: fPP forces one decimal (2 → "+2.0 pp")
 * where the table drops it (2 → "+2 pp"). The table is what a v2 view must match, and the
 * divergence is pinned in the test rather than left to be rediscovered.
 *
 * `currency` is accepted and prints nothing today, on purpose: every money value the
 * engine produces is ALREADY USD (normalize.js converts client cost at the earliest
 * aggregation), and the dual-currency display needs a `{native, usd}` pair
 * (dual-money.js) that a single scalar cannot carry. Labelling a USD scalar "CAD" would
 * be a wrong number, not a formatting choice — so the argument stays in the signature for
 * the day a value carries its native half, and changes nothing until then.
 */
export function fmtV2(value, format, currency) {
  if (value == null) return EM;
  switch (format) {
    case 'count1': return formatConversion(value);
    case 'int': return fI(value);
    case 'money': return f$(value);
    case 'money4': return f$precise(value);
    case 'percent': return fP(value);
    case 'percent2': return `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    case 'pp': return `${value >= 0 ? '+' : ''}${Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 })} pp`;
    case 'number2':
    case 'plain2': return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
    case 'auto':
    default:
      return Math.abs(value - Math.round(value)) < 1e-9
        ? fI(value)
        : Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
}

/**
 * The plan counts print whole (2026-09-23). A narrowed window's plan is a share of the plan
 * curve — `298,214.29` impressions on a 7-day window — where the flight plan it replaced was
 * always a whole NetSuite number, so a format that prints «up to two decimals» (`auto`, and
 * `plain2` / `number2`) started printing cents of an impression. A value that is a bare
 * count-family plan field prints as `int` in those three; every other value, and a format the
 * author picked for a reason (`count1`, a money or percent format), is untouched.
 */
const COUNT_PLAN_FIELDS = new Set(['planImpr', 'planClicks', 'planViews', 'planImprTotal', 'planClicksTotal', 'planViewsTotal']);
const DECIMAL_FORMATS = new Set(['auto', 'plain2', 'number2']);
export function wholePlanFormat(format, resolved, datasetType) {
  if (!DECIMAL_FORMATS.has(format || 'auto')) return format;
  const expr = resolved ? valueToExpr(resolved, datasetType ?? null) : null;
  return typeof expr === 'string' && COUNT_PLAN_FIELDS.has(expr.replace(/\s+/g, '')) ? 'int' : format;
}

/** Table cells and their formula previews share the authored zero display rule. */
export function fmtReportTableCell(value, column) {
  return fmtV2(column.zeroAs === 'blank' && value === 0 ? null : value, column.format);
}

/**
 * effectivePeriod(widget, spec, widgetRanges) → `{rangeOverride, fromControl}`.
 *
 * P2 decision 6, the whole ladder in one place:
 *   a Period control?  the viewer's stored selection (`display.widgetRanges[widget.id]`)
 *                      IF the control still offers it, else the control's defaultOption
 *   no control?        `spec.period`
 *   neither?           null — the widget follows the global filter
 *
 * A stored selection outside the control's options is IGNORED, not repaired: the options
 * are the widget's, the selection is the viewer's, and an author who drops '30d' from the
 * switch has said the widget no longer offers it. `spec.period` is not consulted when a
 * control exists — the control always carries a default, and two answers to one question
 * keeps the Period control as the single authority.
 *
 * `fromControl` says the chip row is LIVE (a Period control exists), which is what the tile
 * renders the chips from and what tells a save it may persist a selection at all — the
 * server refuses a `widgetRanges` entry for an INLINE v2 widget without a Period control
 * (widgets-validate.mjs widgetRangeOffenders; a LINKED instance carries no spec to judge and
 * is skipped there, so this side is the only place its chip row is decided).
 *
 * `rangeOverride` is handed straight to `useWidgetData(widget, rangeOverride)` (T0): the
 * v2 tile never re-reads the store for its window, which is also §6's preview plumbing.
 * `scope.time: 'absolute'` is NOT this function's business — resolveTimeScope inside
 * useWidgetData opts a widget out of period scope wholesale, downstream of the window.
 */
export function effectivePeriod(widget, spec, widgetRanges) {
  const ctl = periodControl(spec);
  if (ctl) {
    const options = Array.isArray(ctl.options) ? ctl.options : [];
    const id = widget && typeof widget.id === 'string' ? widget.id : null;
    const stored = id && widgetRanges && hasOwn(widgetRanges, id) ? widgetRanges[id] : null;
    if (typeof stored === 'string' && options.indexOf(stored) !== -1) {
      return { choice: stored, rangeOverride: stored === 'auto' ? null : stored, fromControl: true };
    }
    const choice = typeof ctl.defaultOption === 'string' ? ctl.defaultOption : null;
    return {
      choice,
      rangeOverride: choice === 'auto' ? null : choice,
      fromControl: true,
    };
  }
  const period = spec && typeof spec.period === 'string' ? spec.period : null;
  return { choice: null, rangeOverride: period, fromControl: false };
}

/* ── the scoped campaign context ──────────────────────────────────────────── */

// One context per `sources` object per day. `sources` is rebuilt by useWidgetData's memo
// only when something it reads actually changed, so a WeakMap on it is exactly the memo
// key the rest of this path already uses (metrics.js's own caches are keyed the same way,
// on liDaily/liPlan). The inner Map is keyed by asOf because the same widget context is
// read for the current day and, in the calc path, for none.
const campCtxCache = new WeakMap();

/**
 * scopedCampCtx(sources, asOf) → the campaign metrics of THIS WIDGET's lines.
 *
 * P2 decision 5: a v2 widget honours its own scope (spec §9), so the canonical values and
 * the two calc series are computed over `sources.effLIs` — the widget's own effective LI
 * set, after its scope overrides and any dim/period scoping — and NOT over the dashboard's
 * globally filtered `useFullFlightMetrics`. On an Audio-only tile of a mixed campaign the
 * difference is the whole point: the plan it paces against is Audio's, not the campaign's.
 *
 * The plans are `sources.liPlan` — the planMap useWidgetData built, in which dim-split and
 * period-scope VIRTUAL plans are already resolved. Passing the raw store plans instead
 * would make this one number disagree with every other number on the same tile.
 *
 * `range` is null (and so are the two splitScoped arguments, which the planMap has already
 * applied): this is the FULL-FLIGHT context. Every consumer needs it that way — the
 * reforecast horizon (`scopeEnd`), the pace-to-goal total (`allPlanImpr` minus
 * `allPlanImprPausedRem`), the daily rate (`allPlanImprDailyRate`) and the canonical
 * metrics' full-flight half are all flight constants that must not move when the viewer
 * narrows the window.
 */
export function scopedCampCtx(sources, asOf) {
  if (!sources || typeof sources !== 'object') return null;
  if (!sources.liDaily || !sources.liPlan || !Array.isArray(sources.effLIs)) return null;

  const day = asOf ?? sources.asOf ?? null;
  let byDay = campCtxCache.get(sources);
  if (!byDay) { byDay = new Map(); campCtxCache.set(sources, byDay); }
  const key = day || '';
  if (byDay.has(key)) return byDay.get(key);

  // campM(liDaily, liPlan, asOf, effLIs, range, splitScopedMode, splitScopedPlans)
  const out = campM(sources.campaignLiDaily || sources.liDaily, sources.liPlan, day, sources.effLIs, null, false, null);
  byDay.set(key, out);
  return out;
}

/** Finance atoms read the same scoped facts, virtual plans and effective period as
 * every other node in their widget. Currency and density are display metadata only.
 *
 * `cm` follows the widget's window, and its plan sums follow it too when the viewer narrowed
 * it (`sources.planFollowsRange`, 2026-09-23) — the same rule the formula plan fields beside
 * it obey, so a progress bar's tick (cm) and its target (a formula) stand on one plan.
 * `flCM` stays the whole flight. */
export function compositionContext(data, metadata = {}) {
  const sources = data?.sources;
  return {
    ...metadata,
    data,
    cm: sources ? campM(sources.campaignLiDaily || sources.liDaily, sources.liPlan, sources.asOf, sources.effLIs, data.range, false, null,
      !!sources.planFollowsRange) : null,
    flCM: sources ? scopedCampCtx(sources, sources.asOf) : null,
    effLIs: sources?.effLIs || [],
    facts: { asOf: sources?.asOf },
    coefMode: coefModeOf(sources?.liPlan),
    // The RAW plan, for the reason `pacingWording` reads it: a scoped virtual plan drops
    // `k`, and the gross/net pair the caption names is drawn off the raw one (grossAgg).
    netMode: netModeOf(sources?.rawLiPlan || sources?.liPlan),
  };
}

/**
 * canonicalValue(key, campCtx) → `{value, absent, format}` for a BRICK_METRICS key.
 *
 * The evaluation is brick-data.js's `brickValue` — the same accessor the composite bricks
 * read, so a canonical value on a v2 tile and the same metric on the block beside it are
 * one implementation. Nothing about the formulas is restated here; only the CONTEXT
 * changes, and that is the point (spec §2: canonical values are campaign-level and
 * window-ineligible — the Period switch does not recompute them).
 *
 * `cm` and `flCM` are the SAME scoped context: scopedCampCtx is already full-flight
 * (range null), which is what both halves of a canonical metric want here — the
 * range-aware/full-flight split brick-data draws exists because the dashboard's own `cm`
 * follows the page Range filter, and a v2 widget's does not.
 *
 * `absent: true` is "this campaign has no goal for that unit" — a clicks-per-day target on
 * a CPM-only pacing is a question that does not apply, and the caller draws nothing rather
 * than a 0 that reads as real delivery. `format` is the metric's OWN, so an element whose
 * format says `auto` prints money as money.
 */
export function canonicalValue(keyOrValue, campCtx) {
  const key = keyOrValue && typeof keyOrValue === 'object' ? keyOrValue.key : keyOrValue;
  const reading = keyOrValue && typeof keyOrValue === 'object' && keyOrValue.reading === 'target'
    ? 'target' : 'value';
  const ctx = campCtx || null;
  const out = brickValue({ bind: { metric: key } }, { cm: ctx, flCM: ctx });
  const value = reading === 'target' ? out.target : out.value;
  return {
    value: value == null ? null : value,
    absent: !!out.absent || (reading === 'target' && value == null),
    format: out.format || 'auto',
    support: out.sub || null,
    invert: !!out.invert,
  };
}

/* ── the chart view's model (§5.1) ────────────────────────────────────────── */

/** §5.1's own sentence, printed under the chart when a Plan/Needed line has no date axis
 *  to stand on. The series is KEPT (§3 amendment) — the note says why it is not drawn.
 *
 *  EXPORTED since P3 Task 2: the builder lists the same skipped series in its own banner
 *  and in the Save prompt, and a second spelling of this sentence would have the tile and
 *  the editor disagree about why a line is missing. */
export const CALC_SKIP_REASON = 'Plan / Needed: date axis only';

/** What the two calc series are called when their label is auto (§8's own names). Exported
 *  for the same reason as CALC_SKIP_REASON: the builder names the skipped line. */
export const CALC_LABELS = {
  __proto__: null,
  planPerDay: 'Plan per day',
  neededPerDay: 'Needed per day',
  projection: 'Projection',
};

/** The three row keys the model owns: the category/date value, the Others marker and the
 *  stack's total. A series id is a
 *  NodeId (`^[a-z][a-z0-9_]{0,19}$`), so `x` is a legal series id and would otherwise
 *  overwrite the axis; the two underscored ones cannot be, and are reserved beside it. */
const ROW_X = 'x';
const ROW_OTHERS = '__others';
const ROW_STACK = '__stack';

/**
 * The data key each series writes into a row. It is the series id in every ordinary case —
 * which is what the model's shape promises — and an escaped one for the pathological
 * collision above. A NodeId never starts with `_`, so one prefix always leaves the id space.
 */
function rowKeysFor(ids) {
  const taken = new Set([ROW_X, ROW_OTHERS, ROW_STACK]);
  const out = Object.create(null);
  for (const id of ids) {
    let key = id;
    while (taken.has(key)) key = `_${key}`;
    taken.add(key);
    out[id] = key;
  }
  return out;
}

/** A series recharts will STACK: the stored style says bars, and the bars say stacked
 *  (Table F). One predicate, read by the model that sums the stack and by the attach pass
 *  that re-sums it — the renderer's `stackId` is the third reader of the same fact. */
const isStackedBar = (entry) => !!(entry.style && entry.style.type === 'bar' && entry.style.bars === 'stacked');

/**
 * The stack's total, written into each row under ROW_STACK.
 *
 * A stacked bar is ONE bar to whoever looks at it, so the number printed past its end is
 * read as the whole bar (P2 handoff §5.4 — the owner's reading of wb2-14, where the top
 * segment's own value sat there). The segments keep their numbers in the tooltip.
 *
 * The rest of this path's rule holds here too: nothing that could not be computed
 * contributes a zero, and a row where NO segment has a number has no total at all — the
 * renderer draws no label for a null, exactly as it draws no point for one.
 */
function fillStackTotal(rows, keys) {
  for (const row of rows) {
    let sum = null;
    for (const k of keys) {
      const v = row[k];
      if (Number.isFinite(v)) sum = sum === null ? v : sum + v;
    }
    row[ROW_STACK] = sum;
  }
}

/**
 * chartCannotDraw(model) → the sentence a chart prints INSTEAD of a plot, or null.
 *
 * A chart every one of whose drawn series the engine refused has no line, no bar and no
 * axis worth drawing, and the tall empty plot it used to draw was a picture of nothing with
 * the reason in small type underneath (P2 handoff §5.4 — wb2-11). The compact state says it
 * where the plot would be, in the model's own words: the engine's sentence names the field,
 * and the series' label names the line it was asked for.
 *
 * Read off the model rather than computed inside it, and that is the point: `attachCmData`
 * can REFUSE a series the build accepted (a cm-fed line on a line-item axis has no join),
 * so the answer belongs to whichever model is being drawn, not to the one that was built.
 *
 * Three things are NOT this state, and each has its own: a series still waiting on the
 * CM360 adapter (no error — its numbers are coming), a chart with nothing drawn at all
 * (the empty window says so), and a chart where anything at all could be drawn.
 */
export function chartCannotDraw(model) {
  if (model?.guides?.some((guide) => guide.dynamic && model.rows?.some((row) => Number.isFinite(row[guide.key])))) return null;
  const series = model && Array.isArray(model.series) ? model.series : [];
  if (!series.length) return null;
  const errors = (model && model.errors) || {};
  const parts = [];
  for (const s of series) {
    const err = hasOwn(errors, s.id) ? errors[s.id] : null;
    if (!err) return null;
    const phrase = s.label ? `${s.label}: ${err}` : err;
    if (parts.indexOf(phrase) === -1) parts.push(phrase);
  }
  return `Cannot draw this chart. ${parts.join('; ')}`;
}

/**
 * Where an `auto` series sits (§5.1). Two rules, and neither ever moves an EXPLICIT one:
 *
 *   · a family a series has already pinned to an axis IS that axis — an auto series of the
 *     same unit joins it rather than opening a second scale for the same unit;
 *   · every other family takes the free axis in order of first appearance — the first
 *     family present goes left, the second right.
 *
 * The validator caps a chart at two families (two axes cannot hold three), so the third
 * branch below is unreachable on a stored spec and exists only so a malformed one lands
 * somewhere instead of undefined.
 *
 * EXPORTED since P3 Task 6: the builder's chart card says which axis each series sits on in
 * its one-line summary, and decides which axis a freshly picked metric may fill the scale of.
 * Both are questions about where the TILE puts the series, and a second placement rule in the
 * editor would print «left axis» beside a line the chart draws on the right.
 */
export function placeAxes(families, axes) {
  const pinned = Object.create(null);
  for (let i = 0; i < families.length; i++) {
    const fam = families[i];
    if (!fam) continue;
    if ((axes[i] === 'left' || axes[i] === 'right') && !pinned[fam]) pinned[fam] = axes[i];
  }
  const place = Object.assign(Object.create(null), pinned);
  const used = new Set(Object.values(pinned));
  for (const fam of families) {
    if (!fam || place[fam]) continue;
    const side = !used.has('left') ? 'left' : (!used.has('right') ? 'right' : 'left');
    place[fam] = side;
    used.add(side);
  }
  return families.map((fam, i) => (
    axes[i] === 'left' || axes[i] === 'right' ? axes[i] : (fam && place[fam]) || 'left'
  ));
}

/**
 * The canonical TARGET readings that are window readings, each with the formula field that
 * reads it over a window. Only the CTR target, since the owner decision of 2026-09-23 (each
 * line's target weighted by its delivered impressions in the window). Every other canonical
 * target — margin, CPM, VCR, CPC, CPV — is a flight constant and stays on the scoped context.
 */
const WINDOW_TARGET_FIELD = { __proto__: null, ctr: 'ctrT' };
function windowTargetField(resolved) {
  return resolved && resolved.kind === 'canonical' && resolved.reading === 'target'
    && typeof resolved.key === 'string' ? WINDOW_TARGET_FIELD[resolved.key] || null : null;
}

/**
 * aggReading(resolved, datasetType, range, sources, campCtx) → what ONE aggregate slot
 * reads: `{ value, cm, error, warned }`. Every v2 element that shows a SINGLE number over
 * the widget's window comes through here — a chart guide (§5.1), a KPI and its target
 * (§5.3) — so those three can never disagree about what a value that cannot be computed
 * means.
 *
 *   `value`   the finite number, or null when there is none to show
 *   `cm`      `cmFeedOf`'s `{metric, side}` → adapter-fed, so `value` is null here and
 *             `attachCmData` fills it from the projection; `error` is null, because a slot
 *             waiting on the CM360 half is not a broken one.
 *   `error`   the engine's own sentence when it REFUSED the expression, so the reason
 *             lands on the tile instead of in a console
 *   `warned`  the engine's «some inputs were empty or invalid and read as 0» flag
 *
 * The evaluation is one `kpiValue` call in the AGG context of the window the widget is
 * read over. What is deliberately NOT inherited is `chartTargetSpec`'s `<= 0` gate
 * (controller ruling, 2026-08-21): the spec attaches no positivity clause to a guide or a
 * target, and `invert` exists precisely because either can be a lower-is-better number, so
 * a zero or a negative one is read at its own value. The legacy gate was reading something
 * else — the ABSENCE of a built-in campaign goal, which the division-by-zero canon reports
 * as 0 — and that case has its own arm: an ABSENT canonical value is nothing, not a zero.
 *
 * A `canonical` value reads the widget-scoped context (§2: campaign-level, window-
 * ineligible — the Period switch does not recompute it), so `range` never enters that arm —
 * with ONE exception, `overWindow`: the caller says the number this reading is set against
 * is a window reading (a chart series, a KPI or table column over the widget's window), and
 * the canonical reading is a TARGET that is itself a window reading (windowTargetField). The
 * CTR target is one since the owner decision of 2026-09-23 — each line's target weighted by
 * the impressions it delivered in the window the CTR is read over — so the CTR Trend's
 * «Target» line on a 7-day window is that week's target, the number the Targets tile and the
 * Daily table's Totals print beside it, not the flight's.
 */
function aggReading(resolved, datasetType, range, sources, campCtx, overWindow = false) {
  const none = { value: null, cm: null, error: null, warned: false };
  if (!resolved) return none;
  if (resolved.kind === 'canonical') {
    const field = overWindow && sources ? windowTargetField(resolved) : null;
    if (field) {
      // The formula field, over the same facts and window the series beside it reads: the
      // Targets tile's own computation, so the two cannot weigh the target two ways.
      const out = kpiValue({ expr: field }, range, sources);
      return Number.isFinite(out.value) ? { value: out.value, cm: null, error: null, warned: false } : none;
    }
    const out = canonicalValue(resolved, campCtx);
    if (out.absent || !Number.isFinite(out.value)) return none;
    return { value: out.value, cm: null, error: null, warned: false };
  }
  // §3.6: a metric this pacing's data does not carry reads as a confident 0 through the
  // engine (the absence-is-zero canon), so it is answered BEFORE the engine is asked.
  const why = unavailableMetric(resolved, sources, null);
  if (why) return { value: null, cm: null, error: why, warned: false };
  const expr = valueToExpr(resolved, datasetType);
  if (expr == null) {
    const feed = cmFeedOf(resolved, datasetType);
    return feed ? { value: null, cm: feed, error: null, warned: false } : none;
  }
  if (!sources) return none;
  const out = kpiValue({ expr }, range, sources);
  // A REFUSAL carries no warning. `kpiValue` raises `warned` on both (widget-data.js:1116
  // returns `{value: 0, warned: true, error}` for an expression it would not compile), but
  // the two say different things: `warned` means «this number was computed from inputs that
  // read as 0», and a refused expression produced no number at all. `error` is the whole
  // truth about this arm, and it has a reader. A ⚠ beside an em dash, or beside a clean
  // number whose TARGET was refused, is a badge with nothing to be about.
  if (out.error) return { value: null, cm: null, error: out.error, warned: false };
  return {
    value: Number.isFinite(out.value) ? out.value : null,
    cm: null, error: null, warned: !!out.warned,
  };
}

/**
 * What a GUIDE reads (§5.1), as one of three answers:
 *
 *   `{value}`             the number its line sits at
 *   `{cm: {metric,side}}` CM-fed: not evaluable here, filled from the projection — never dropped
 *   `null`                no line at all
 *
 * All three are `aggReading`'s, narrowed: a guide draws a line or it does not, so an
 * expression the engine refused and a campaign goal that does not apply reach the chart
 * the same way — as no line. A CM-fed guide keeps its place instead: the model marks it and
 * flags `cmPending`, so `attachCmData` has a typed slot to fill rather than a line that
 * disappeared between the config and the tile. `bound` cannot appear: the grammar refuses a
 * reference line that moves with the switch.
 */
function guideReading(guide, spec, controlState, datasetType, range, sources, campCtx, overWindow = false) {
  const resolved = resolveValue(guide && guide.value, spec, controlState);
  if (!resolved) return null;
  const r = aggReading(resolved, datasetType, range, sources, campCtx, overWindow);
  if (r.cm) return { cm: r.cm };
  if (r.value == null) return null;
  return { value: r.value };
}

/**
 * buildReportChartModel(view, spec, controlState, data, campCtx) → everything ReportChart
 * draws, and nothing about how it looks:
 *
 *   { mode, rows, series, skipped, guides, stackTotal, formats, orientation, note,
 *     errors, cmPending }
 *
 * `data` is `useWidgetData(widget, rangeOverride)`'s answer — `{range, sources}` — so the
 * widget's scope and its period are ALREADY applied: this function never re-reads either.
 *
 * P2 decision 3, in one place: a v2 value is TRANSLATED onto the existing widget engine.
 * `buildSeriesModel` walks the continuous calendar, `buildCategoryModel` folds top-N
 * with the P0-corrected Others basis, and neither is reimplemented here — a v2 chart and
 * every canonical Chart View draws identical numbers from one implementation.
 *
 * Four rules this canonical model enforces:
 *   · **X never changes a style** (§5.1). The stored style object is passed through
 *     untouched on every axis; the renderer never rewrites authored style from the X grain.
 *   · **Hidden is absent, not faded.** A hidden series has no row key, no legend entry and
 *     no skip note: Show/Hide lives in the builder's More menu, not on the tile.
 *   · **Nothing that could not be computed draws a zero.** A series whose expression the
 *     engine refuses carries nulls and its message in `errors`; zero would be a measured
 *     statement about delivery that measured nothing.
 *   · **A CM-fed value waits for the adapter, it is never dropped.** `source:'cm'` values and
 *     the dual-source bq form keep their place: a SERIES with `cm: {metric, side}` and null
 *     rows, a GUIDE with the same marker and a null value, and `cmPending` on the model
 *     either way. `attachCmData` (below) fills all three from the §8.5 projection.
 *
 * `errors` is keyed by SERIES id (the engine keys by the synthetic id, which is the row
 * key) and READ BY OWN-KEY: a series id is a NodeId and `constructor` is a legal one, so a
 * bare lookup would read Object's own constructor as «this series is broken» and null out a
 * line that drew perfectly well. `skipped` carries the calc series a non-date X has nothing
 * to stand on. `stackTotal` is the end label of a stacked bar — `{key, keys}` or null; see
 * fillStackTotal for why the whole is the number that belongs there.
 */
export function buildReportChartModel(view, spec, controlState, data, campCtx) {
  const datasetType = (spec && spec.dataset && spec.dataset.type) || 'delivery';
  // The axis the viewer is looking at: a control-bound X is the dimension their switch is
  // on (M4), and every rule below reads the RESOLVED grain — the axis a stored `control`
  // ran down is a dimension axis in every way that matters here.
  const x = resolveGrain(view && view.x, spec, controlState);
  const xType = x && (x.type === 'li' || x.type === 'dim') ? x.type : 'date';
  const mode = xType === 'date' ? 'date' : 'category';
  const sources = (data && data.sources) || null;
  const range = (data && data.range) || null;
  const stored = (view && Array.isArray(view.series) ? view.series : []).filter((s) => s && !s.hidden);
  const keys = rowKeysFor(stored.map((s) => s.id));

  const series = [];
  const feeds = [];          // index-aligned with `series`: how each one gets its numbers
  const skipped = [];
  const errors = {};
  let cmPending = false;
  // The pacing's own word for a delivery metric, on the same terms as the table's: a legend
  // and a column header on one dashboard may not call one number two things.
  const wording = pacingWording(sources, campCtx);

  for (const s of stored) {
    const entry = {
      id: s.id, key: keys[s.id], label: '', style: s.style, axisSide: 'left',
      color: s.color, fill: s.fill, border: s.border, opacity: s.opacity,
      dashed: s.dashed, bound: false, valuesOnChart: !!s.valuesOnChart,
      family: null,
    };
    if (s.kind === 'calc') {
      entry.label = s.labelAuto ? (CALC_LABELS[s.calc] || s.calc) : s.label;
      // §3 amendment: the series is stored on any X and SKIPPED off the date axis, with its
      // reason — deleting it the moment the author changes the axis is what this replaces.
      if (mode !== 'date') { skipped.push({ id: s.id, label: entry.label, reason: CALC_SKIP_REASON }); continue; }
      entry.calc = s.calc;
      entry.family = BASIS_FAMILY[s.basis] || 'count';
      entry.modeControlId = s.modeControlId || null;
      series.push(entry);
      feeds.push({
        kind: 'calc',
        calc: s.calc === 'projection' ? s : s.calc,
        mode: projectionMode(s, spec, controlState),
        axis: s.axis,
        guide: s.guide || null,
      });
      continue;
    }

    const resolved = resolveValue(s.value, spec, controlState);
    if (!resolved) {
      // Unreachable on a stored spec — the grammar keeps a metric switch alive for as long
      // as a bound value follows it. It still answers, because a renderer that throws here
      // takes the dashboard down for a config the server would never have accepted.
      entry.label = s.labelAuto ? '' : s.label;
      errors[s.id] = 'this series follows a metric switch the widget no longer has';
      series.push(entry);
      feeds.push({ kind: 'none', axis: s.axis, guide: s.guide || null, resolved: null, accumulate: s.accumulate });
      continue;
    }
    entry.label = s.labelAuto ? autoLabel(resolved, controlState, wording) : s.label;
    entry.bound = !!resolved.bound;
    entry.family = resolved.unitFamily || null;
    if (isConversionValue(resolved)) entry.conversion = true;

    // §3.6: a metric this pacing's data does not carry draws a flat zero line otherwise. The
    // series is SKIPPED with its reason — the calc series' own shape one branch up. The grain
    // is the RESOLVED X: on a `ds:` axis the numbers come from that source's file, so its own
    // metric list is what judges the series, exactly as the table's row grain does.
    const why = unavailableMetric(resolved, sources, x && x.key);
    if (why) { skipped.push({ id: s.id, label: entry.label, reason: why }); continue; }

    // A calculated Guide reads its basis off `resolved` and its output off `accumulate`
    // (spec 2026-09-10 «The child»): the feed carries both so the guide loop below needs
    // no second resolution and can never disagree with the series it explains.
    const expr = seriesExpr(resolved, s.accumulate, datasetType);
    // §2.9: `seriesExpr` now answers a non-null for TWO different things — engine input, and
    // the cumsum-wrapped source of a CM360 series. The cm arm is taken FIRST, because the
    // engine arm below would otherwise compile a `cmIm` it has no column for. It gates on the
    // TEXT rather than on the marker: text that names a CM360 identifier and does not PARSE
    // (`cmIm /`, half-typed) mints no marker, and gating on the marker would drop it into the
    // engine arm — the one place this branch exists to keep it out of. The series then draws
    // nothing, which is `cmMarkerOf`'s own stated contract for unparseable text. The marker
    // itself is minted off the WRAPPED text, so the Cumulative switch is part of what the
    // second pass evaluates. The `else` branch below still mints the METRIC marker, and still
    // gets every cm value that answered null here: a daily cm metric, and the dual-source bq
    // half on both switch positions.
    if (expr != null && isCmBearing(expr)) {
      const marker = cmMarkerOf(expr);
      if (marker) { entry.cm = marker; cmPending = true; }
      feeds.push({ kind: 'none', axis: s.axis, guide: s.guide || null, resolved, accumulate: s.accumulate });
    } else if (expr != null) {
      feeds.push({ kind: 'engine', expr, axis: s.axis, guide: s.guide || null, resolved, accumulate: s.accumulate });
    } else if (resolved.kind === 'canonical') {
      // A campaign-level constant, drawn as the flat line it is. §2 makes it window-
      // INELIGIBLE: the Period switch does not recompute it, and neither does `accumulate`
      // redefine it — a running total of a full-flight scalar is not a second reading of it.
      const out = canonicalValue(resolved, campCtx);
      feeds.push({ kind: 'const', value: out.absent ? null : out.value, axis: s.axis, guide: s.guide || null, resolved, accumulate: s.accumulate });
    } else {
      const feed = cmFeedOf(resolved, datasetType);
      if (feed) { entry.cm = feed; cmPending = true; }
      feeds.push({ kind: 'none', axis: s.axis, guide: s.guide || null, resolved, accumulate: s.accumulate });
    }
    series.push(entry);
  }

  const sides = placeAxes(series.map((e) => e.family), feeds.map((f) => f.axis));
  series.forEach((e, i) => {
    e.axisSide = sides[i];
    // Legacy conversion charts used the default count scale. Preserve their
    // compact axis, while tooltips and value labels retain attributed fractions.
    // Formula series and explicitly selected numeric/currency scales keep their format.
    if (e.conversion && view?.formats?.[e.axisSide] === 'kilo') e.valueFormat = 'count1';
  });

  // The expression request carries only id/label/expr. The canonical view's `topN` is
  // passed separately to the category model below.
  const engineDefs = [];
  const idByKey = Object.create(null);
  series.forEach((e, i) => {
    idByKey[e.key] = e.id;
    if (feeds[i].kind === 'engine') engineDefs.push({ id: e.key, label: e.label, expr: feeds[i].expr });
  });

  let rows = [];
  // The window's plan, as the ENGINE built it for this very read (§2.4): a cm-bearing series
  // naming `planImpr` reads the number the engine's own series read, never a second
  // computation. Null with no sources, where nothing is drawn at all.
  let windowScalars = null;
  // The dimension half of §2.4's published plan, filled by the category branch below and
  // null on a date axis, where every slot reads the window's plan instead.
  let cmCategoryPlans = null;
  let cmCategoryFieldSet = null;
  // The window a CM360 window function runs down (§2.9): the engine's UNFILTERED calendar,
  // taken before `factDates` narrows what is drawn. `chartWithCm`'s window pass evaluates
  // over it and writes each value back by date, so a fact-date axis still shows a running
  // total that ran over every day of the window.
  let cmDates = null;
  if (sources && mode === 'date') {
    const out = buildSeriesModel(engineDefs, range, sources);
    cmDates = out.dates;
    windowScalars = out.scalars;
    for (const key of Object.keys(out.errors)) errors[idByKey[key]] = out.errors[key];
    const engineByKey = Object.create(null);
    for (const r of out.series) engineByKey[r.id] = r;
    const calcByKey = Object.create(null);
    series.forEach((e, i) => {
      if (feeds[i].kind !== 'calc') return;
      const got = calcSeriesValues(feeds[i].calc, sources, range, {
        mode: feeds[i].mode,
        domain: x && x.domain,
      });
      const byDate = new Map();
      got.dates.forEach((d, j) => byDate.set(d, got.values[j]));
      calcByKey[e.key] = byDate;
    });
    const factDates = x && x.domain === 'factDates'
      ? new Set(projectionFactDates(sources, range)) : null;
    const dated = out.dates.map((date, index) => ({ date, index }))
      .filter(({ date }) => !factDates || factDates.has(date));
    rows = dated.map(({ date, index }) => {
      const row = { [ROW_X]: date };
      series.forEach((e, si) => {
        const f = feeds[si];
        if (f.kind === 'engine') {
          const r = engineByKey[e.key];
          row[e.key] = !r || hasOwn(errors, e.id) ? null : r.values[index] ?? null;
        } else if (f.kind === 'calc') {
          const byDate = calcByKey[e.key];
          row[e.key] = byDate && byDate.has(date) ? byDate.get(date) : null;
        } else if (f.kind === 'const') {
          row[e.key] = f.value;
        } else {
          row[e.key] = null;
        }
      });
      return row;
    });
  } else if (sources) {
    // The engine RANKS categories by its first compiled series (buildCategoryModel's
    // own sort), which here is the first ENGINE-fed one — a chart whose first series is
    // canonical or CM-fed is ranked by the next one that has numbers, and one with NO
    // engine series keeps the dimension's own bucket order. Recorded rather than worked
    // around: the ranking and the top-N fold happen where the fold basis lives, and
    // re-ordering the categories afterwards (attachCmData knows the CM numbers) would
    // leave the «Others» bucket standing over a tail it no longer folds.
    const out = buildCategoryModel({
      expressions: engineDefs,
      identities: stored.some((series) => series.highlights?.length),
      grain: xType === 'li' ? { type: 'li' } : { type: 'dim', key: x.key },
      // `topN` is the view's; the validator has already refused it on a date axis, so this
      // model reads it where it is legal and asks no second time.
      limit: typeof view.topN === 'number' ? view.topN : null,
    }, range, sources);
    windowScalars = out.windowScalars;
    for (const key of Object.keys(out.errors)) errors[idByKey[key]] = out.errors[key];
    // The plan behind each CATEGORY, published for the second pass (§2.4): the same objects
    // the bars were drawn from, keyed by the label the axis prints — which is what
    // `chartWithCm` joins on. Only a dimension axis has one; a line item declares no
    // dimension target and has no CM360 join either (§2.2).
    if (xType === 'dim') {
      cmCategoryPlans = new Map(out.categories.map((cat) => [String(cat.label), cat.plan]));
      cmCategoryFieldSet = out.fieldSet || null;
    }
    const atKey = Object.create(null);
    engineDefs.forEach((d, i) => { atKey[d.id] = i; });
    rows = out.categories.map((cat) => {
      const row = { [ROW_X]: cat.label, ...(cat.highlightKey ? { __highlightKey: cat.highlightKey } : null) };
      if (cat.others) row[ROW_OTHERS] = true;
      series.forEach((e, si) => {
        const f = feeds[si];
        if (f.kind === 'engine') {
          row[e.key] = hasOwn(errors, e.id) ? null : cat.values[atKey[e.key]] ?? null;
        } else if (f.kind === 'const') {
          row[e.key] = f.value;
        } else {
          row[e.key] = null;
        }
      });
      return row;
    });
  }

  // The stack's own number, once per row. It is on the MODEL and not in the renderer for
  // the reason every other number here is: a total the tile computed itself is a second
  // aggregation, and this one would be read as the bar. Only a stack that PRINTS its values
  // has anything to sum — one bar's own value already is the whole of it, and a stack
  // nobody labelled has no end label to be wrong.
  //
  // ONE SCALE, or no total: recharts stacks per axis, so bars asking to stack across two
  // axes are drawn side by side and are not one bar at all — and adding impressions to
  // dollars would print a number that means nothing. Those keep their own labels, which is
  // what a chart of two separate bars should have.
  const stacked = series.filter(isStackedBar);
  const oneScale = stacked.length > 1 && stacked.every((e) => e.axisSide === stacked[0].axisSide);
  const stackTotal = oneScale && stacked.some((e) => e.valuesOnChart)
    ? { key: ROW_STACK, keys: stacked.map((e) => e.key) }
    : null;
  if (stackTotal) fillStackTotal(rows, stackTotal.keys);

  const guides = [];
  series.forEach((e, i) => {
    const guide = feeds[i].guide;
    if (!guide) return;
    const presentation = Object.fromEntries(['style', 'color', 'dashed', 'opacity', 'valuesOnChart']
      .filter((key) => hasOwn(guide, key)).map((key) => [key, guide[key]]));
    if (guide.calc) {
      // The parent decides the calculation's basis (its resolved metric) and output (its
      // accumulate); the Guide stores only the mode. A parent the engine has no plan for
      // (a formula, a rate, completes, conversions) keeps the child and skips it with a reason.
      const label = guide.label || calculatedGuideLabel(guide, feeds[i].accumulate);
      const basis = feeds[i].kind === 'calc' ? null : guideBasisOf(feeds[i].resolved);
      const reason = mode !== 'date' ? 'Guide: date axis only'
        : datasetType !== 'delivery' || e.cm ? 'Guide: this calculation needs delivery data'
          : !basis ? 'Guide: this series has no pacing plan' : null;
      if (reason) { skipped.push({ id: `guide:${e.id}`, label, reason }); return; }
      const key = `__guide_${e.id}`;
      const hasPlan = sources?.effLIs?.some((id) => sources.liPlan?.[id]);
      const output = feeds[i].accumulate === 'cumulative' ? 'cumulative' : 'perDay';
      const got = calcSeriesValues({ calc: 'projection', basis, output }, hasPlan ? sources : null, range, {
        mode: guide.mode || projectionMode(guide, spec, controlState), domain: x && x.domain,
      });
      const byDate = new Map(got.dates.map((date, index) => [date, got.values[index]]));
      for (const row of rows) {
        const value = byDate.get(row[ROW_X]);
        row[key] = Number.isFinite(value) ? value : null;
      }
      guides.push({
        seriesId: e.id, key, dynamic: true, invert: !!guide.invert, axisSide: e.axisSide,
        label, ...(guide.labelPlacement ? { labelPlacement: guide.labelPlacement } : null),
        style: guide.style || { type: 'line', width: 1.5, curve: 'smooth', points: false },
        color: guide.color ?? 'expected', dashed: guide.dashed ?? 'short', opacity: guide.opacity ?? 1,
        valuesOnChart: !!guide.valuesOnChart,
      });
      return;
    }
    // A guide sits against its parent series. That series reads the chart's window unless it is
    // itself a canonical constant (a `const` feed), and only then may a window target follow it.
    const reading = guideReading(guide, spec, controlState, datasetType, range, sources, campCtx,
      feeds[i].kind !== 'const');
    if (!reading) return;
    if (reading.cm) {
      // The guide's own half of the CM contract: kept, marked, and counted — a renderer
      // draws no line for a null value, and attachCmData fills the number in here.
      cmPending = true;
      const item = {
        seriesId: e.id, value: null, invert: !!guide.invert, axisSide: e.axisSide, cm: reading.cm, ...presentation,
      };
      if (guide.label) { item.label = guide.label; item.labelPlacement = guide.labelPlacement; }
      guides.push(item);
      return;
    }
    const item = { seriesId: e.id, value: reading.value, invert: !!guide.invert, axisSide: e.axisSide, ...presentation };
    if (guide.label) { item.label = guide.label; item.labelPlacement = guide.labelPlacement; }
    guides.push(item);
  });

  const primary = series[0] || null;
  let title = (view && view.title) || '';
  // An auto title exists to tell views apart. On a single-view widget the tile header
  // already names the widget, and the same words one line lower only took that line
  // from the chart (owner, 2026-09-07) — so it is drawn only beside a second view.
  const manyViews = leafViews(spec && Array.isArray(spec.views) ? spec.views : []).length > 1;
  if (view && view.titleAuto && manyViews) {
    title = primary && primary.label ? primary.label : '';
    const storedPrimary = stored[0];
    const resolvedPrimary = storedPrimary && storedPrimary.kind === 'value'
      ? resolveValue(storedPrimary.value, spec, controlState) : null;
    if (resolvedPrimary && resolvedPrimary.kind === 'metric'
      && (resolvedPrimary.metric === 'vcr' || resolvedPrimary.metric === 'acr')) {
      title = `${completionLabel(!!(campCtx && campCtx.hasAudio))} Trend`;
    }
  }
  const hasMeaningfulPoint = rows.some((row) => series.some((entry) => (
    Number.isFinite(row[entry.key]) && row[entry.key] !== 0
  )));
  const hasMeaningfulGuide = guides.some((guide) => guide.dynamic
    ? rows.some((row) => Number.isFinite(row[guide.key])) : Number.isFinite(guide.value));

  // §2.4's plan block, hoisted so the return reads two names and no logic. ONE shape for every
  // member of `cmPlan`: `{ scalars, unplanned }`. A WINDOW's plan is the campaign's own and can
  // never be undeclared, so `unplanned` is false by construction — and a reader of
  // `cmPlan.window` is never the one who has to know that. `fieldSet` is what a POINT of this
  // axis may name: a date point stands on the window's plan, a category has its own and this
  // model does not carry it (Stage 3 publishes it).
  const cmWindowPlan = { scalars: windowScalars, unplanned: false };
  const cmFieldSet = mode === 'date' ? FIELDS_PLAN : CM_NO_PLAN_FIELDS;

  return {
    mode,
    // The RESOLVED axis, published rather than re-derived: a control-bound X is a dimension
    // at render time, and the CM360 half (`chartWithCm`) has to join on the axis the model
    // actually drew. Reading `view.x.type` a second time there answered 'date' for one.
    xType,
    rows,
    series,
    skipped,
    guides,
    stackTotal,
    formats: {
      left: (view && view.formats && view.formats.left) || 'number',
      right: (view && view.formats && view.formats.right) || 'number',
    },
    orientation: (view && view.orientation) === 'horizontal' ? 'horizontal' : 'vertical',
    title,
    journal: !!(view && view.journal),
    hidden: !!(view && view.emptyBehavior === 'hide' && !hasMeaningfulPoint && !hasMeaningfulGuide),
    // A source-backed dimension can cover only part of delivery. Chart used to be the one
    // canonical View that dropped this measured qualification even though Table and Pie
    // carried it. Resolve it from the axis the viewer is actually on (including a Dimension
    // switch), over this Widget's own window.
    note: sources && xType === 'dim' ? dimSourceCoverageNote(x.key, range, sources) : null,
    emptyNote: xType === 'dim' ? sourceFilterReason(sources, x.key, range) : null,
    errors,
    // The same five keys the table's `cmPlan` carries, so ONE `cmRowPlanOf` serves both second
    // passes (§2.4), and every member that carries a plan is a `{ scalars, unplanned }` pair —
    // `window` included. A chart has no Totals row and no search box; `totals` and `subset`
    // answer the window, which is what a guide and a chart target read.
    ...(viewHoldsCm(view, spec) ? {
      cmPlan: {
        window: cmWindowPlan,
        fieldSet: cmCategoryFieldSet ? cmPlanFieldsOf(cmCategoryFieldSet) : cmFieldSet,
        byKey: cmCategoryPlans,
        absent: ABSENT_ROW_PLAN,
        totals: cmWindowPlan,
        subset: () => cmWindowPlan,
      },
    } : null),
    // Sparse, and only where it can be read: the calendar a window function runs down, on
    // the one axis that has one, for the one kind of view that will ask (§2.9). Every other
    // chart model keeps exactly the shape it had.
    ...(cmPending && cmDates ? { cmDates } : null),
    cmPending,
  };
}

/* ── the table view's model (§5.2) ────────────────────────────────────────── */

const TABLE_GRAINS = new Set(['date', 'dateLi', 'li', 'dim']);

/**
 * What a DIMENSION is called, wherever this path prints one by name — the table's row
 * header, the pie's own caption and, since M4, a dimension switch's chips. One author, so a
 * viewer who flips the chip that says «Funnel» reads «Funnel» over the rows underneath it.
 *
 * Two tables, in this order and no other. `DIM_LABELS` is the product's own word for a
 * namebuilder dimension («Funnel» for `tactic`, «Creative (tag)» for `creative`) — the
 * Breakdown panel's table, which is where a reader has seen these words; a key it does not
 * hold is a dimension SOURCE, which names itself through the pacing's own config
 * (`dimAxisLabel`) and falls back to its machine key, ugly and truthful. Own-key by
 * construction: DIM_LABELS is null-prototype, so
 * `constructor` and `toString` name no dimension.
 */
export function dimensionLabel(key, sources) {
  if (hasOwn(AUX_DIMS, key)) return AUX_DIMS[key].label;
  return DIM_LABELS[key] || dimAxisLabel(key, sources && sources.dimSourceConfigs);
}

/**
 * The second line under a dimension's name, or null — the legacy tab bar's own sub-label
 * (`DIM_SUBLABELS`, Breakdown.jsx), which is the one place a reader learns that two similarly
 * named cuts read different data: «Creative (tag)» is `from planner / namebuilder` and
 * «Creative (asset)» is `from DSP`.
 *
 * Three tables, in this order: the aux pipelines name themselves, the two built-ins the panel
 * annotates carry `DIM_NOTES`, and a dimension SOURCE says whose file it is — the built-in
 * catalogue's note, or the pacing's own title for a configured one. Everything else answers
 * null and the chip stays one line, which is what keeps the row's height where it was.
 */
export function dimensionNote(key, sources) {
  if (hasOwn(AUX_DIMS, key)) return AUX_DIMS[key].note;
  if (hasOwn(DIM_NOTES, key)) return DIM_NOTES[key];
  return dimSourceNote(key, sources && sources.dimSourceConfigs);
}

/**
 * Why a DIMENSION view drew nothing, when the pacing itself is the reason — the sentence
 * the builder's own picker gives that dimension, so an author who was told «This pacing has
 * no Funnel values» before the pick meets the same words on the tile after it.
 *
 * This is Option B's own failure mode (M4): a dimension switch stores its options, and a
 * widget carrying `geo` travels to a pacing with no geo. Without this the view says «nothing
 * matches this table's scope», which sends the reader to the filters for a fact about the
 * pacing.
 *
 * FOUR keys it never answers for, each with a better answer already:
 *   · a `ds:` axis — a dimension SOURCE, which has `dimSourceMissingReason` and a coverage
 *     line of its own;
 *   · an `aux:` cut — the DSP's creatives and the conversions mart, each its own file beside
 *     the facts (`fetch_creatives` / `fetch_conversions`), so the refresh's split inventory
 *     has nothing to say about either;
 *   · `channel` — a property of the line item, not a split of the facts, so `availableSplits`
 *     says nothing about it;
 *   · anything at all before the blob has loaded (`availableSplits` absent) — «this pacing
 *     has no X» about a pacing nobody has read yet is a sentence about the store.
 * And it is asked ONLY of a view that drew no rows: `availableSplits` is the refresh's own
 * list and can under-report a dimension the facts carry, so a view with rows on screen is
 * the louder evidence.
 *
 * CONTENT, not the key. The builder initialises every bucket, so every pacing has all the
 * keys and this said «carried» for a dimension nothing ever delivered under; and `tactic` and
 * `platform` had no bucket at all until 2026-09-03, so a perfectly good Funnel tile printed
 * «This pacing has no Funnel values» on a pacing whose Funnel tab was open one section down.
 * A bucket holding at least one value is what says the pacing carries the dimension.
 */
function noDimReason(key, sources, range) {
  const auxReason = sourceFilterReason(sources, key, range);
  if (auxReason) return auxReason;
  if (!key || key.startsWith('ds:') || key.startsWith('aux:') || key === 'channel') return null;
  const splits = sources && sources.availableSplits;
  if (!splits || typeof splits !== 'object') return null;
  if (dimsWithValues(splits).has(key)) return null;
  return noDimValues(DIM_LABELS[key] || key);
}

/**
 * What a DIMENSION view says when the cut has no rows and the pacing is not the reason — the
 * legacy Breakdown panel's own sentence (Breakdown.jsx:809), in the legacy panel's own words
 * (spec rule 3). The generic table line, «nothing matches this table's scope», sends a reader
 * to the filters, which is exactly right here and says it in words nobody outside this codebase
 * uses; the pie's «No data for selected filters» says the same thing a third way. One fact, one
 * sentence, on both views.
 */
export const NO_BREAKDOWN_ROWS = 'No breakdown data for current selection';

/**
 * The best and worst reading in one column, as VALUES — or null where there is nothing to say
 * (§5.2's `highlightExtremes`; the legacy Breakdown panel's own rule, Breakdown.jsx:590).
 *
 * Two guards, both the panel's: fewer than two rows is not a comparison, and a spread under 10%
 * of the maximum is noise a colour would dramatise. Values rather than row keys, so the mark
 * survives a re-sort and paints every row that ties.
 *
 * The untagged remainder is NOT a data point — a synthetic 0.00% CTR wins «worst» every time
 * and paints a red flag on a row that has no CTR to judge. The panel learnt that one the hard
 * way and says so at its own :80. The cut's OTHER leftovers stay in, for the reason the same
 * comment gives: «Unclassified» and «No value» are aggregated from real facts, so their rates
 * are measured and belong in the comparison.
 *
 * Exported for the ONE other caller that needs it: the renderer's segment box narrows what is
 * drawn, and the legacy panel compares the rows it is showing (Breakdown.jsx:590 runs over
 * `filteredRows`). One function, so the two answers cannot drift apart.
 */
export function columnExtremes(rows, id, direction = 'higher') {
  const vals = [];
  for (const r of rows) {
    // Neither is a measured data point: the remainder, and a row made only of conversions.
    if (r.residual || r.cvOnly) continue;
    const v = r.cells[id];
    if (Number.isFinite(v)) vals.push(v);
  }
  if (vals.length <= 1) return null;
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  if (!(max > 0) || (max - min) / max <= 0.1) return null;
  return direction === 'lower' ? { best: min, worst: max } : { best: max, worst: min };
}

/** What stands over the label column. The three fixed grains name themselves; a dimension
 *  is `dimName`'s answer, which is why this is the MODEL's and not the renderer's — both
 *  tables arrive here (one imported, one on `sources`) and a v2 view renderer reads no
 *  store. */
function rowAxisLabel(rows, sources) {
  if (rows.type === 'li') return 'Line item';
  if (rows.type === 'dim') return dimensionLabel(rows.key, sources);
  return 'Date';
}

/** The SECOND label column, on the one grain whose rows are named by two things at once
 *  (section-widget parity, 2026-09-04). A date × line row has a date and a line item, and
 *  the legacy Daily Performance section gives each its own sortable column — without it the
 *  same date reads four times down the page with the line squeezed in beside it. Null on
 *  every other grain, which is what keeps their markup exactly as it was. */
function subAxisLabel(rowType) {
  return rowType === 'dateLi' ? 'Line item' : null;
}

/** What the tile says the table covers, under its title (section-widget parity, 2026-09-04)
 *  — the legacy section's own subtitle: the first and last day there is a row for, and, on
 *  the grain that has more than one line per day, how many lines are in it.
 *
 *  The separator is an EN dash, the range separator this product already uses (PeriodPicker,
 *  PeriodScopeBanner). The legacy subtitle spends an em dash on it and cannot here: no copy
 *  a reader meets carries one (owner, 2026-08-24). */
function tableRangeNote(rows, rowType) {
  if (!rows.length || (rowType !== 'date' && rowType !== 'dateLi')) return null;
  let min = null;
  let max = null;
  const lines = new Set();
  for (const r of rows) {
    if (!r.isDate) continue;
    if (min === null || r.label < min) min = r.label;
    if (max === null || r.label > max) max = r.label;
    if (r.liId != null) lines.add(r.liId);
  }
  if (min === null) return null;
  const span = `${fD(min)} – ${fD(max)}`;
  if (rowType !== 'dateLi' || !lines.size) return span;
  return `${span} · ${lines.size} line item${lines.size > 1 ? 's' : ''}`;
}

/**
 * The format a column's PLAN prints in, with `auto` resolved (§5.2; fix round 1).
 *
 * The grammar lets a target say `auto` for the reason a table cell may: the renderer picks.
 * Nothing picked, so `fmtV2(5989.23, 'auto')` printed a money plan as a bare `5,989.23` under
 * a `$7,033.57` fact. It is resolved off the TARGET's own value and never off the column's —
 * §5.2 exists to let a count column carry a money plan — and a canonical value's own format
 * wins, exactly as it does for the column one screen down (`clientPlanCpv` prints money4).
 */
function planFormat(format, resolved, campCtx) {
  if (format !== 'auto' || !resolved) return format;
  if (resolved.kind === 'canonical') return canonicalValue(resolved, campCtx).format;
  return isConversionValue(resolved) ? 'count1' : autoFormat(resolved.unitFamily);
}

/**
 * Which columns a table really prints: the author's, minus the ones that name `hideWhenEmpty`
 * and were never measured (§5.2, section-widget parity 2026-09-04).
 *
 * The legacy Daily Performance section asks this of its own facts on every render — it drops
 * Completed, VCR, Dynamic Cost and the four conversion columns when nothing in the window
 * carries one — and a stored column list cannot, so the author says WHICH columns are
 * optional and the model answers whether this window has them. Four columns of `0` on a
 * pacing that measures no conversions are not zeros, they are a question nobody asked.
 *
 * Three columns are never dropped, whatever they hold:
 *   · one with NO rows under it at all — «never measured» is a statement about rows, and a
 *     table showing its empty sentence must still show what it would have printed;
 *   · a REFUSED one, whose cells are null because the engine would not compute it: hiding it
 *     hides the badge that says so;
 *   · a CM-fed one, whose cells are null until `attachCmData` fills them one render later.
 */
function visibleColumns(columns, rows, totals, colErrors, keep = null) {
  if (!rows.length || !columns.some((c) => c.hideWhenEmpty)) return columns;
  return columns.filter((c) => {
    if (!c.hideWhenEmpty || c.cm || hasOwn(colErrors, c.id)) return true;
    // Primary conversions (spec §3): where a line item in view chose its conversions, the
    // conversion columns are drawn even when every cell is 0 or unavailable. «0 of the chosen
    // actions» and «cannot be shown here» are answers, not a column nobody measured.
    if (keep && keep.has(c.id)) return true;
    if (totals && totals[c.id]) return true;
    return rows.some((r) => !!r.cells[c.id]);
  });
}

/** A row's identity, for a renderer's key. Unique BY CONSTRUCTION on every grain: one row
 *  per calendar day, per effective line, per (day, line) pair, or per dimension bucket —
 *  and a bucket map cannot hold the same label twice. */
/**
 * One row's cells (and, on the same rule, the totals row): the ENGINE's number for a column
 * it computed, the campaign constant for a canonical one, and null for everything that has
 * no number yet — a refused column and a CM-fed one alike.
 *
 * BOTH maps are read by own-key. A column id is a NodeId, and `constructor` is a legal one:
 * a bare `from[c.id]` would hand a cell the Object constructor on the totals row of a table
 * with no totals (`from` is `{}` there), and a bare `colErrors[c.id]` would read that same
 * function as "this column is broken" and null out a column that computed perfectly well.
 */
function tableCells(columns, feeds, colErrors, from) {
  const cells = {};
  columns.forEach((c, i) => {
    const f = feeds[i];
    if (f.kind === 'const') cells[c.id] = f.value;
    else if (f.kind !== 'engine' || hasOwn(colErrors, c.id)) cells[c.id] = null;
    else cells[c.id] = hasOwn(from, c.id) ? from[c.id] ?? null : null;
  });
  return cells;
}

/**
 * primaryChip(primary) → `{ text, title }` for a Conversion Action row's chip, or null.
 *
 * `primary` is the model row's `{ chosen, of }`: line items in view that carry this action,
 * and how many of them chose it (spec §4). «primary» when every one did, «primary · K of N»
 * when some did. Text only; no colour marker.
 */
export function primaryChip(primary) {
  if (!primary || !(primary.chosen > 0) || !(primary.of > 0)) return null;
  const lines = (n) => `${n} line item${n === 1 ? '' : 's'}`;
  if (primary.chosen >= primary.of) {
    return {
      text: 'primary',
      title: primary.of === 1
        ? 'Chosen as a primary conversion on the line item that has it'
        : `Chosen as a primary conversion on all ${lines(primary.of)} that have it`,
    };
  }
  return {
    text: `primary · ${primary.chosen} of ${primary.of}`,
    title: `Chosen as a primary conversion on ${primary.chosen} of ${lines(primary.of)} that have it`,
  };
}

/**
 * sortReportRows(rows, sort) → a NEW array in the asked order.
 *
 * The comparator is buildTabularModel's own, moved out here because TWO callers need it and
 * only one of them can call the engine: the authored sort rides into the model (below), and
 * the VIEWER's header click re-orders the rows the renderer already holds — §5.2 makes that
 * click local to one viewer and never persisted, so it has no spec to rebuild a model from.
 * Same rules as the engine's, deliberately: `'__row__'` sorts on the row label, a null cell
 * sorts as 0, and ties keep the order they arrived in.
 *
 * The caller's array is never re-ordered under it: a renderer holds the model's rows across
 * renders, and sorting them in place would make the "unsorted" state unreachable.
 */
export function sortReportRows(rows, sort) {
  const col = sort && typeof sort.columnId === 'string' ? sort.columnId : ROW_SORT_KEY;
  const dir = sort && sort.dir === 'desc' ? -1 : 1;
  const out = (rows || []).slice();
  const read = (r) => (col === ROW_SORT_KEY ? r.label
    : col === SUB_SORT_KEY ? (r.sub || '').toLowerCase()
    : col === SHARE_SORT_KEY ? (r.share ?? 0)
    : r.cells[col] ?? 0);
  out.sort((a, b) => {
    // The engine's other rule, and the reason this comparator has to hold it too: a leftover
    // sinks below every real value whatever the viewer clicks. None of them is a segment
    // anybody chose, and one header click would otherwise float one to the top. `leftoverRank`
    // is the engine's own, so the two comparators cannot disagree about the order.
    if (leftoverRank(a) !== leftoverRank(b)) return leftoverRank(a) - leftoverRank(b);
    const av = read(a);
    const bv = read(b);
    return av < bv ? -dir : av > bv ? dir : 0;
  });
  return out;
}

/**
 * The second label column's sort key (section-widget parity, 2026-09-04). It is a VIEWER's
 * click and nothing else: the grammar's `sort` names a column id or `ROW_SORT_KEY`, so this
 * string can never be stored — which is exactly right, because the column it sorts exists only
 * on one grain and only in the renderer.
 *
 * It sorts on what the reader SEES first, the line's display name, so a renamed line sorts
 * where its name puts it; an unnamed one falls back to «LI <id>», which is the legacy
 * section's own order.
 */
export const SUB_SORT_KEY = '__sub__';
export const SHARE_SORT_KEY = '__share__';

/**
 * assignRowShares(rows, valueOf) → the same rows, each carrying its own `share` percentage.
 *
 * ONE denominator for every share the system draws (spec §2.6). Three callers divide by it:
 * the first pass's authored share (`buildReportTableModel`), the second pass's re-division
 * once a CM360 column has filled its cells (`withColumnShares`), and the CM-fed share, which
 * has no cell to read at all. They were two copies of the same four lines, and a share that
 * counted a null row as 0 in the denominator on one path and skipped it on the other would
 * make the percentages on one table add to something other than 100.
 *
 * The denominator is EVERY row handed in, the remainder and the leftovers included — that is
 * what makes a share a share of the pacing's delivery rather than of the tagged part — and a
 * reading that is not a number contributes 0 to it and takes no share of its own. A total of
 * zero or less leaves every share null: there is nothing to be a proportion of, and a 0%
 * would be a claim.
 *
 * It COPIES. A renderer holds the model's rows across renders, and writing `share` into them
 * would make the pending state unreachable on the next one.
 */
export function assignRowShares(rows, valueOf) {
  const total = rows.reduce((sum, row) => {
    const v = valueOf(row);
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);
  return rows.map((row) => {
    const v = valueOf(row);
    return { ...row, share: total > 0 && Number.isFinite(v) ? (v / total) * 100 : null };
  });
}

function withColumnShares(rows, columnId) {
  return assignRowShares(rows, (row) => row.cells[columnId]);
}

function withExtremes(columns, rows) {
  return columns.map((column) => {
    if (!column.highlightExtremes) return column;
    const out = { ...column };
    delete out.extremes;
    const extremes = columnExtremes(rows, column.id, column.highlightDirection);
    if (extremes) out.extremes = extremes;
    return out;
  });
}

/**
 * buildReportTableModel(view, spec, controlState, data, campCtx) → everything ReportTable
 * draws, and nothing about how it looks:
 *
 *   { rowLabel, columns, rows, totals, colErrors, sort, limit, cmPending }
 *
 * `data` is `useWidgetData(widget, rangeOverride)`'s answer — `{range, sources}` — so the
 * widget's scope and its period are ALREADY applied.
 *
 * P2 decision 3 again: the numbers are `buildTabularModel`'s. The canonical view is translated onto
 * it — the row grain into the engine's spelling, each value into a bare field or an
 * expression — so a v2 table and the built-in beside it cannot disagree about the entity
 * basis on line-item rows, the ts basis in a dimension bucket, or aggregate-then-compute in
 * the totals row. Nothing about any of that is restated here.
 *
 * What the canonical Table model decides:
 *   · **A column that is not engine-evaluable still has a column.** A canonical value is the
 *     campaign constant on every row (§2: campaign-level, window-ineligible); a Δ% and a
 *     CM-fed value carry nulls, `cm: {metric, side}` on the column and `cmPending` on the
 *     model — the slot `attachCmData` fills, the chart's contract on the other one.
 *   · **The rows arrive WHOLE and sorted; the limit is a number, not a cut.** The viewer's
 *     re-sort re-orders every
 *     row and the cut lands after it, so a limit applied here would freeze the top of the
 *     AUTHORED sort as the only rows anyone could ever re-sort.
 *   · **Nothing that could not be computed prints a zero.** A refused column carries nulls
 *     and its reason in `colErrors`, and its total is nothing.
 *   · **`columns` is the DRAWN list, and `rows`/`totals` are keyed by every authored column
 *     the buy-unit gate let through.** A `hideWhenEmpty` column that this window never
 *     measured leaves `columns` and therefore has no header, no total cell and no body cell;
 *     its number is still on the model under its own id, unreachable because every renderer
 *     reads a cell BY a drawn column's id. A `buyUnit` column on a pacing bought on another
 *     unit is withheld ONE STEP EARLIER, before any cell is built: it is not on `rows` or on
 *     `totals` at all, and no number for it was ever computed.
 *
 * `colErrors` is keyed by COLUMN id — the engine keys by the synthetic column id, which is
 * the v2 id, so no translation is needed on the way back. The cells live in their own
 * `cells` object, so a column id can never collide with a row's own keys.
 */
// A table can hold thousands of rows while React is still trying to mount it.
// Keep its prepared model outside hook state, which concurrent restarts discard.
// View keys are weak so an edited/deleted view releases its old models. Only
// immutable store snapshots opt in; mutable standalone callers still recompute.
const tableModels = new WeakMap();
export function buildReportTableModel(view, spec, controlState, data, campCtx) {
  const upgraded = upgradeConversionDefaults(spec);
  if (upgraded !== spec) {
    view = leafViews(upgraded.views).find(candidate => candidate.id === view?.id) || view;
    spec = upgraded;
  }
  const sources = data?.sources;
  if (!sources || !Object.isFrozen(sources) || !view) {
    return computeReportTableModel(view, spec, controlState, data, campCtx);
  }
  let byView = tableModels.get(sources);
  if (!byView) tableModels.set(sources, byView = new WeakMap());
  let entries = byView.get(view);
  if (!entries) byView.set(view, entries = []);
  const key = JSON.stringify([data.range || null, controlState || null]);
  const index = entries.findIndex((entry) => entry.spec === spec
    && entry.campCtx === campCtx && entry.key === key);
  if (index >= 0) {
    const [entry] = entries.splice(index, 1);
    entries.push(entry);
    return entry.model;
  }
  const model = computeReportTableModel(view, spec, controlState, data, campCtx);
  entries.push({ spec, campCtx, key, model });
  if (entries.length > 2) entries.shift();
  return model;
}

function computeReportTableModel(view, spec, controlState, data, campCtx) {
  const datasetType = (spec && spec.dataset && spec.dataset.type) || 'delivery';
  const sources = (data && data.sources) || null;
  const range = (data && data.range) || null;
  // The rows the viewer is looking at: a control-bound grain is the dimension their switch
  // is on (M4), and everything below reads the RESOLVED one.
  const rows = resolveGrain((view && view.rows) || { type: 'date' }, spec, controlState);
  const rowType = TABLE_GRAINS.has(rows.type) ? rows.type : 'date';
  // Both date grains print an ISO date as their label, which is what the renderer formats
  // for a human and reads the weekday off.
  const isDate = rowType === 'date' || rowType === 'dateLi';

  // `buyUnit` columns (sections cutover 2026-09-07): drawn only while the pacing is bought on
  // that unit — the legacy panel's «lead with the unit you are paced on», asked here instead
  // of frozen at mint. Judged on the effective line items, like the KPI bases; with no data
  // yet the unit is impressions and only a click- or completes-only column is withheld.
  const unit = buyUnitOf(sources && sources.liPlan, sources && sources.effLIs);
  const stored = (view && Array.isArray(view.columns) ? view.columns : [])
    .filter((c) => !c || !c.buyUnit || c.buyUnit === unit);
  const columns = [];
  const feeds = [];          // index-aligned with `columns`: how each one gets its numbers
  // …and so is this: what each column would be told APART by, if two of them collide on a
  // caption. Collected here because the loop is where the resolved value is in hand.
  const tells = [];
  const colErrors = {};
  let cmPending = false;
  // What this PACING calls a delivery metric, asked once for the whole table (§2's auto
  // caption): `dc`/`cpm` follow the coefficient-cost model and `vcr` follows audio.
  const wording = pacingWording(sources, campCtx);

  for (const c of stored) {
    // `numeric` is every column today — both column kinds print a number, and that is what
    // sends a cell to the right in a mono face. It is on the model rather than assumed by
    // the renderer so a column that prints something else has a place to say so.
    const entry = { id: c.id, label: '', format: c.format, kind: c.kind, numeric: true, bound: false };
    // The two authored facts about how a cell PRINTS, carried straight through: a column
    // that hides where nothing was ever measured, and a zero that reads as the empty-cell
    // placeholder. Sparse in the spec, and sparse here.
    if (c.hideWhenEmpty) entry.hideWhenEmpty = true;
    if (c.zeroAs) entry.zeroAs = c.zeroAs;
    // …and the third: this column's best and worst reading are tinted. The VALUES are filled
    // in below, once the rows exist; the mark rides here so the loop that built the column is
    // the one place a stored key is read.
    if (c.highlightExtremes) entry.highlightExtremes = true;
    const resolved = resolveValue(c.value, spec, controlState);
    if (!resolved) {
      // Unreachable on a stored spec (the grammar keeps a metric switch alive for as long as
      // a bound value follows it), and it still answers rather than taking the tile down.
      entry.label = c.labelAuto ? '' : c.label;
      colErrors[c.id] = 'this column follows a metric switch the widget no longer has';
      columns.push(entry);
      feeds.push({ kind: 'none' });
      tells.push({ label: entry.label, labelAuto: !!c.labelAuto, kind: c.kind, source: null, cm: false });
      continue;
    }
    // §3.6: a metric this pacing's data does not carry. The column keeps its place and says
    // why; `tableCells` reads `colErrors` and leaves every one of its cells empty, so no row
    // prints the engine's absence-is-zero 0. On a `ds:` grain the SOURCE's own envelope list
    // is the inventory — the delivery file's says nothing about a dimension source's columns.
    const why = unavailableMetric(resolved, sources, rows && rows.key);
    if (why) {
      entry.label = c.labelAuto ? autoLabel(resolved, controlState, wording) : c.label;
      colErrors[c.id] = why;
      columns.push(entry);
      feeds.push({ kind: 'none' });
      tells.push({ label: entry.label, labelAuto: !!c.labelAuto, kind: c.kind, source: null, cm: false });
      continue;
    }
    if (c.highlightExtremes) entry.highlightDirection = c.highlightDirection
      || (resolved.kind === 'metric' && ['cpm', 'cpc', 'cpv'].includes(resolved.metric) ? 'lower' : 'higher');
    entry.label = c.labelAuto ? autoLabel(resolved, controlState, wording) : c.label;
    entry.bound = !!resolved.bound;
    // The plan number the totals cell stacks under its fact (§5.2). It is read exactly as a
    // KPI's target is — `aggReading`, one number over the widget's own window — because it is
    // the same question one view over, and the two may not answer it differently. A target
    // that reads NOTHING (an absent campaign goal, a refused expression) leaves no line, and
    // so does a target of 0: every plan a totals row can carry is a goal, and zero is the
    // absence of one. That is the legacy section's own rule in four of its six cells
    // (`planClicks > 0`, and campM's null for the three targets); it is deliberately NOT the
    // KPI's, where `invert` makes a zero or a negative target a real lower-is-better goal
    // (controller ruling, 2026-08-21).
    //
    // A CM-FED plan is the one reading that is not answered here: it waits for the adapter in
    // a typed slot with a null number, and `tableWithCm` fills it from the window totals —
    // the KPI target's own treatment (fix round 1). Dropping it instead left a widget the
    // grammar accepts drawing nothing, forever.
    if (c.target) {
      const rt = resolveValue(c.target.value, spec, controlState);
      const t = aggReading(rt, datasetType, range, sources, campCtx, resolved.kind !== 'canonical');
      const tFormat = wholePlanFormat(planFormat(c.target.format, rt, campCtx), rt, datasetType);
      if (t.cm) {
        entry.target = { value: null, format: tFormat, cm: t.cm };
        cmPending = true;
      } else if (t.value) {
        entry.target = { value: t.value, format: tFormat };
      }
    }

    if (c.kind === 'delta') {
      // (CM − BQ) / BQ — its own stored kind, not a formula, and its own zero rule (§5.2).
      // BOTH halves arrive from the adapter, so there is nothing to ask the engine for; the
      // grammar has already made the value the dual-source form, which is what names the
      // field the two sides are compared on.
      if (typeof resolved.metric === 'string' && resolved.metric) {
        entry.cm = { metric: resolved.metric, side: 'delta' };
        cmPending = true;
      }
      columns.push(entry);
      feeds.push({ kind: 'none' });
      // A Δ% carries a marker with `side: 'delta'`, and `nameColumns` answers it on its KIND —
      // it prints the subtraction, not a side — so the cm tell stays false here.
      tells.push({ label: entry.label, labelAuto: !!c.labelAuto, kind: c.kind, source: null, cm: false });
      continue;
    }

    const expr = valueToExpr(resolved, datasetType);
    if (expr != null) {
      // A bare metric goes in as a FIELD ref and a formula as an expression — the legacy
      // table's own two column shapes. The engine reads them to the same number (its round
      // 6.1 fixed the one case where it did not: a plan scalar broadcast for `budget + 0`
      // but read row 0 for a bare `budget`), so this only decides which sentence an unknown
      // key produces — `Unknown field "zzz"` from the field ref, against the parser's.
      feeds.push({ kind: 'engine', source: resolved.kind === 'metric' ? { field: expr } : { expr } });
    } else if (resolved.kind === 'canonical') {
      const out = canonicalValue(resolved, campCtx);
      // `auto` is the author saying "you pick", and a canonical metric carries its own
      // format — canonicalValue's own sentence ("an element whose format says auto prints
      // money as money"). A table cell is the ONLY slot where `auto` is legal (§5.3/§5.4
      // forbid it on a KPI and a pie), so this is where that promise lands or nowhere. An
      // author who NAMED a format keeps it, exactly as stored.
      if (entry.format === 'auto') entry.format = out.format;
      feeds.push({ kind: 'const', value: out.absent ? null : out.value });
    } else {
      const feed = cmFeedOf(resolved, datasetType);
      if (feed) { entry.cm = feed; cmPending = true; }
      feeds.push({ kind: 'none' });
    }
    // `auto` is the author saying «you pick», and this is the pick: the value's own unit
    // family. `fmtV2`'s `auto` prints a bare number — money with no symbol and no grouping,
    // a rate with no sign — which is a wrong number rather than a wrong style. The canonical
    // branch above has always answered this with `canonicalValue`'s own format and keeps
    // priority (`clientPlanCpv` prints money4, not money); an engine-fed or cm-fed value has
    // its family instead. A Δ% is excluded above by its `continue`: it prints a percentage
    // whatever it compares, which is not the family of the field it compares.
    if (entry.format === 'auto') entry.format = isConversionValue(resolved) ? 'count1' : autoFormat(resolved.unitFamily);
    entry.format = wholePlanFormat(entry.format, resolved, datasetType);
    columns.push(entry);
    // The one exit a cm-bearing formula reaches. `entry.cm` is set above for BOTH marker
    // shapes, and only the formula one is told by this key: the dual-source bq half spells
    // its side in `source` already, and calling it CM would make «Both sources» print one
    // word twice.
    tells.push({ label: entry.label, labelAuto: !!c.labelAuto, kind: c.kind, source: resolved.source,
      cm: !!entry.cm && entry.cm.kind === 'formula' });
  }
  // Two columns of one field are told apart by the side they read (§2 cannot see the
  // neighbour) — see `nameColumns`. Assigned back, so everything downstream reads one label.
  nameColumns(tells).forEach((label, i) => { columns[i].label = label; });

  // The authored sort, in the engine's names. `'__row__'` is the same word on both sides —
  // it is the grammar's ROW_SORT_KEY and the engine's default, and it can never be a column
  // id (a NodeId starts at a lower-case letter).
  const sort = {
    columnId: view && view.sort && typeof view.sort.columnId === 'string' ? view.sort.columnId : ROW_SORT_KEY,
    dir: view && view.sort && view.sort.dir === 'desc' ? 'desc' : 'asc',
  };
  const totalsOn = !!(view && view.totals);

  let modelRows = [];
  let totals = null;
  let retotal = null;
  // The window's plan the engine built for this very read (§2.4), published below for the
  // CM360 second pass. On the date grains it is also what every row's plan cell prints.
  let windowScalars = null;
  // The engine's calendar order, for the CM360 window pass (§2.9). Null on every grain but
  // `date`, and published only where a CM360 slot can ask for it.
  let cmRowOrder = null;
  // The dimension-plan trio (2026-09-12), null on every other grain.
  let planColumns = null;
  // …and what the engine published about the plan behind each ROW (2026-09-16 §2.4), which
  // the trio does not carry: the scalars themselves. Null off the dimension grain.
  let rowPlans = null;
  let planDeclared = 0;
  let planDeclarable = 0;
  let totalsPartial = null;
  // Primary conversions (spec §3): the sentence behind «—» in the conversion Totals, or null.
  let cvNote = null;
  // …and which columns that sentence, and a row's reason, are ABOUT. Spec §3 says «—» with the
  // reason as the tooltip for the CONVERSION cells; a «—» another rule made keeps its own words
  // — a window function has no Totals cell at all, a date subset empties the expected columns,
  // and a line with no VCR target reads no VCR. Null unless something needs explaining.
  let cvCols = null;
  const shareValue = view && view.share && view.share.value;
  const shareResolved = shareValue ? resolveValue(shareValue, spec, controlState) : null;
  const shareExpr = shareResolved ? valueToExpr(shareResolved, datasetType) : null;
  // The share read from the CM360 adapter instead of the engine (spec §2.6): a `source:'cm'`
  // metric, or a cm-bearing formula, both answered by the ONE predicate every value slot
  // asks. `valueToExpr` returns null for both, so `shareExpr` is null and the sentence below
  // would otherwise refuse a share the adapter can perfectly well fill — which is the dead
  // end a bare cm metric share has today. `tableWithCm` fills every row's `share` instead.
  const shareCm = shareResolved ? cmFeedOf(shareResolved, datasetType) : null;
  // Pending on the same terms as a CM-fed column: the tile says it is waiting for CM360, and
  // ReportTable draws no percentages until the numbers arrive (it already draws none where a
  // row carries no `share`).
  if (shareCm) cmPending = true;
  // Reserved outside the stored column-id grammar; never a visible column or sort target.
  const shareKey = '__share__';
  const shareValues = new Map();
  let shareError = shareValue && shareExpr == null && !shareCm ? 'The row share has no readable delivery metric' : null;
  if (sources) {
    // ENGINE-fed columns are the only ones the expression model is asked about; a canonical or CM-fed column
    // is filled in below, and passing it as an expression would ask the engine for a field
    // it does not have. A table of nothing BUT such columns still walks its rows — the
    // grain is the engine's answer too.
    const engineCols = [];
    columns.forEach((c, i) => {
      if (feeds[i].kind === 'engine') engineCols.push({ id: c.id, label: c.label, format: c.format, source: feeds[i].source });
    });
    if (shareExpr != null) engineCols.push({ id: shareKey, label: 'Row share', format: 'auto', source: { field: shareExpr } });
    const out = buildTabularModel(
      { grain: rowType === 'dim' ? { type: 'dim', key: rows.key } : { type: rowType },
        columns: engineCols, sort, limit: null, totals: totalsOn,
        // The untagged remainder is the ENGINE's row: it is line totals minus the tagged
        // buckets, which only the aggregate can subtract. The view says whether to ask for it.
        residual: !!(view && view.residual) },
      range, sources,
    );
    windowScalars = out.windowScalars;
    Object.assign(colErrors, out.colErrors);
    cmRowOrder = Array.isArray(out.rowOrder) ? out.rowOrder : null;
    if (out.colErrors[shareKey]) { shareError = out.colErrors[shareKey]; delete colErrors[shareKey]; }
    if (shareExpr != null) for (const r of out.rows) shareValues.set(tableRowKey(r, rowType), r.cells[shareKey]);
    modelRows = out.rows.map((r) => ({
      key: tableRowKey(r, rowType),
      label: r.label,
      // Sparse, as the engine carries it: the delivery this dimension did not tag. It sorts
      // last, refuses a click and is never a best/worst data point.
      ...(r.residual ? { residual: true } : null),
      // …and the cut's other leftovers — «Unclassified», «No value». Same rank, same grey,
      // same refused click; they stay in the best/worst comparison because they are measured.
      ...(r.leftover ? { leftover: true } : null),
      // …and a row made only of conversions (primary conversions, spec §4): shown, never a
      // best/worst data point.
      ...(r.cvOnly ? { cvOnly: true } : null),
      // The second line of a row label: the LINE on a date × line item row (without it the
      // same date reads four times over), and the channel on a line-item row.
      sub: r.sub || null,
      // …and, on the date × line grain, the two halves of the line's under-line —
      // «LI 900101 · Display» — plus the line item this row belongs to, which is what the
      // range note counts. Null everywhere else, so no other grain's markup moves.
      subId: r.subId || null,
      subNote: r.subNote || null,
      liId: r.liId != null ? r.liId : null,
      // Sparse, as the engine carries it: a line that is paused right now.
      ...(r.paused ? { paused: true } : null),
      // …and, on a dimension grain, a row whose declared plan covers only PART of the
      // delivery standing in it (2026-09-12). It rides the row because that is what it is
      // about: every plan-derived cell in the row is short by the same fraction.
      ...(r.planPartial ? { planPartial: r.planPartial } : null),
      // …and, on the Conversion Action cut of an operative pacing, `{ chosen, of }` for the
      // «primary» chip (spec §4). Sparse: absent on every other row.
      ...(r.primary ? { primary: r.primary } : null),
      // …and why this row's conversion cells are «—». Sparse.
      ...(r.cvReason ? { cvReason: r.cvReason } : null),
      isDate: isDate && !!r.date,
      cells: tableCells(columns, feeds, colErrors, r.cells),
    }));
    if (totalsOn) totals = tableCells(columns, feeds, colErrors, out.totals || {});
    if (totalsOn && out.cvNote) cvNote = out.cvNote;
    // Asked only where there IS something to explain, so a model with no conversion «—» keeps
    // today's exact shape. The keep-list's predicate, without its `hideWhenEmpty` filter: a
    // drawn column is explained whether or not it could ever have hidden.
    if (cvNote || modelRows.some((r) => r.cvReason)) {
      cvCols = new Set(columns.filter((c, i) => feeds[i].kind === 'engine'
        && expressionReadsConversions(feeds[i].source.field ?? feeds[i].source.expr)).map((c) => c.id));
    }
    // The engine's subset total (the rows a search box keeps) through the same cell mapping
    // the Totals row took: a const column keeps its constant, a refused one its em dash, a
    // CM-fed one waits for tableWithCm to re-sum its pairs.
    if (totalsOn && typeof out.retotal === 'function') {
      const engineRetotal = out.retotal;
      retotal = (keys) => tableCells(columns, feeds, colErrors, engineRetotal(keys) || {});
    }
    // The dimension half of §2.4's published plan, carried straight through to `cmPlan`
    // below: the engine's own per-row objects, so a cm-bearing formula and the plan column
    // beside it stand on ONE weighting of one set of leaf plans.
    rowPlans = out.rowScalars || null;
    if (out.planColumns) {
      // …plus the columns the ENGINE never saw (2026-09-16 §2.4): a cm-bearing formula that
      // names a plan field is as plan-derived as `im / expIm` beside it — its empty cells
      // mean «no target», not «no data» — and the renderer decides the mark, the fade and
      // the footnote off this one map (ReportTable.jsx `isPlanCol` / `markColumnId`), so
      // joining it here is the whole of the change. A column the first pass already refused
      // is left out: its cells carry an error, and a plan mark would explain the wrong thing.
      const cmPlanCols = columns.filter((c) => c.cm && c.cm.kind === 'formula'
        && c.cm.planFields.length && !hasOwn(colErrors, c.id));
      // Null-prototype, because a column id is a NodeId and `constructor` is a legal one —
      // the reason `colErrorOf` in the renderer reads its map through hasOwnProperty.
      planColumns = Object.assign(Object.create(null),
        ...out.planColumns.map((id) => ({ [id]: true })),
        ...cmPlanCols.map((c) => ({ [c.id]: true })));
      planDeclared = out.planDeclared;
      planDeclarable = out.planDeclarable;
      // The whole table's plan against the whole table's delivery. Ratio only: there is no
      // row here to count line items over.
      totalsPartial = out.totalsPartial || null;
    }
  }

  // Each row's share of the author's column or independent value (§5.2). Never the sorted
  // one: a viewer's re-sort is theirs alone, and hanging the share on it would change what
  // every percentage on the table MEANS, one header click at a time. The denominator is every
  // row the model holds, the remainder included — which is what makes it a share of the
  // pacing's delivery rather than of the tagged part.
  const shareCol = view && view.share && typeof view.share.columnId === 'string' ? view.share.columnId : null;
  if (shareCol && hasOwn(colErrors, shareCol)) shareError = colErrors[shareCol];
  const shareOf = (r) => shareValue ? shareValues.get(r.key) : r.cells[shareCol];
  // …except a CM-fed one, which has no number on this pass at all. Dividing here would write
  // `share: null` onto every row, and a null share is what ReportTable draws as «no share on
  // this row» — the pending table would then look like an answered one with nothing to say.
  if ((shareCol || shareValue) && !shareError && !shareCm) {
    modelRows = assignRowShares(modelRows, shareOf);
  }

  // The best and worst reading in every column that asked to be tinted, as values.
  for (const c of columns) {
    if (!c.highlightExtremes) continue;
    const ex = columnExtremes(modelRows, c.id, c.highlightDirection);
    if (ex) c.extremes = ex;
  }

  // The author's optional columns, minus the ones this window never measured. LAST, because
  // the answer is about the rows that were built — and `columns` is what everything below
  // reads, so a hidden column has no header, no total and no cell.
  // The engine-fed conversion columns an operative pacing with a choice in view always draws.
  // Asked only when a column could hide at all, so every other table skips the parse.
  const keepConv = sources && columns.some((c) => c.hideWhenEmpty) && primaryCvInView(sources)
    ? new Set(columns.filter((c, i) => c.hideWhenEmpty && feeds[i].kind === 'engine'
      && expressionReadsConversions(feeds[i].source.field ?? feeds[i].source.expr)).map((c) => c.id))
    : null;
  const drawn = visibleColumns(columns, modelRows, totals, colErrors, keepConv);
  // A saved breakdown may sort by a video-only column that disappears on audio.
  // Its existing row share still expresses the selected metric, and remains sortable.
  if (sort.columnId !== ROW_SORT_KEY && sort.columnId !== SHARE_SORT_KEY
    && !drawn.some((c) => c.id === sort.columnId) && (shareCol || shareValue) && !shareError) {
    sort.columnId = SHARE_SORT_KEY;
  }
  modelRows = sortReportRows(modelRows, sort);

  // §2.4's plan block, on the chart's rule and in the chart's shape: `{ scalars, unplanned }`,
  // `unplanned` false because a window's plan is the campaign's and is never undeclared.
  // `fieldSet` is what a ROW of this grain may name — a date row stands on the window's plan,
  // a dimension row's plan is the ROW's own and this model does not carry it (Stage 3 does).
  const cmWindowPlan = { scalars: windowScalars, unplanned: false };
  const cmFieldSet = isDate ? FIELDS_PLAN : CM_NO_PLAN_FIELDS;

  return {
    rowLabel: rowAxisLabel(rows, sources),
    // The second header, on the one grain that needs two (null elsewhere).
    subLabel: subAxisLabel(rowType),
    // What the tile prints under its title: the window these rows cover, and how many line
    // items are in it. Null off the date grains, where a row is not a day.
    rangeNote: tableRangeNote(modelRows, rowType),
    // …and the grain those rows RAN DOWN, on the chart model's own rule: `tableWithCm`
    // joins on it, and a stored `control` read there would answer neither of the two
    // grains a CM360 join exists on.
    rowType,
    // …and, beside it, the order those rows were BUILT in — the engine's calendar, which is
    // what a running total runs down whatever header the viewer last clicked (§2.9). Sparse,
    // like `cmDates` on the chart: no CM360 slot, no order.
    ...(cmPending && cmRowOrder ? { cmRowOrder } : null),
    rowDimension: rowType === 'dim' ? rows.key : null,
    shareError,
    ...(shareCol ? { shareColumnId: shareCol } : null),
    // Sparse (§2.6): only a CM-fed share carries a marker, so every table without one is
    // byte-identical. `tableWithCm` reads it to decide whether to join at all — a table whose
    // ONLY CM360 element is its share has no fed column to tell it by.
    ...(shareCm ? { shareCm } : null),
    shareBound: !!(shareResolved && shareResolved.bound),
    columns: drawn,
    rows: modelRows,
    totals,
    // Sparse: only a table with a Totals row can re-total the rows a search box keeps.
    ...(retotal ? { retotal } : null),
    // The dimension-plan trio (2026-09-12), all four null/0 on every other grain. `planColumns`
    // is null-prototype and read through hasOwn, because a column id is a NodeId.
    planColumns,
    planDeclared,
    planDeclarable,
    totalsPartial,
    ...(cvNote ? { cvNote } : null),
    ...(cvCols ? { cvCols } : null),
    // What a dimension SOURCE covers, how far it disagrees with delivery and how old its
    // rows are — `dimSourceCoverageNote`'s own three statements, joined. It is the sentence
    // the Breakdown panel prints and the legacy custom tiles already carry; without it a
    // device table totals a fraction of the delivery KPI beside it with nothing on the tile
    // to say so. `null` on every other grain: a namebuilder dimension IS the delivery.
    note: sources && rowType === 'dim' ? dimSourceCoverageNote(rows.key, range, sources) : null,
    // …and what the EMPTY view says instead of its generic sentence: the pacing does not
    // carry this dimension at all, or — where it does — the legacy panel's own words for a
    // cut with nothing in it, which the ring one view over prints too.
    emptyNote: rowType === 'dim' && !modelRows.length
      ? (noDimReason(rows.key, sources, range) || NO_BREAKDOWN_ROWS) : null,
    colErrors,
    sort,
    limit: view && typeof view.limit === 'number' ? view.limit : null,
    // The viewer's own box over the row labels — the legacy panel's «Filter segments…».
    // Renderer state and nothing else: it narrows what is drawn, never what was computed.
    search: !!(view && view.search),
    // ONE plan for the whole second pass (§2.4). The window half is every slot that reads
    // over the window — a column target, a guide, a KPI — on any grain. The row half exists
    // only where a row HAS a plan of its own, and on every other grain a row reads the
    // window's, which is what `byKey: null` says to `cmRowPlanOf`. Every member that carries
    // a plan is a `{ scalars, unplanned }` pair, `window` included, so one reader serves all
    // five: `.scalars` for the numbers, `.unplanned` for §2.4's second gate.
    ...(viewHoldsCm(view, spec) ? {
      cmPlan: {
        window: cmWindowPlan,
        // The plan half of the cut's own field set, because that is what `cmPlan.fieldSet`
        // means on every other grain — the gate refuses a delivery name on a date row and may
        // not admit it on a dimension one.
        fieldSet: rowPlans ? cmPlanFieldsOf(rowPlans.fieldSet) : cmFieldSet,
        byKey: rowPlans ? rowPlans.byKey : null,
        absent: rowPlans ? rowPlans.absent : ABSENT_ROW_PLAN,
        totals: rowPlans ? rowPlans.totals : cmWindowPlan,
        subset: rowPlans ? rowPlans.subset : () => cmWindowPlan,
      },
    } : null),
    cmPending,
  };
}

/* ── the KPI view's model (§5.3) ──────────────────────────────────────────── */

/** What a bound element that has lost its switch says, in the words the chart and the table
 *  already use. Unreachable on a stored spec — the grammar keeps a metric switch alive for
 *  as long as anything follows it — and it still answers rather than taking the tile down. */
const NO_SWITCH = 'this KPI follows a metric switch the widget no longer has';

/**
 * The line items a KPI cell is read over, or `null` when this campaign has no such reading
 * (§5.3's `basis`; section-widget parity 2026-09-04).
 *
 * The question is asked of the CAMPAIGN's own facts — `sources.campaignLiDaily`, which a
 * Scope chip has already re-planned and a Lens chip has not touched. That is the tier the
 * filter bar promises and the legacy band keeps: a Lens chip is breakdown-only, so a cell
 * about the campaign must not change when one is pressed.
 */
function basisLinesFor(view, sources) {
  if (!view || !view.basis || !sources) return null;
  return kpiBasisLines(view.basis, {
    effLIs: sources.effLIs,
    liPlan: sources.liPlan,
    liDaily: sources.campaignLiDaily || sources.liDaily,
  });
}

/**
 * viewShown(view, data) → is this view drawn at all?
 *
 * A KPI with a `basis` is drawn while the basis names line items (the legacy band's rule); a
 * TABLE with `basis: 'conversions'` is drawn while the conversions mart carries a row for a
 * line item on this pacing (the legacy Breakdown panel's own tab, sections cutover
 * 2026-09-07). Everything else is drawn always — every view stored before either key existed.
 *
 * Asked by the TILE before it groups the views into rows, so a dropped view leaves no gap.
 */
export function viewShown(view, data) {
  if (!view) return true;
  const sources = (data && data.sources) || null;
  // With nothing loaded there is nothing to hide: the tile draws no views until `data`
  // arrives, and a preview surface with no store must not silently lose half a widget.
  if (!sources) return true;
  if (view.kind === 'kpi') return !view.basis || basisLinesFor(view, sources) !== null;
  if (view.kind === 'table' && view.basis === 'conversions') return hasConversionRows(sources);
  return true;
}
/** The name the KPI half has carried since section-widget parity; the same function. */
export const kpiViewShown = viewShown;

/** The whole pacing's line items, not the effective set: the mart's presence is a fact about
 *  the pacing (the mint-time rule read `liPlan` keys), and a filter must not blank the table. */
function hasConversionRows(sources) {
  const rows = sources.conversions;
  if (!Array.isArray(rows) || !rows.length) return false;
  const ids = new Set(Object.keys(sources.rawLiPlan || sources.liPlan || {}));
  return ids.size > 0 && rows.some((r) => r && ids.has(String(r.line_item_id)));
}

/**
 * The sources a basis-bearing cell reads: the campaign's facts, narrowed to the basis's own
 * line items. Anything else on `sources` travels untouched.
 *
 * Built from property DESCRIPTORS rather than a spread, and that is not a style choice: a
 * spread READS every own property, and `sources.liSplitDaily` is a getter over the store's
 * lazily-built per-dimension aggregate (widget-data.js:415 tells the same story). Copying it
 * as a descriptor keeps it lazy, so a KPI cell never materializes a dimension aggregate it
 * has no use for.
 */
function basisSources(sources, lines) {
  const campaign = sources.campaignLiDaily || sources.liDaily;
  // The common case by far: no Lens chip on, and a basis that names the whole set. Nothing
  // to re-base, so the tile reads exactly what every other view reads.
  if (campaign === sources.liDaily && lines === sources.effLIs) return sources;
  const scoped = Object.defineProperties({}, {
    ...Object.getOwnPropertyDescriptors(sources),
    liDaily: { value: campaign, enumerable: true },
    effLIs: { value: lines, enumerable: true },
  });
  return Object.isFrozen(sources) ? Object.freeze(scoped) : scoped;
}

/**
 * The corridor's verdict on one pair of numbers: `g` / `w` / `b` / `n`, or null where no
 * corridor was authored. `shared/kpi-band.js` decides all four — this only asks.
 *
 * `target.value > 0` is the legacy band's own guard (KpiPlanFact.jsx:84): against a target of
 * zero the ratio is not a number, and the sign is the only honest reading left, which is what
 * `good` already says.
 */
function bandStatusOf(value, target, band) {
  if (!band || value == null || !target || target.value == null || !(target.value > 0)) return null;
  return kpiBandStatus(value / target.value, band.low, band.high);
}

/**
 * buildReportKpiModel(view, spec, controlState, data, campCtx) → everything ReportKpi
 * draws, and nothing about how it looks:
 *
 *   { value, format, target: {value, invert}|null, delta, good, band, status, targetAbsent,
 *     warned, fullFlight, bound, error, targetError, cm, cmPending, deltaVsOtherSource }
 *
 * `data` is `useWidgetData(widget, rangeOverride)`'s answer — `{range, sources}` — so the
 * widget's scope and its period are ALREADY applied.
 *
 * The value and the target are both `aggReading`'s, which is the same reader a chart guide
 * uses: one number over the widget's window, through the legacy engine (P2 decision 3), or
 * the widget-scoped campaign constant for a canonical value.
 *
 * What this model decides:
 *   · **`fullFlight` is a fact about the VALUE, not about the reading.** A canonical value
 *     is campaign-level and window-INELIGIBLE (§2/§6): the Period switch does not recompute
 *     it, and the tile's «full flight» tag is how the viewer is told so. It stays true when
 *     the campaign carries no such goal, because what the tag explains is unchanged.
 *   · **A target that cannot be read is NO target.** An absent canonical goal and an
 *     expression the engine refuses both leave `target: null` — a delta chip against a zero
 *     nobody set is a reading of a target that does not exist. A CM-fed target keeps its
 *     slot with a null value and its `cm: {metric, side}` marker, the guide's contract on
 *     this slot. A REFUSED one also fills `targetError` — one line the tile prints, so the
 *     author of a chip that is not there can see what happened to it. An absent goal fills
 *     nothing: the question does not apply, which is not the same as going wrong.
 *   · **`good` follows the canonical target rule** — `invert` says lower is better, so the
 *     same delta reads good on a volume KPI and bad on a cost-like one, and a KPI exactly on
 *     its target is good either way (`>=` against `<=`). With no delta there is nothing to
 *     read and `good` is null rather than a default that colours an absent chip.
 *   · **`status` is the same verdict with an amber in it** (section-widget parity), and only
 *     where the author named a corridor: `shared/kpi-band.js` reads the pacing's own highlight
 *     bounds, so a CTR far ABOVE its target is a data problem rather than a win, and a VCR a
 *     hair under target is amber rather than red. Absent, the tile colours by the sign, which
 *     is what every v2 KPI stored before this key does.
 *   · **`basis` narrows what is read, and `kpiViewShown` decides whether it is read at all.**
 *     A cell about the campaign is read on the campaign's facts: a Lens breakdown chip is
 *     breakdown-only in the filter bar's own tiers, so it must not move a campaign KPI while
 *     leaving that KPI's target where it was.
 *   · **A CM-fed value waits for the adapter, it is not dropped** — null value, no error,
 *     `cm: {metric, side}` and `cmPending`, the same typed slot the chart and the table hold
 *     open. `deltaVsOtherSource` is the second one: `{pendingCm: true, metric}` until
 *     `attachCmData` replaces it with `{cmValue, deltaPct}`.
 *   · **One `warned` covers BOTH halves**, folded exactly as the engine folds it when it is
 *     handed a target itself (widget-data.js:1133). The two readings are separate calls here
 *     only because a canonical or CM-fed half cannot go to the engine at all — the badge is
 *     still one statement about the pair of numbers the tile prints.
 *
 * `format` is the stored one, verbatim: §5.3 forbids `auto` on a KPI, so there is nothing to
 * resolve and the canonical metric's own format has no reader here (the table cell is the
 * one slot where it does).
 */
export function buildReportKpiModel(view, spec, controlState, data, campCtx) {
  const datasetType = (spec && spec.dataset && spec.dataset.type) || 'delivery';
  const given = (data && data.sources) || null;
  const range = (data && data.range) || null;
  // A cell that names a basis is read over that basis's lines, on the campaign's own facts.
  // `kpiViewShown` has already answered whether it is drawn, so a null here is the tile
  // drawing a cell it decided to keep — read it over everything, exactly as a cell with no
  // basis is read.
  const lines = basisLinesFor(view, given);
  const sources = given && lines ? basisSources(given, lines) : given;

  const resolved = resolveValue(view && view.value, spec, controlState);
  const read = aggReading(resolved, datasetType, range, sources, campCtx);
  let cmPending = !!read.cm;
  let error = read.error;
  if (!resolved) error = NO_SWITCH;

  let target = null;
  let targetWarned = false;
  let targetError = null;
  if (view && view.target) {
    // A window target (the CTR's) follows the window when the KPI's own value does; beside a
    // canonical, full-flight value it stays the flight's (aggReading `overWindow`).
    const tRead = aggReading(
      resolveValue(view.target.value, spec, controlState),
      datasetType, range, sources, campCtx, !!resolved && resolved.kind !== 'canonical',
    );
    const invert = !!view.target.invert;
    // BOTH halves raise the one flag, exactly as the engine does when it is handed a target
    // itself (widget-data.js:1133, `out.warned = out.warned || t.warned`). The badge is a
    // statement about the CHIP, and the chip is a reading of two numbers: a target whose
    // inputs were empty and read as 0 draws a green «+N vs 0» that nothing on the tile
    // qualifies unless this flag carries it. It needs no "did it evaluate?" guard, because
    // the legacy fold's own guard (`if (tv.ok)`) lives in aggReading's refusal arm instead —
    // that arm reports a refusal, and a refusal is not a warning.
    targetWarned = !!tRead.warned;
    if (tRead.cm) {
      cmPending = true;
      target = { value: null, invert, cm: tRead.cm };
    } else if (tRead.value != null) {
      target = { value: tRead.value, invert };
    }
    // A target the engine refused is not a broken KPI — `error` is the VALUE's slot, and a
    // tile that reported one as the other would hide a number it has. It is not SILENT
    // either (P2 handoff §5.4, the owner's first item): the chip an author asked for is
    // missing and nothing else on the tile says why. The prefix is part of the sentence
    // because the reason alone reads exactly like the value's own refusal printed under it.
    if (tRead.error) targetError = `Target unavailable: ${tRead.error}`;
  }

  const delta = read.value != null && target && target.value != null
    ? read.value - target.value : null;

  // The alert CORRIDOR (§5.3's `target.band`; section-widget parity 2026-09-04). Its bounds
  // are read ONCE here, off the pacing's own `notify` config, and travel on the model — so
  // `kpiWithCm` can re-read the status on numbers that arrive later without knowing what a
  // corridor is, exactly as it re-reads `good`.
  const band = view && view.target && view.target.band
    ? bandFromNotify(sources && sources.notify, view.target.band) : null;

  // The support line reads the SAME field the KPI does, on both sides — the grammar makes
  // the value the dual-source form whenever this is on (§5.3), so the metric is the value's
  // own and there is nothing else it could be comparing. It counts as a CM slot in its own
  // right: without that, a widget whose value somehow read cleanly would leave this line
  // waiting forever, because `attachCmData` never opens a model that says it is complete.
  const dvos = view && view.deltaVsOtherSource && resolved && typeof resolved.metric === 'string'
    ? { pendingCm: true, metric: resolved.metric } : null;
  if (dvos) cmPending = true;

  let support = null;
  if (view && view.support && view.support.kind === 'text') support = view.support.text || null;
  else if (view && view.support && view.support.kind === 'valueMeta'
    && resolved && resolved.kind === 'canonical') {
    support = canonicalValue(resolved, campCtx).support;
  }

  // §2.4, in the same shape as the other two models'. Every slot on a KPI is a WINDOW reading —
  // the value, the target and the support line are all the comparison's totals — so its plan is
  // the window's, its vocabulary the whole of it, and its `unplanned` false by construction.
  // `campaignWindowScalars` is the ONE door to those scalars (Task 31), on this cell's OWN
  // basis-scoped sources; the campaign context is cached per (snapshot, window) and `kpiValue`
  // has already forced it for this very window, so the reading costs nothing new.
  const cmWindowPlan = { scalars: campaignWindowScalars(range, sources), unplanned: false };
  const cmFieldSet = FIELDS_PLAN;

  return {
    value: read.value,
    // Verbatim, like a table column's. A stored KPI always carries one (§5.3 makes it
    // required and forbids `auto`), and the unreachable branch hands fmtV2 nothing rather
    // than a guess: its default prints a number as a number, where a guessed `int` would
    // print money in the wrong shape. The one exception is a plan count (wholePlanFormat).
    format: (view && view.format) ? wholePlanFormat(view.format, resolved, datasetType) : null,
    target,
    delta,
    good: delta == null ? null : (target.invert ? delta <= 0 : delta >= 0),
    // Green / amber / red / muted where a corridor was authored, and null where none was —
    // the tile then colours by the sign, which is what every v2 KPI has always done.
    band,
    status: bandStatusOf(read.value, target, band),
    // The author asked for a target and this campaign has none — which is a fact worth one
    // muted line, where the legacy band prints its own «vs —». It is NOT a refusal (that is
    // `targetError`) and not a CM360 slot waiting to be filled (that keeps its `target`),
    // and it says nothing at all about a cell whose author never asked for a target.
    targetAbsent: !!(view && view.target) && target == null && !targetError,
    warned: !!read.warned || targetWarned,
    fullFlight: !!(resolved && resolved.kind === 'canonical'),
    bound: !!(resolved && resolved.bound),
    error: error || null,
    targetError,
    cm: read.cm,
    // §2.4, as sparse here as on the other two models, and through the same one predicate.
    ...(viewHoldsCm(view, spec) ? { cmPlan: { window: cmWindowPlan, fieldSet: cmFieldSet } } : null),
    cmPending,
    deltaVsOtherSource: dvos,
    support,
  };
}

/* ── the pie view's model (§5.4) ──────────────────────────────────────────── */

/** §5.4's own refusal, in a sentence a viewer can act on. A canonical value is ONE number
 *  for the whole flight (§2), so repeating it once per bucket would draw N equal slices
 *  whose shares are invented — the model draws none and says why. */
const PIE_NO_CANONICAL = 'this value is one number for the whole flight, so it has no slices';

/* §5.4's other refusal, and the reason `attachCmData` never opens a pie: the CM360 side is
 * grouped by the MAPPING's dimensions and a pie is cut by one of the PACING's, so there is no
 * cut to make. The sentence itself now lives in `widget-formula.js` (imported at the top),
 * because since 2026-09-16 the SAVE GATE says it too — a pie highlight is refused with it
 * before the tile ever gets a chance to. The alternative it exists against is unchanged: the
 * pie's generic empty state, «No data for selected filters», is a wrong diagnosis, and a
 * reader who acts on that headline goes looking in the wrong place. */

/**
 * buildReportPieModel(view, spec, controlState, data, campCtx) → everything ReportPie
 * draws, and nothing about how it looks:
 *
 *   { slices: [{label, value, others?}], format, total, bound, errors, cmPending }
 *
 * `data` is `useWidgetData(widget, rangeOverride)`'s answer — `{range, sources}` — so the
 * widget's scope and its period are ALREADY applied.
 *
 * The cut is `buildCategoryModel`'s (P2 decision 3), asked for on `sliceBy.key` with the
 * one resolved value. That is where §5.4's whole shape comes from and none of it is
 * restated here: the ranking is the engine's own (descending on the only series it was
 * given), `limit` — the engine's name for what the view spells `topN` — FOLDS the tail into
 * an `Others` bucket rather than truncating it, and that fold rides the P0-corrected basis,
 * so a pie and a bar chart of the same value on the same dimension cannot disagree about
 * what «Others» contains.
 *
 * Three things have no slices at all, each for its own reason, and none of them draws a
 * ring of zeroes:
 *   · a CM-fed value — the ONE such slot `attachCmData` does not fill, so this one answers
 *     here (PIE_NO_CM) instead of flagging a wait that would never end.
 *     Stated rather than left to be rediscovered: the slices of a pie are cut by
 *     `sliceBy.key`, which is one of the PACING's own dimensions, and the CM360 side is
 *     classified only by the MAPPING's dimensions. The other two grains have a delivery-side
 *     row to hang a CM number on (a date, a dimension bucket the breakdown also carries);
 *     a pie's buckets come from the same call that computes its values, so a cm value has
 *     neither. Filling it from the breakdown's tuples instead would silently draw a
 *     different cut than the author asked for. The grammar lets a cm value onto a pie today
 *     — narrowing that is a P3 decision, recorded in the T9 report, not taken here;
 *   · a canonical value — campaign-level, so there is no total to cut (the note above);
 *   · an expression the engine refused — its own sentence in `errors`. The engine answers
 *     with zeros for a column it could not compile, and a ring of zero-width arcs is a
 *     measured statement about a cut that measured nothing.
 *
 * `errors` is keyed by the VIEW id, which is this view's one element — the chart keys by
 * series id and the table by column id, on the same rule. A view id is a NodeId and
 * `constructor` is a legal one, so every read of this map is by own-key.
 */
export function buildReportPieModel(view, spec, controlState, data, campCtx) {
  const datasetType = (spec && spec.dataset && spec.dataset.type) || 'delivery';
  const sources = (data && data.sources) || null;
  const range = (data && data.range) || null;
  const id = view && typeof view.id === 'string' ? view.id : 'v';
  const errors = {};

  const resolved = resolveValue(view && view.value, spec, controlState);
  // The cut the viewer is looking at (M4): a stored key, or the dimension their switch is on.
  const sliceKey = resolveGrain(sliceGrain(view), spec, controlState).key || null;
  const out = {
    slices: [],
    format: (view && view.format) ? wholePlanFormat(view.format, resolved, datasetType) : null,   // on the KPI's rule above
    total: 0,
    // The product's word for the cut — the table's row header, in the pie's own slot. It is
    // on the model whether or not there are slices to draw: a pie that cut nothing still
    // has to say what it was cutting.
    sliceLabel: sliceKey ? dimensionLabel(sliceKey, sources) : null,
    // The dimension source's coverage line, exactly as the table carries it.
    note: sources ? dimSourceCoverageNote(sliceKey, range, sources) : null,
    // …and the table's other sentence: why an empty ring is empty. The pacing carrying no
    // such dimension where that is the reason, and otherwise the legacy panel's own words for
    // a cut with nothing in it — the same sentence the table one view over prints, because it
    // is one fact and two spellings of it read as two problems. Filled unconditionally here
    // (a pie is always cut by a dimension) and read by the renderer only when there are no
    // slices.
    emptyNote: noDimReason(sliceKey, sources, range) || NO_BREAKDOWN_ROWS,
    bound: !!(resolved && resolved.bound),
    errors,
    cmPending: false,
  };
  if (!resolved) {
    errors[id] = 'this pie follows a metric switch the widget no longer has';
    return out;
  }
  if (resolved.kind === 'canonical') {
    errors[id] = PIE_NO_CANONICAL;
    return out;
  }
  // §3.6: a metric this pacing's data does not carry. The ring is empty and says why, in the
  // shape the two refusals above answer in. The cut is the grain: a `ds:` slice reads its own
  // source's metric list, because that is the file the slices are cut from.
  const why = unavailableMetric(resolved, sources, sliceKey);
  if (why) { errors[id] = why; return out; }
  const expr = valueToExpr(resolved, datasetType);
  if (expr == null) {
    // `cmPending` stays FALSE here, unlike every other CM slot: pending means "waiting for
    // the adapter", and nothing is coming. The pie answers now, in the same shape the
    // canonical refusal above answers in — no slices and a sentence saying why.
    if (cmFeedOf(resolved, datasetType)) errors[id] = PIE_NO_CM;
    return out;
  }
  if (!sources) return out;

  const request = {
    expressions: [{ id, label: autoLabel(resolved, controlState), expr }],
    identities: !!view.highlights?.length,
    grain: { type: 'dim', key: sliceKey },
    limit: typeof view.topN === 'number' ? view.topN : null,
    // The untagged remainder, as its own slice after the fold. It is what puts the ring's
    // shares back on the pacing's delivery: without it a value covering 11% of the clicks
    // draws 59% of the circle.
    residual: !!view.residual,
  };
  const got = buildCategoryModel(request, range, sources);
  if (hasOwn(got.errors, id)) { errors[id] = got.errors[id]; return out; }

  let total = 0;
  out.slices = got.categories.map((c) => {
    const value = c.values[0] ?? null;
    if (Number.isFinite(value)) total += value;
    const slice = { label: c.label, value, ...(c.highlightKey ? { highlightKey: c.highlightKey } : null) };
    // Three marks, never two on one slice: `others` is the tail of the ranking folded
    // together, `residual` is delivery this dimension did not tag, and `leftover` is a bucket
    // the cut could not name («Unclassified», «No value»). All three are drawn grey and none
    // is clickable; they are told apart because they are different quantities and the ring has
    // to be able to say which is which.
    if (c.others) slice.others = true;
    if (c.residual) slice.residual = true;
    if (c.leftover) slice.leftover = true;
    return slice;
  });
  out.total = total;
  return out;
}

/* ── the CM360 half of a delivery view (§5.2/§5.3/§8.3) ───────────────────── */

/* The two joins that exist, said once, where a third grain asks for a third one. T8 proved it
 * against the kernels AND against the fetch SQL: no layer between BigQuery and the panel ever
 * holds a line item on the CM360 side. The grammar already refuses a Δ% here; a cm VALUE
 * column is still legal on those grains, and this is the sentence it gets. It lives in
 * `widget-formula.js` now (imported at the top): the draft gate refuses a cm-bearing formula
 * on a `li` table with these exact characters, and the tile prints them for a stored one. */

/**
 * §5.2's own zero rule, and the ONE exception to this path's division-by-zero canon: a Δ%
 * against no delivery is not −100% and not 0, it is nothing to say. `shared/mapping-dims.js`
 * ratio() answers the same way for the tuple join (`d ? (cm − d) / d : null`), which is why
 * a dim row may take the kernel's own delta instead of recomputing it — one rule, two
 * readers, pinned against each other in the suite.
 */
function deltaRatio(cm360, delivery) {
  if (!Number.isFinite(cm360) || !Number.isFinite(delivery) || delivery === 0) return null;
  return (cm360 - delivery) / delivery;
}

/* What ONE cm-fed slot reads off a joined pair is `cmValueAt`, and it now lives in
 * `cm-formula-context.js` (imported at the top): `cmEvalAt`'s metric arm IS that function,
 * and one finiteness rule cannot be written in two files. The Δ% it answers arrives as a
 * RATIO from both joins and leaves as a PERCENT, because that is the unit every
 * percent-family value in this system carries — a ctr of 0.5 means 0.5%, and the cell prints
 * through the same `fmtV2` as every other cell (a stored `percent` format ×100s nothing, and
 * `pp` reads percentage points). CompareTable does the same multiplication at render time. */

const finite = (v) => (Number.isFinite(v) ? v : 0);

/**
 * The PLAN half of a grain's own field set — which is what `cmPlan.fieldSet` has meant since
 * Stage 2, and what §2.4's first gate judges a name against through `cmFieldRefusal`.
 *
 * The intersection, because the two halves answer different questions. `FIELDS_PLAN` says what
 * a plan field IS; the grain's field set says which of them this cut can declare. So `planImpr`
 * is legal on a namebuilder cut that declared nothing (the runtime stays permissive there, doc
 * 2026-09-12 §7 — the unplanned gate turns it into a dash) and refused on a `ds:` cut, where no
 * container can name it; and the cut's DELIVERY half never rides in, or `cmIm / sp` would pass
 * on a dimension row and be refused on a date one, over the one comparison that holds no spend.
 */
const cmPlanFieldsOf = (fieldSet) => (fieldSet
  ? new Set([...fieldSet].filter((name) => FIELDS_PLAN.has(name)))
  : new Set());

/**
 * §2.4's SECOND gate, per row: the twin of the engine's own `unplanned && planCols.has(c.id)
 * ? null` one file over (widget-data.js). A row that declared nothing has no target to pace
 * against, and inside arithmetic an absent value is 0 — so without this the cm half of a
 * dimension table printed a confident 0% beside the em dash the plan column prints for the
 * same row. A DECLARED row whose own target is unset still reads 0 (the 2026-09-12 canon).
 */
const cmPlanBlocked = (marker, plan) => !!(marker && marker.kind === 'formula'
  && marker.planFields.length && plan && plan.unplanned);

/** A refused column is not a plan column: its cells carry an error, and the «Plan» mark over
 *  them would explain the wrong thing (§2.4). §2.4's first gate runs one pass after the map is
 *  built, so this is where a column that named something this cut cannot declare leaves it.
 *
 *  Nothing is published unless the gate actually refused one of THIS table's cm columns, so a
 *  table whose every column was answered keeps the map it already had, by identity. Null
 *  prototype in, null prototype out — a column id is a NodeId, and `constructor` is a legal
 *  one, which is why the renderer reads this map through hasOwnProperty. */
function planColumnsOut(model, colErrors) {
  if (!model.planColumns) return null;
  const refused = model.columns.filter((c) => c.cm && hasOwn(colErrors, c.id));
  if (!refused.length) return null;
  const out = Object.create(null);
  for (const id of Object.keys(model.planColumns)) {
    if (!hasOwn(colErrors, id)) out[id] = true;
  }
  return { planColumns: out };
}

/**
 * The plan ONE row reads (§2.4): a dimension row its own, every other row the window's. It
 * is never recomputed — `byKey` holds the objects the engine's plan cells were computed
 * from — and it never answers null, so the evaluator always has scalars to read through. A
 * model with no cm-bearing expression carries no `cmPlan` and reads the absent plan, which
 * only a plan-naming formula would ever notice.
 *
 * Every member of `cmPlan` that carries a plan has the ONE shape `{ scalars, unplanned }`,
 * `window` included — so this answers a pair whichever branch it takes, its caller reads
 * `.scalars` for the numbers, and `cmPlanBlocked` reads `.unplanned` for the gate. A window's
 * plan is the campaign's and is never undeclared, which is what its `unplanned: false` says.
 */
function cmRowPlanOf(model, key) {
  const p = model.cmPlan;
  if (!p) return ABSENT_ROW_PLAN;
  if (!p.byKey) return p.window;
  return p.byKey.get(key) || p.absent;
}

/** The plan vocabulary a grain with no published row plan carries: none. A dimension row's
 *  plan is the ROW's own (§2.4 — a row's plan is never recomputed, or a cm formula and the
 *  plan column beside it disagree), so a model that does not publish one refuses the field
 *  instead of answering it with the campaign's window number. */
const CM_NO_PLAN_FIELDS = new Set();

/**
 * viewHoldsCm(view, spec) → does this VIEW hold a cm-bearing formula, in a value slot (stored
 * outright or reachable through the metric switch) OR in a highlight rule (§2.8, Stage 6)?
 *
 * The ONE named predicate `cmPlan` is published through, on all three models (§2.4). The three
 * builders ask one question in one spelling instead of each re-deriving it from whichever
 * markers its own slots happen to carry — and Stage 6 widens it in ONE place (it ORs
 * `anyCmHighlight(view)` in here), leaving every call site below untouched.
 *
 * A cm METRIC is not a holder: it reads no plan and asks for none, so a block published for it
 * would be a key on a model nothing ever opens. The tell is `cmMarkerOf`, the very mint every
 * slot's marker comes from (memoised by expression, so this walk costs one regex per distinct
 * formula) — which is what makes «a model carrying a formula marker has a plan beside it» true
 * by construction rather than by two lists agreeing.
 *
 * A `bound` slot carries no expression of its own: what it reads is whichever option the metric
 * switch is on (`resolveValue`, off `metricControl(spec)` — the same control, read the same
 * way). So it counts as cm-bearing when ANY option of that switch is a cm-bearing formula, not
 * merely the one currently picked: the viewer moves the switch without the plan being rebuilt,
 * and §2.5 judges an option by every element bound to it. With no `spec` there is nothing to
 * resolve against, and a bound slot answers false.
 *
 * Tolerant, like every other reader of a stored view: a half-built draft, a slot whose shape is
 * not there yet, and `null` all answer false rather than throw.
 */
export function viewHoldsCm(view, spec = null) {
  // A highlight owns no value slot, so the walk below cannot see it (§2.8) — and a rule
  // reading `cmIm / planImpr` on an ordinary BQ column still needs the plan half published on
  // the model, or `report-highlights.js` reads no plan at all and the rule goes quiet.
  //
  // It is a VOCABULARY question, not a legality one: whether the slot may carry the
  // expression is `validate`'s answer, given at draft time.
  if (anyCmHighlight(view)) return true;
  if (!view || typeof view !== 'object') return false;
  // Asked once per view rather than per slot: every bound slot of a view follows the SAME
  // switch, so the answer cannot differ between them.
  const ctl = metricControl(spec);
  const switchHoldsCm = !!ctl && (Array.isArray(ctl.options) ? ctl.options : []).some(
    (o) => o && o.value && typeof o.value === 'object' && o.value.kind === 'formula'
      && typeof o.value.expr === 'string' && cmMarkerOf(o.value.expr));
  const holds = (value) => {
    if (!value || typeof value !== 'object') return false;
    if (value.kind === 'bound') return switchHoldsCm;
    return value.kind === 'formula' && typeof value.expr === 'string' && !!cmMarkerOf(value.expr);
  };
  if (view.kind === 'chart') {
    const series = Array.isArray(view.series) ? view.series : [];
    // A calc series holds no value at all, so it is skipped rather than read for one.
    return series.some((s) => s && s.kind !== 'calc'
      && (holds(s.value) || !!(s.guide && holds(s.guide.value))));
  }
  if (view.kind === 'table') {
    // The share is a value slot of the table's own (§5.2), read by Stage 4 — and the plan it
    // stands on is the same window plan the columns beside it read.
    if (view.share && holds(view.share.value)) return true;
    const columns = Array.isArray(view.columns) ? view.columns : [];
    return columns.some((c) => c && (holds(c.value) || !!(c.target && holds(c.target.value))));
  }
  if (view.kind === 'kpi') return holds(view.value) || !!(view.target && holds(view.target.value));
  return false;
}

/**
 * The reader `attachCmData` joins through: the §8.5 projection, indexed by the two grains a
 * CM360⇄delivery join exists on, for whichever metric an element asks about.
 *
 * `projection.asked` is the seam's own echo of the three viewer inputs it was built with, and
 * all three are load-bearing:
 *   · `metric` says what `projection.chartDaily` is a series OF, so an element on that metric
 *     reads the seam's own array and nothing is recomputed;
 *   · a FIXED element on another metric (the switch is on impressions, the column asks for
 *     completions) needs its own daily series, built by the SAME kernel with the projection's
 *     own dims, focus and window — the overlap-only and focused semantics of §8.3 ride those
 *     three and are never re-derived here.
 *
 * It is read off the PROJECTION rather than taken as an argument, and that is a correctness
 * property, not tidiness: a separately-passed `{metric, …}` can disagree with the projection
 * beside it, and the failure is silent and plausible — the clicks series drawn under an
 * impressions header, a full-flight total under a one-week window. One object carries its own
 * question with its answer, so the two cannot desync. `attachCmData` refuses a projection
 * without the echo rather than guessing defaults for it.
 *
 * The tuple join needs no metric at all: `pivot.rows` carry all three fields and the kernel's
 * own delta for each.
 */
export function buildCmReader(dataset, projection) {
  // Loud, and unreachable through `projectCm360Comparison` — which is the point. A projection
  // with no echo is not a projection, and the alternative to throwing is to invent defaults
  // (impressions, no focus, the whole flight) and print the wrong numbers under the right
  // headers. Data can never reach this line; only a wrong caller can. It sits HERE rather
  // than in `attachCmData` because three passes build readers now (the value pass, the
  // highlight pass, the Layout context), and a guard on one door leaves two open.
  if (!projection || !projection.asked) {
    throw new TypeError('buildCmReader: the projection carries no `asked`; pass projectCm360Comparison\'s own result');
  }
  const want = projection.asked;
  const classified = dataset.classified || {};
  const dailyCache = new Map();
  const dateCache = new Map();

  const dailyFor = (metric) => {
    if (dailyCache.has(metric)) return dailyCache.get(metric);
    const out = want.metric === metric && Array.isArray(projection.chartDaily)
      ? projection.chartDaily
      : buildComparisonDaily({
        deliveryDaily: dataset.deliveryDaily || [],
        deliveryCells: classified.deliveryCells || {},
        cm360Daily: dataset.cm360Daily || [],
        cm360Cells: classified.cm360Cells || {},
        dims: projection.selectedDims || [],
        membership: projection.membership || new Map(),
        focusedKey: want.focusedKey,
        metric,
        range: want.range,
      });
    dailyCache.set(metric, out);
    return out;
  };

  const datesFor = (metric) => {
    if (dateCache.has(metric)) return dateCache.get(metric);
    const index = new Map();
    for (const d of dailyFor(metric)) {
      index.set(d.date, { delivery: d.delivery, cm360: d.cm360, delta: deltaRatio(d.cm360, d.delivery) });
    }
    dateCache.set(metric, index);
    return index;
  };

  // The tuple join, by the label the tuple PRINTS. A dimension row of a v2 table names one of
  // the PACING's dimensions and a pivot row names a tuple of the MAPPING's, and the two
  // vocabularies meet only in their values — so a row joins when the breakdown carries the
  // dimension it runs down (Channel classifies both sides; Market's values are the geo
  // column's strings). A wider breakdown prints «US · Video», which no single dimension row
  // carries, and those rows stay empty rather than being matched on a component nobody can
  // identify. `tupleLabel` is compare-project's own, so the label joined on here is the label
  // the compare view shows.
  const tuples = new Map();
  for (const r of (projection.pivot && projection.pivot.rows) || []) {
    tuples.set(tupleLabel(r.key), r);
  }

  return {
    atDate(metric, date) {
      const hit = datesFor(metric).get(String(date));
      return hit || null;
    },
    atLabel(metric, label) {
      const r = tuples.get(String(label));
      if (!r) return null;
      return { delivery: r.delivery[metric], cm360: r.cm360[metric], delta: r.delta[metric] };
    },
    totals(metric) {
      const days = dailyFor(metric);
      if (!days.length) return { delivery: null, cm360: null, delta: null };
      let delivery = 0;
      let cm360 = 0;
      for (const d of days) { delivery += finite(d.delivery); cm360 += finite(d.cm360); }
      return { delivery, cm360, delta: deltaRatio(cm360, delivery) };
    },
  };
}

/**
 * The ONE reader per projection × dataset (§2.2). The value pass, the highlight pass and the
 * Layout context all take this instance: two readers over one projection would build the
 * comparison series twice and, worse, could answer differently the day one of them was handed
 * a projection built a render earlier.
 *
 * A WeakMap on both keys, so a dataset or a projection that falls out of scope takes its
 * reader with it — these hold the whole comparison, per tile.
 */
const CM_READERS = new WeakMap();

export function cmReaderFor(dataset, projection) {
  if (!dataset || !projection) return null;
  let byProjection = CM_READERS.get(dataset);
  if (!byProjection) { byProjection = new WeakMap(); CM_READERS.set(dataset, byProjection); }
  let reader = byProjection.get(projection);
  if (!reader) { reader = buildCmReader(dataset, projection); byProjection.set(projection, reader); }
  return reader;
}

/**
 * cmRowJoin(model, row) → which join this ROW has, and on what key, or null (§2.2).
 *
 * The chart and the table asked the same question in two shapes, and a third caller (the
 * highlight pass, stage 6) was about to ask it in a fourth. Three rows answer null, each for
 * its own reason and all for the same one — there is nothing on the CM360 side to match:
 *   · `li` and `dateLi`, where no layer between BigQuery and the panel holds a line item;
 *   · the «Others» fold, which is a fold of the tail and not a dimension value, so no tuple
 *     names it;
 *   · the residual, which is the delivery this dimension did not tag.
 *
 * The chart carries its grain as `xType` and its key under `ROW_X`; the table carries
 * `rowType` and `key` (`tableRowKey`'s, built from the row's own date or bucket label, never
 * from the printed one). Both are read here so neither renderer has an opinion about it.
 *
 * WHICH of the two is decided by the GRAIN field, never by asking the row what properties it
 * has: `key` is a legal NodeId and therefore a legal series id, and `rowKeysFor` escapes only
 * `x`, `__others` and `__stack` — so a stored chart with a series named `key` carries that
 * series' number under `row.key`, and a sniff would join every date row on it.
 */
export function cmRowJoin(model, row) {
  if (!model || !row) return null;
  const grain = model.rowType || model.xType || 'date';
  if (grain !== 'date' && grain !== 'dim') return null;
  if (row[ROW_OTHERS] || row.residual) return null;
  const key = model.rowType ? row.key : row[ROW_X];
  if (key == null) return null;
  return { join: grain === 'date' ? 'date' : 'label', key: String(key) };
}

/** The `read(metric)` a per-row slot is evaluated through: one row's join, asked per metric.
 *  A row with no join answers null for every metric, which `cmEvalAt` turns into the dash. */
const cmRowRead = (cm, join) => (metric) => (
  join === null ? null
    : join.join === 'date' ? cm.atDate(metric, join.key) : cm.atLabel(metric, join.key)
);

/** The absence rule itself is `cm-formula-context.js`'s (Step 3): this file imports
 *  `brick-data.js`, and stage 7's bricks evaluate through `cmEvalAt`, so defining it here
 *  would close a cycle. Re-exported so every call site — and the Interface Contract — keeps
 *  reading it off `report-render.js`. */
export { cmEvalAt };

/**
 * The metrics ONE cm-fed slot reads, deduplicated and in first-seen order. A pair is a fact
 * about (metric, row), so `cmIm / im` reads impressions ONCE and takes both halves of the one
 * pair it got — and each reader below sums per metric, not per named side, or a two-sided
 * formula would count the same delivery twice.
 *
 * Two readers share this rule and must keep agreeing on it: `tableWithCm`'s Totals row here,
 * and `report-highlights.js`'s total-join reader (`sumsFor`). Both sum the row-join pairs by
 * metric before either half of a formula is evaluated.
 */
export function cmMetricsOf(marker) {
  if (!marker) return [];
  if (marker.kind !== 'formula') return [marker.metric];
  const out = [];
  for (const r of marker.reads) if (!out.includes(r.metric)) out.push(r.metric);
  return out;
}

/** The chart's half: a cm series takes the day's or the tuple's number, and a CM-fed guide
 *  takes the window total of the same comparison — one line, one number, on any X.
 *
 *  A cm METRIC series and a cm-bearing FORMULA beside it go through one evaluator and one
 *  absence rule (`cmEvalAt`, §2.2), so two lines on one axis cannot disagree about a day the
 *  join has no row for. */
function chartWithCm(model, cm) {
  const xType = model.xType || 'date';
  const fed = model.series.filter((s) => s.cm);
  const errors = { ...model.errors };
  const plan = model.cmPlan || null;
  let rows = model.rows;
  if (fed.length && xType === 'li') {
    for (const s of fed) errors[s.id] = NO_CM_JOIN;
  } else if (fed.length) {
    // §2.4's step 1, once per series and before any pair is read.
    for (const s of fed) {
      const bad = cmFieldRefusal(s.cm, plan ? plan.fieldSet : CM_NO_PLAN_FIELDS);
      if (bad) errors[s.id] = bad;
    }
    // A category carries its own plan now (§2.4, this stage), so there is no one answer for
    // the whole axis any more: the row loop reads its own through `cmRowPlanOf`, which hands a
    // date point the window's plan and a bar the object that bar was drawn from.
    rows = model.rows.map((r) => {
      const out = { ...r };
      // The row's ONE join, whatever the series asks for, and one absence rule for every
      // marker shape. The «Others» bucket is a fold of the tail, not a dimension value, so
      // there is no tuple it names and `cmRowJoin` answers null for it — nothing to read, on
      // every cm series at once.
      const read = cmRowRead(cm, cmRowJoin(model, r));
      // §2.4's second gate, one plan per category whatever the series ask for: the value's own
      // declared target on a dimension axis, the window's on a date one. `rowPlan`, not
      // `plan` — Stage 2 holds the whole block's `plan` at the top of this function.
      const rowPlan = cmRowPlanOf(model, String(r[ROW_X]));
      for (const s of fed) {
        out[s.key] = hasOwn(errors, s.id) || cmPlanBlocked(s.cm, rowPlan)
          ? null
          : cmEvalAt(s.cm, read, rowPlan.scalars);
      }
      return out;
    });
  }
  // The stack is summed over what is DRAWN, and on this path a segment that had no numbers
  // when the model was built has them now. A total left from the build would print one
  // bar's worth of label over a taller bar. (`rows` is only a fresh array where the join
  // happened; where it is still the model's own, nothing moved and nothing is written.)
  if (model.stackTotal && rows !== model.rows) fillStackTotal(rows, model.stackTotal.keys);
  const guides = model.guides.map((g) => {
    if (!g.cm) return g;
    // A guide is ONE number over the window, so its plan is the window's and its vocabulary
    // the whole of it, whatever the axis under it runs down. A refused expression leaves no
    // line and no sentence: the build drops an unreadable guide for the same reason, and the
    // draft gate refuses this one before it can be stored.
    const value = cmFieldRefusal(g.cm, FIELDS_PLAN) ? null
      : cmEvalAt(g.cm, (metric) => cm.totals(metric), plan ? plan.window.scalars : null);
    return { ...g, value };
  });
  return { ...model, rows, guides, errors, cmPending: false };
}

/** The table's half: every cm-fed column, on the grain its rows run down — and every cm-fed
 *  PLAN, on no grain at all.
 *
 *  The two are filled on different terms because they are different readings. A column is a
 *  number per row and needs a join; a plan is one number over the window, which is what
 *  `kpiWithCm` reads for a KPI's target — so it lands on every grain, including the two that
 *  have no join for the cells beside it. The «nothing, and a zero, leaves no line» rule is
 *  re-applied on the number that just arrived, exactly as `kpiWithCm` re-reads its chip.
 *
 *  Both readings go through `cmEvalAt`, so a cm METRIC column and a cm-bearing FORMULA beside
 *  it share ONE absence rule (§2.2). The pairs are read once per row per metric rather than
 *  once per column: a pair is a fact about (metric, row), and two columns asking about
 *  impressions are asking the same question. */
function tableWithCm(model, cm) {
  const rowType = model.rowType || 'date';
  const plan = model.cmPlan || null;
  // Every member of `cmPlan` is `{ scalars, unplanned }` (§2.4), `window` included: the numbers
  // a slot reads are `plan.window.scalars`, and a window is never «undeclared».
  const windowScalars = plan ? plan.window.scalars : null;
  const columns = model.columns.map((c) => {
    if (!c.target || !c.target.cm) return c;
    // A column's PLAN is one number over the WINDOW whatever the rows below it run down, so
    // its formula is judged against the window's own plan vocabulary (§2.4).
    const value = cmFieldRefusal(c.target.cm, FIELDS_PLAN) ? null
      : cmEvalAt(c.target.cm, (metric) => cm.totals(metric), windowScalars);
    const out = { ...c };
    if (c.target.cm.kind === 'formula') {
      // A formula target keeps its typed slot whatever the number is (a refusal or an unjoined
      // window leaves value null; the tile draws a plan line only for a number). The metric
      // arm below keeps its own «nothing, and a zero, leaves no line» rule byte for byte.
      out.target = { ...c.target, value };
    } else if (value) out.target = { value, format: c.target.format };
    else delete out.target;
    return out;
  });
  const fed = columns.filter((c) => c.cm);
  // `fed` alone is not the question any more (spec §2.6): a table whose ONLY CM360 element is
  // its ROW SHARE has no fed column to be told by, and returning here would leave every row
  // without a `share` for ever while the tile reported itself answered.
  if (!fed.length && !model.shareCm) return { ...model, columns, cmPending: false };
  const colErrors = { ...model.colErrors };
  const shareOut = () => (model.shareColumnId && hasOwn(colErrors, model.shareColumnId)
    ? { shareError: colErrors[model.shareColumnId] } : null);
  if (rowType !== 'date' && rowType !== 'dim') {
    for (const c of fed) colErrors[c.id] = NO_CM_JOIN;
    return { ...model, columns, colErrors, ...shareOut(),
      // A CM-fed share has exactly the two joins a CM-fed cell has, and a line item is
      // neither. It says so, for the reason the column beside it does: a table of blank
      // percentages with nothing on it to explain them is the one thing worse than a refusal.
      // It comes last, because a CM-fed share is never also a `shareColumnId` one.
      ...(model.shareCm ? { shareError: NO_CM_JOIN } : null),
      cmPending: false };
  }
  // §2.4's step 1, once per column and BEFORE any pair is read: a name this grain cannot carry
  // is the sentence the engine would have raised, said by its one owner.
  for (const c of fed) {
    const bad = cmFieldRefusal(c.cm, plan ? plan.fieldSet : CM_NO_PLAN_FIELDS);
    if (bad) colErrors[c.id] = bad;
  }
  // The ROW SHARE is judged on the same terms and at the same moment, before a single pair is
  // read: it names the plan half of this grain's vocabulary or it names nothing. It has no
  // column of its own to hang the sentence on, so it says it where every share refusal is
  // said — and no row takes a percentage, rather than every row taking a wrong one.
  const shareBad = model.shareCm
    ? cmFieldRefusal(model.shareCm, plan ? plan.fieldSet : CM_NO_PLAN_FIELDS) : null;
  const live = fed.filter((c) => !hasOwn(colErrors, c.id));
  // A dimension row's plan IS the row's now (§2.4, this stage), so there is no one answer for
  // the whole table any more: the row loop reads its own through `cmRowPlanOf`, which hands a
  // date row the window's plan and a dimension row the object the plan cell beside it printed.
  const metrics = [];
  for (const c of live) for (const m of cmMetricsOf(c.cm)) if (!metrics.includes(m)) metrics.push(m);
  // Each row's joined pairs, by the row's key: what the Totals row and `retotal` re-sum.
  const pairs = new Map();
  const rows = model.rows.map((r) => {
    const cells = { ...r.cells };
    const own = new Map();
    pairs.set(r.key, own);
    // The row's ONE join, whatever the column asks for: `cmRowJoin` reads the row's identity
    // rather than its printed label, and answers null for the rows that name no tuple at all.
    const join = cmRowJoin(model, r);
    for (const m of metrics) {
      own.set(m, !join ? null
        : join.join === 'date' ? cm.atDate(m, join.key) : cm.atLabel(m, join.key));
    }
    // §2.4's second gate reads ONE plan per row, whatever the row's fed columns ask for: a
    // dimension row its own declared target, a date row the window's. A row that declared
    // NOTHING has no target to pace against, and inside arithmetic an absent one is 0 — which
    // is the confident 0% this gate keeps out from under the em dash the plan column prints
    // for the same row.
    const rowPlan = cmRowPlanOf(model, r.key);
    for (const c of fed) {
      cells[c.id] = hasOwn(colErrors, c.id) || cmPlanBlocked(c.cm, rowPlan)
        ? null
        : cmEvalAt(c.cm, (m) => own.get(m), rowPlan.scalars);
    }
    return { ...r, cells };
  });

  // AGGREGATE, then compute (§2.2's `total` row) — the legacy totals rule, and the only honest
  // one for a ratio: the mean of the rows' percentages is not the percentage of their sums. A
  // row contributes to a column only where it joined for EVERY metric that column reads, and a
  // column not one row could be joined for has NO total, rather than a zero it never read.
  // …against the plan standing UNDER the rows it sums, which is the caller's to name: the
  // whole cut's for the Totals row, the kept rows' for a re-total. A window's plan on every
  // grain that has no row plan of its own, which is what `cmPlan.totals` and `cmPlan.subset`
  // answer there.
  const totalOver = (c, keys, planPair) => {
    // §2.4's second gate, over a summed cell instead of a row: a formula that names a plan
    // field where nothing under these rows was declared has no target to pace against, and
    // inside arithmetic an absent one is 0 — which would put the only number on a table of
    // dashes, and the wrong one. Before a single pair is read, because the sums cannot change
    // the answer.
    if (cmPlanBlocked(c.cm, planPair)) return null;
    const ms = cmMetricsOf(c.cm);
    const sums = new Map(ms.map((m) => [m, { delivery: 0, cm360: 0 }]));
    let n = 0;
    for (const key of keys) {
      const own = pairs.get(key);
      if (!own || ms.some((m) => !own.get(m))) continue;
      for (const m of ms) {
        const pair = own.get(m);
        const s = sums.get(m);
        s.delivery += finite(pair.delivery);
        s.cm360 += finite(pair.cm360);
      }
      n += 1;
    }
    if (n === 0) return null;
    return cmEvalAt(c.cm, (m) => {
      const s = sums.get(m);
      return { delivery: s.delivery, cm360: s.cm360, delta: deltaRatio(s.cm360, s.delivery) };
    }, planPair.scalars);
  };
  let totals = model.totals;
  if (totals) {
    // The plan standing UNDER the rows: the declared targets of the whole cut, weighted
    // together — never the campaign's, which would stand over rows that add up to less and
    // read as a shortfall nobody has. With nothing declared anywhere it is the absent plan,
    // whose `unplanned` §2.4's second gate reads before the sums are looked at.
    const totalsPlan = plan ? plan.totals : ABSENT_ROW_PLAN;
    totals = { ...totals };
    const keys = rows.map((r) => r.key);
    for (const c of fed) {
      totals[c.id] = hasOwn(colErrors, c.id) ? null : totalOver(c, keys, totalsPlan);
    }
  }
  // The subset total a search box asks for, on the same rule over the kept rows' pairs — the
  // engine's half arrives through the model's own `retotal`. The plan those rows stand on is
  // read ONCE for the whole pass, not once per column: it is one question, and two columns
  // asking it may not get two answers.
  const retotal = typeof model.retotal === 'function' ? (keys) => {
    const base = model.retotal(keys);
    // ONCE per call, shared by every fed column (§2.4): the kept rows' leaf plans re-weighted,
    // which is the one expensive thing on this path — and the very object the engine's own
    // re-total one line up stood on, because both fold the same key set and `rowScalars.subset`
    // answers once per key-set identity (`onceForKeys`, Task 45).
    const keptPlan = plan ? plan.subset(keys) : ABSENT_ROW_PLAN;
    for (const c of fed) {
      base[c.id] = hasOwn(colErrors, c.id) ? null : totalOver(c, keys, keptPlan);
    }
    return base;
  } : null;
  /**
   * One row's CM-fed share, read on the grain this table joins on (§2.6). `rows` above is
   * already this pass's own copy of the model's, and `assignRowShares` copies again, so the
   * model handed in is never written into.
   *
   * The pairs come through `cmRowJoin` — the ONE join rule a cm-fed CELL is read through one
   * loop up — rather than a second reading of the row's grain. So a residual «Others» row,
   * which names no tuple to ask CM360 about, answers null here exactly as its cells do, and
   * `assignRowShares` counts it as 0 in the denominator and gives it no share of its own.
   *
   * The plan half is read exactly as a fed COLUMN reads it (§2.4) and never recomputed: a
   * dimension row's own published plan, the window's everywhere else. EVERY plan-carrying
   * member of `cmPlan` has the one shape `{ scalars, unplanned }` — `window` included, with
   * `unplanned: false` — so what is read is always `.scalars` and never the member itself.
   * The unplanned gate is the twin of the plan column's `unplanned && planCols.has(c.id) ?
   * null`: a share naming a plan field on a row that declared nothing is null, while a
   * DECLARED row whose target is unset reads 0 inside the arithmetic. A share naming no plan
   * field never reaches either, which is why `cmPlan` may be absent here.
   *
   * Stage 3 Task 48 owns both readers this uses — `cmRowPlanOf(model, key)` (the row's own
   * published plan, `ABSENT_ROW_PLAN` where the row declared nothing) and `cmPlanBlocked` —
   * so the share reads the same published object the cells read, never a second copy.
   */
  const shareAt = (r) => {
    const own = cmRowPlanOf(model, r.key);
    if (cmPlanBlocked(model.shareCm, own)) return null;
    const join = cmRowJoin(model, r);
    return cmEvalAt(model.shareCm, cmRowRead(cm, join), own.scalars);
  };
  // `colErrors` now carries whatever the field-set gate found, and the share re-reads it: a
  // share column the gate refused says so where every other refusal is said.
  //
  // Three ways a row gets its percentage, and only the first is new. `withColumnShares` reads
  // a CELL, which a CM-fed share has none of — it is a value the table never draws as a
  // column — so it cannot serve this arm; `assignRowShares` owns the denominator for all
  // three, so a cm share and a delivery share can never divide differently. A share the
  // field-set gate refused divides nothing at all: the rows keep the shape they arrived in.
  const withShares = model.shareCm ? (shareBad ? rows : assignRowShares(rows, shareAt))
    : model.shareColumnId ? withColumnShares(rows, model.shareColumnId) : rows;
  return { ...model, columns: withExtremes(columns, withShares), rows: sortReportRows(withShares, model.sort), totals,
    colErrors, ...shareOut(), ...(shareBad ? { shareError: shareBad } : null),
    ...planColumnsOut(model, colErrors),
    ...(retotal ? { retotal } : null), cmPending: false };
}

/** The KPI's half: window totals for the value, the target and the support line, and the
 *  chip re-read against whichever of the two just arrived.
 *
 *  Every slot here is a WINDOW reading, so all three share one plan — the window's (§2.4) —
 *  and one vocabulary, the whole of it. */
function kpiWithCm(model, cm) {
  // `cmPlan.window` is `{ scalars, unplanned }` like every other member of the block (§2.4);
  // what an expression reads is the scalars inside it, and a window is never «undeclared».
  const scalars = model.cmPlan ? model.cmPlan.window.scalars : null;
  // Both slots read the WINDOW (§2.2's slot table), so they share one reader closure.
  const read = (metric) => cm.totals(metric);
  const valueBad = model.cm ? cmFieldRefusal(model.cm, FIELDS_PLAN) : null;
  const value = model.cm ? (valueBad ? null : cmEvalAt(model.cm, read, scalars)) : model.value;
  const targetBad = model.target && model.target.cm
    ? cmFieldRefusal(model.target.cm, FIELDS_PLAN) : null;
  const target = model.target && model.target.cm
    ? { ...model.target, value: targetBad ? null : cmEvalAt(model.target.cm, read, scalars) }
    : model.target;
  const delta = value != null && target && target.value != null ? value - target.value : null;
  let line = model.deltaVsOtherSource;
  if (line && line.pendingCm) {
    // Metric-only by the grammar (`normKpiView`'s dual-source rail): this line reads the field
    // the KPI itself reads, on both sides of one pair, and no expression can reach it.
    const t = cm.totals(line.metric);
    line = { cmValue: cmValueAt(t, 'cm'), deltaPct: cmValueAt(t, 'delta') };
  }
  return {
    ...model,
    value,
    target,
    delta,
    // Reapply the canonical target rule on the attached numbers; the half that decides it
    // may be the half that just arrived. The corridor is re-read on the same terms, off the
    // bounds the model is carrying — this function knows the two numbers and nothing else.
    good: delta == null ? null : (target.invert ? delta <= 0 : delta >= 0),
    status: bandStatusOf(value, target, model.band),
    deltaVsOtherSource: line,
    // A slot the field-set gate refused says so where the tile already prints a reason — the
    // value's own line, and the target's prefixed sentence (§2.3's one owner). Unreachable
    // from the builder, which refuses the expression before it can be stored; reachable from
    // hand-made JSON, and a dash with no reason beside it is what this exists to prevent.
    ...(valueBad ? { error: valueBad } : null),
    ...(targetBad ? { targetError: `Target unavailable: ${targetBad}` } : null),
    cmPending: false,
  };
}

/* ── §2.9: the readings that are not per row ──────────────────────────────── */

/** The window function a CM360 marker names, or null. A METRIC marker names none (it carries
 *  no expression), and so does a formula that reads only the day it stands on. */
function cmWindowFnOf(marker) {
  return marker && marker.kind === 'formula' && marker.ast ? windowFnName(marker.ast) : null;
}

/**
 * ONE cm-bearing window expression over ONE published order → Map(key → number | null).
 *
 * The pairs are read per metric down the WHOLE order first, so a running total is built from
 * every day of the window and not from the rows a viewer happens to be looking at. Presence
 * rides the arrays (`cmSeriesContext`) and the caller's rule is the last line: a day the mask
 * calls absent is null, never a zero.
 *
 * The plan half is the WINDOW's (§2.4: a date row reads the window's plan, never a row's).
 * Every `cmPlan.window` this file builds carries `unplanned: false` (a campaign's own plan is
 * never undeclared), so a formula naming a plan field always reads `plan.scalars` below; there
 * is no window-level twin of the engine's per-row `unplanned && planCols.has(c.id) ? null`.
 */
function cmWindowValues(marker, cm, order, plan) {
  const out = new Map();
  const pairsByMetric = new Map();
  for (const read of marker.reads) {
    if (pairsByMetric.has(read.metric)) continue;
    pairsByMetric.set(read.metric, order.map((key) => cm.atDate(read.metric, key)));
  }
  const got = evaluateMaskedSeries(marker.ast, cmSeriesContext(pairsByMetric, plan ? plan.scalars : null));
  order.forEach((key, i) => out.set(key, got.present[i] ? got.values[i] : null));
  return out;
}

/**
 * Every cm-bearing SERIES that names a window function, evaluated once over the calendar the
 * model published (`cmDates`) and written back BY DATE (§2.9).
 *
 * It runs after `chartWithCm`'s per-row pass and overwrites the cells it owns. Per row a
 * window function means nothing at all — `evaluateOne` takes its unreachable default, warns,
 * and answers 0 — so the cells replaced here were never a reading of anything, and the two
 * passes compose whichever way the per-row fill was written.
 *
 * Off a date axis there is no calendar to run down, and the answer is the EDITOR's sentence
 * (`dateAxisRefusal`), so an author who bypassed the draft gate reads the same words the
 * field would have shown while they typed. The values go with it: a sentence standing over a
 * column of zeros says two things. A series that already carries an error keeps it —
 * NO_CM_JOIN on a line-item axis is the larger truth about the axis.
 *
 * A series the per-row pass already REFUSED is left exactly as that pass left it, on a date
 * axis too: `cmFieldRefusal` emptied its cells and wrote its sentence, and a running total
 * written under those words would draw a line beneath a claim that nothing could be read.
 */
function applyCmWindowSeries(model, cm) {
  const windowed = model.series.filter((s) => cmWindowFnOf(s.cm));
  if (!windowed.length) return model;
  if ((model.xType || 'date') !== 'date') {
    const errors = { ...model.errors };
    for (const s of windowed) {
      if (!hasOwn(errors, s.id)) errors[s.id] = dateAxisRefusal(cmWindowFnOf(s.cm));
    }
    const blanked = model.rows.map((r) => {
      const out = { ...r };
      for (const s of windowed) out[s.key] = null;
      return out;
    });
    // The per-row pass answered these cells with a 0 (`evaluateOne`'s unreachable window
    // default), and the stack total standing over them counted it. It counts nothing now.
    if (model.stackTotal) fillStackTotal(blanked, model.stackTotal.keys);
    return { ...model, rows: blanked, errors };
  }
  // A DATE axis that published no calendar is not a wrong axis, so it gets no sentence about
  // one: there is simply nothing to run down, and what the per-row pass filled stands.
  const dates = Array.isArray(model.cmDates) ? model.cmDates : null;
  if (!dates) return model;
  const live = windowed.filter((s) => !hasOwn(model.errors, s.id));
  if (!live.length) return model;
  const plan = (model.cmPlan && model.cmPlan.window) || null;
  const byKey = new Map(live.map((s) => [s.key, cmWindowValues(s.cm, cm, dates, plan)]));
  const rows = model.rows.map((r) => {
    const out = { ...r };
    for (const s of live) {
      const got = byKey.get(s.key);
      // By DATE, never by index: a fact-date axis draws a subset of the calendar the total
      // ran over, and a positional write would slide every value onto the wrong day.
      out[s.key] = got.has(r[ROW_X]) ? got.get(r[ROW_X]) : null;
    }
    return out;
  });
  // The stack is summed over what is DRAWN, and a segment that had no numbers a moment ago
  // has them now — `chartWithCm`'s own reason, re-applied on this pass's arrivals.
  if (model.stackTotal) fillStackTotal(rows, model.stackTotal.keys);
  return { ...model, rows };
}

/**
 * What a WINDOWED column adds up to, over the whole cut and over the rows a search box kept:
 * nothing, both times. It is the engine's own rule for such a column (widget-data.js
 * `totalsCells`: `c.kind !== 'expr' || c.windowed` → null), said here for the columns the
 * engine never saw — the last day of a running total already IS the window's total, and
 * summing the column would print the area under it.
 *
 * Both answers in one place, because they are one rule: a Totals row that refuses a number
 * and a re-total that mints it from the same rows would be two rules wearing one name.
 */
function cmWindowTotals(model, cols) {
  let totals = model.totals;
  if (totals) {
    totals = { ...totals };
    for (const c of cols) totals[c.id] = null;
  }
  const retotal = typeof model.retotal === 'function' ? (keys) => {
    const base = model.retotal(keys);
    for (const c of cols) base[c.id] = null;
    return base;
  } : null;
  return { totals, ...(retotal ? { retotal } : null) };
}

/**
 * The table's half of §2.9: every cm-bearing COLUMN that names a window function, evaluated
 * once over `cmRowOrder` and written back by row KEY.
 *
 * By key, and that is the whole point of publishing the order: the rows handed in are already
 * the authored sort (`tableWithCm` re-applies it) and the author's limit pages them, so
 * neither an authored `desc` nor a header click can change what a running total means.
 *
 * Off the date grain the answer is the editor's own sentence, values blanked with it, and a
 * column that already carries NO_CM_JOIN keeps it — `applyCmWindowSeries`' reasons, on the
 * other view kind. A DATE grain that published no calendar is not a wrong grain and gets no
 * sentence about one: there is nothing to run down, and what the per-row pass filled stands.
 *
 * A column that pass already REFUSED is left exactly as it left it, on the date grain too:
 * `cmFieldRefusal` emptied its cells and wrote its sentence, and a running total written
 * under those words would draw a line beneath a claim that nothing could be read.
 *
 * Three things follow the cells, on both arms, because all three were decided one pass ago
 * over numbers that were not yet the column's:
 *   · the SORT. `tableWithCm` ends on `sortReportRows(rows, model.sort)`, and a table sorted
 *     by one of these columns was sorted by the per-row pass's zeros. ReportTable re-sorts
 *     only on a viewer's own click, so the model's order IS the authored sort and a stale one
 *     draws an arrow over a column that is not in order.
 *   · the row SHARE. A share that names one of the columns this pass WRITES, or that IS a
 *     window reading itself, is refused rather than re-divided: a running total already holds
 *     the days before it, so «this row's share of the column» would count every day many times
 *     over and the percentages would not add to 100. The sentence is the editor's own
 *     (SHARE_NO_WINDOW) — but only where the share has none already: a share whose column the
 *     field-set gate refused carries THAT sentence, which says the more particular thing, and
 *     a generic one written over it would tell the author to pick another column when the
 *     column was never the problem.
 *   · the plan MARK, off the grain: the refusals written here land after `planColumnsOut` has
 *     already run, and a refused column is not a plan column (§2.4).
 */
function applyCmWindowColumns(model, cm) {
  const windowed = model.columns.filter((c) => cmWindowFnOf(c.cm));
  if (!windowed.length) return model;
  // The columns this pass actually writes: the ones the per-row pass did not already refuse.
  // Read here rather than inside the date arm because the SHARE question below is asked
  // against it too — a column that carries an error is not a column this pass has any say
  // about, whichever grain the table is on.
  const live = windowed.filter((c) => !hasOwn(model.colErrors, c.id));
  // Either way of naming a window reading as the denominator of a percentage: the column, or
  // the share's own expression. Asked once, before either arm, because it is one question —
  // and not asked at all where the share already has a sentence, which is the more particular
  // one and was written by the pass that knows why.
  const shareBad = !model.shareError && (live.some((c) => c.id === model.shareColumnId)
    || cmWindowFnOf(model.shareCm)) ? SHARE_NO_WINDOW : null;
  // No row takes a percentage, rather than every row taking a wrong one — `tableWithCm`'s own
  // words for its own refused share, and the rows arrive here already divided.
  const unshared = (rows) => (shareBad ? rows.map((r) => ({ ...r, share: null })) : rows);
  const shareOut = shareBad ? { shareError: shareBad } : null;
  if ((model.rowType || 'date') !== 'date') {
    const colErrors = { ...model.colErrors };
    for (const c of windowed) {
      if (!hasOwn(colErrors, c.id)) colErrors[c.id] = dateAxisRefusal(cmWindowFnOf(c.cm));
    }
    const blanked = unshared(model.rows.map((r) => {
      const cells = { ...r.cells };
      for (const c of windowed) cells[c.id] = null;
      return { ...r, cells };
    }));
    return { ...model, colErrors, rows: sortReportRows(blanked, model.sort),
      columns: withExtremes(model.columns, blanked), ...cmWindowTotals(model, windowed),
      // The map `tableWithCm` published knows nothing of the sentences one line up: a column
      // whose cells are an error carries no target, and the «Plan» mark over them would
      // explain the wrong thing. It answers null where nothing changed, so a table with no
      // plan map and a table whose every plan column was answered both keep what they had.
      ...planColumnsOut(model, colErrors), ...shareOut };
  }
  const order = Array.isArray(model.cmRowOrder) ? model.cmRowOrder : null;
  if (!order) return model;
  if (!live.length) return model;
  const plan = (model.cmPlan && model.cmPlan.window) || null;
  const byCol = new Map(live.map((c) => [c.id, cmWindowValues(c.cm, cm, order, plan)]));
  const rows = unshared(model.rows.map((r) => {
    const cells = { ...r.cells };
    for (const c of live) {
      const got = byCol.get(c.id);
      // By KEY, never by index: the rows are in the authored sort and the calendar is in
      // calendar order, so a positional write would put every total on the wrong day.
      cells[c.id] = got.has(r.key) ? got.get(r.key) : null;
    }
    return { ...r, cells };
  }));
  // The best and worst reading in a tinted column moved with the numbers that just arrived.
  // `withExtremes` deletes and recomputes, so a second run is the answer for the rows as they
  // now stand rather than a layer over the answer for the rows as they were.
  return { ...model, columns: withExtremes(model.columns, rows),
    rows: sortReportRows(rows, model.sort), ...cmWindowTotals(model, live), ...shareOut };
}

/**
 * attachCmData(model, dataset, projection, view) → the same model with its CM360 half
 * filled in. PURE: the model it is handed comes back untouched, and a new one is returned —
 * a renderer holds a model across renders, and a post-pass that wrote into it would make
 * "before the adapter answered" unreachable.
 *
 * `dataset` and `projection` are the §8.5 seams' own output (T8), built ONCE per tile by the
 * caller: this is the only path CM360 numbers reach a v2 view by, so a Δ%, a cm series and
 * the compare view beside them cannot disagree. Everything about WHICH comparison this is —
 * the field, the focus, the window — travels ON the projection (`asked`), so there is no
 * second argument that could describe a different one; see buildCmReader.
 *
 * Three views have a CM half, and each joins on the grain it runs down:
 *   · a TABLE — `date` rows through the daily comparison, `dim` rows through `pivot.rows`;
 *   · a CHART — the same two, on its X;
 *   · a KPI — window totals, for the value, the target and the Δ-vs-other-source line.
 * A `li` or `dateLi` grain has no join at all and says so (NO_CM_JOIN) instead of drawing an
 * empty column nobody can explain. A PIE is deliberately not here — buildReportPieModel's
 * docblock has the reason and it is not "unfinished".
 *
 * THE DATASET IS NOT ASKED, since widget value sources phase 1 (spec 2026-08-25 §3): a cm
 * value is legal on a `delivery` widget too, and its slots are served here exactly as they are
 * on a CM360 one — same projection, same joins, same numbers. What still divides the two
 * datasets is `cmFeedOf`, one screen up, and it divides them in the one place it belongs: on a
 * delivery widget only a `source:'cm'` value is adapter-fed, so the bq twin beside it keeps
 * reading the ordinary engine and an ordinary widget's numbers never move because a cm series
 * joined it. A model built on `delivery` therefore reaches this function carrying cm slots and
 * nothing else — a Δ% column and a Δ-vs-other-source line are refused on that dataset by the
 * grammar, so neither can arrive here without one.
 *
 * Three ways to be a no-op, all returning the caller's own object:
 *   · a model with no CM slots (`cmPending` false) — including one already attached to;
 *   · no adapter data yet, which is the loading tile: the model stays PENDING, so the caller
 *     can still tell "waiting for CM360" from "answered, and there was nothing to say";
 *   · a view kind with no CM slots of its own.
 */
export function attachCmData(model, dataset, projection, view) {
  if (!model || !model.cmPending) return model;
  if (!dataset || !projection) return model;
  // The `asked` assertion moved INTO `buildCmReader` with the reader itself (§2.2): three
  // passes build one now (this one, the highlight pass, the Layout context), and a guard
  // standing on one door leaves the other two open. It is still loud and still unreachable
  // through `projectCm360Comparison`.
  const cm = cmReaderFor(dataset, projection);
  const kind = view && view.kind;
  // §2.9: a window function is the one cm reading that is not per row — it runs down the
  // published calendar, not down the rows the viewer sorted. It runs AFTER the per-row pass
  // and overwrites only the cells it owns, so the two compose without either knowing the
  // other's order. A KPI is a window number already and has no second pass.
  if (kind === 'chart') return applyCmWindowSeries(chartWithCm(model, cm), cm);
  if (kind === 'table') return applyCmWindowColumns(tableWithCm(model, cm), cm);
  if (kind === 'kpi') return kpiWithCm(model, cm);
  return model;
}

/**
 * focusTargetsOf(spec) → the Set of view ids a declared `tupleFocus` interaction points at
 * (§5.6: never implicit — a view listens to another only because the spec says so).
 *
 * ONE function beside `attachCmData` rather than two readings of `spec.interactions`: the
 * tile's models memo (ReportWidget.jsx) and the Builder's formula preview (formula-preview.js)
 * both use it to pick the focused or the unfocused projection for a given owner, and a second
 * hand-rolled filter in either place is how the two could disagree about which views focus
 * follows.
 */
export function focusTargetsOf(spec) {
  const out = new Set();
  for (const i of (spec && spec.interactions) || []) {
    if (i && i.type === 'tupleFocus') out.add(i.targetViewId);
  }
  return out;
}

/* ── the questions the TILE asks, not any one view (P2 plan Task 10) ──────── */

/**
 * reportShowsEmptyWithoutFacts(spec, controlState) → may this tile draw the honest
 * «No delivery data in this period yet» instead of its views?
 *
 * Asked here rather than in the tile, because answering it means resolving every
 * value through the switch, which is this file's job and nothing a renderer should repeat.
 *
 * The rule is unchanged and it is deliberately ALL-OR-NOTHING: the empty state replaces the
 * whole tile, so it may only stand when there is nothing else to say. One view that reads a
 * plan (`planImpr`, an expected curve, a Plan/Needed line) or a campaign constant is
 * meaningful before launch, and it keeps every view drawing — the zeros beside it are then
 * the true reading of a window that delivered nothing.
 *
 * A deliveryCm360 widget is never this state: its numbers are a comparison, its empty states
 * are the §8.5 ladder's, and a pacing's plan has no part in either.
 */
export function reportShowsEmptyWithoutFacts(spec, controlState) {
  const datasetType = (spec && spec.dataset && spec.dataset.type) || 'delivery';
  if (datasetType !== 'delivery') return false;
  const views = leafViews(spec && Array.isArray(spec.views) ? spec.views : []);
  if (!views.length) return false;
  for (const view of views) {
    if (!viewIsFactOnly(view, spec, controlState, datasetType)) return false;
  }
  return true;
}

/** A Lens can be empty while a Scope comparison still has measured facts. The
 * tile and formula preview ask the same populations their visible values read. */
export function reportWindowHasFacts(spec, sources, range) {
  if (!sources) return false;
  if (windowFactCount(sources, range) > 0) return true;
  for (const view of leafViews(spec?.views || [])) {
    if (view.kind !== 'kpi' || !view.basis) continue;
    const lines = basisLinesFor(view, sources);
    if (lines && windowFactCount(basisSources(sources, lines), range) > 0) return true;
  }
  return false;
}

/**
 * One view's half of the answer. Every value that is NOT engine-evaluable — a canonical
 * constant, a Plan/Needed line, a CM-fed value, a Δ% — is a reading that survives an empty
 * window, so it takes the tile out of the empty state exactly as a plan field does.
 *
 * The engine-evaluable expressions are handed to one neutral field census, so all view
 * kinds share the same fact-vs-plan rule without synthesizing a retired widget config.
 */
function viewIsFactOnly(view, spec, controlState, datasetType) {
  const exprs = [];
  let survivesEmpty = false;
  const take = (value) => {
    const resolved = resolveValue(value, spec, controlState);
    const expr = resolved ? valueToExpr(resolved, datasetType) : null;
    if (expr == null) { survivesEmpty = true; return; }
    exprs.push(expr);
  };
  const kind = view && view.kind;
  if (kind === 'chart') {
    for (const s of (view.series || [])) {
      if (s.hidden) continue;
      if (s.kind === 'calc') { survivesEmpty = true; continue; }
      take(s.value);
      if (s.guide) take(s.guide.value);
    }
  } else if (kind === 'table') {
    // A Δ% column needs no arm of its own: its value is the dual-source form, which is not
    // engine-evaluable, so `take` already reads it as a column that survives an empty window
    // — and its dataset never reaches this function anyway.
    for (const c of (view.columns || [])) take(c.value);
    if (view.share && view.share.value) take(view.share.value);
  } else if (kind === 'kpi') {
    take(view.value);
    if (view.target) take(view.target.value);
  } else if (kind === 'pie') {
    take(view.value);
  } else {
    // A compare view (the only other kind) lives on a CM360 widget, which never reaches here.
    return false;
  }
  if (survivesEmpty || !exprs.length) return false;
  return expressionsShowEmptyWithoutFacts(exprs);
}

/**
 * reportDimKey(view, spec, controlState) → the dimension a view runs down, or null.
 *
 * Three view kinds can stand on one (§5.1/§5.2/§5.4) and each spells it in its own place;
 * the tile asks one question of all three — is that dimension's SOURCE still there
 * (`dimSourceMissingReason`) — and this is where the three spellings become one.
 *
 * `spec` and `controlState` are what a CONTROL-bound grain needs: the dimension the viewer
 * picked is the one whose source has to be there. Both are optional, so a caller holding
 * only the view still gets the answer for a stored key, which is every grain that was ever
 * stored before M4.
 */
export function reportDimKey(view, spec, controlState) {
  if (!view) return null;
  const of = (grain) => {
    const g = resolveGrain(grain, spec, controlState);
    return g && g.type === 'dim' ? (g.key || null) : null;
  };
  if (view.kind === 'chart') return of(view.x);
  if (view.kind === 'table') return of(view.rows);
  if (view.kind === 'pie') return of(sliceGrain(view));
  return null;
}

/**
 * cmMetricOf(spec, controlState) → which of the three CM360 fields the comparison is OF.
 *
 * The §8.5 projection is built for ONE field, and on a CM360 widget the metric switch is
 * what names it (§5.5: a compare view requires the switch). Read through `resolveValue`, so
 * the field the comparison is cut on and the field a bound element prints are one read of
 * the switch and can never disagree.
 *
 * A switch whose selected option is not one of the three — a formula option, a rate — leaves
 * the comparison on `impressions`, the seam's own default: the panel offers exactly these
 * three, and a projection has to be of something.
 */
export function cmMetricOf(spec, controlState) {
  const resolved = metricControl(spec) ? resolveValue({ kind: 'bound' }, spec, controlState) : null;
  const metric = resolved && typeof resolved.metric === 'string' ? resolved.metric : null;
  return metric && CM_FIELDS.indexOf(metric) !== -1 ? metric : CM_FIELDS[0];
}

/**
 * focusGenerationOf(range, dimIds, mappingId) → the identity of the comparison a focused
 * tuple was picked inside.
 *
 * §5.6: a range, mapping or breakdown change CLEARS the focus. Stored as a generation string
 * beside the focused key rather than cleared by an effect, and for a reason: the window can
 * change from OUTSIDE this tile (the global date filter), an effect would clear the focus one
 * render after the chart had already re-drawn under it, and a focus that outlives its own
 * comparison is a chart narrowed to a tuple the table beside it no longer lists. A key whose
 * generation is not the current one is simply not focus — there is no stale state to clean up.
 *
 * The mapping id goes LAST: dim ids are NodeIds and carry no separator, while a mapping id is
 * free text, so only the final field can hold one and no two different comparisons can spell
 * the same generation.
 */
export function focusGenerationOf(range, dimIds, mappingId) {
  const from = (range && range.from) || '';
  const to = (range && range.to) || '';
  return `${from}|${to}|${(dimIds || []).join(',')}|${mappingId || ''}`;
}
