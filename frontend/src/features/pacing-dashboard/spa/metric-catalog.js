// workspace/src/lib/dashboard/metric-catalog.js
//
// The ONE authority the v2 builder mints values from (widget-builder v2 spec 2026-08-19
// §2/§4; P3 plan decision 3). A value's `unitFamily` is the CLIENT's to decide — the server
// has no metric→family catalogue and cannot get one, yet axis legality, format
// compatibility, pie summability and the cumulative rule all read it. So it is stamped
// HERE, exactly once, and never re-derived downstream.
//
// It is not a new vocabulary. It is the lists this product already has, joined and keyed by
// (kind, key) — the keying matters, because six keys are BOTH a delivery field and a KPI
// preset (`ctr`, `vcr`, `cpm`, `cpc`, `cpv`, `budget`) and they are different numbers: the
// field is the range-aware rate the engine computes, the preset is the canonical campM one
// with its target. A seventh key collides where the two sides mean the SAME money —
// `costBudTotal`, a field only so a formula can name it (the Targets preset's CPC target is
// `costBudTotal / planClicksTotal`, and a canonical value cannot appear inside an expression).
// One more pair collides on the concept rather than the key — the preset `spend` against
// the field `sp`. What each side reads:
//
//   the 47 engine fields   widget-formula.js FIELDS_DAILY/EXPECTED/RATES/PLAN — the universe
//                          a bare `{kind:'metric'}` value may name on the delivery side
//   their unit families    chart-format.js METRIC_AXIS_FORMAT, read as a family
//                          (percent→percent, currency→money, kilo→count, number→number)
//   their per-dim subset   widget-data.js DIM_FIELDS_SET — a dim bucket has no expected
//                          curve and no plan, and those fields read as a silent 0 there
//   the 46 canonical keys  @shared/widget-metrics (12 KPI presets + 34 campM keys)
//   their names            FIELD_LABELS (below, this file's own since P3 Task 0),
//                          report-render's V2_CANON_LABELS and canonical metric readings
//
// No React, no DOM, no store: everything arrives as an argument, so the same functions
// serve the Spotlight, the popovers, the draft validator and a host test.
//
// Every refusal a VALUE PICK can hit is answered here, before the pick rather than after the
// save: the pie's summability and its no-canonical rule, the dimension grain, the date-chart
// guide, a KPI target's family, the cumulative rule, and the chart's two axis rules. Each is
// the grammar's own sentence, restated where the choice is made, and `tests/metric-catalog-
// test.mjs` runs both sides of the last three through the real normReport.
//
// What is deliberately NOT here, so nobody looks for it: which SOURCE a given anchor may
// take. Two such rules remain, and both belong to the view that has them — a pie draws no
// CM-fed value (report-render's PIE_NO_CM: the CM360 side is grouped by the mapping's
// dimensions and a pie is cut by one of the pacing's), and a Δ% needs the dual-source form
// on both ends. Neither reads a unit family, and neither can be answered from an entry.
// This module answers which METRIC is offerable, and mints it.
import { UNIT_FAMILIES, CELL_FORMATS, ADDITIVE_FAMILIES, CM_FIELDS, FLOW_FIELDS } from './report-v2.js';
import { isConversionMetric } from './conversion-format.js';
import { DIM_FIELDS_SET, DIM_PLAN_FIELDS } from './widget-data.js';
import { METRIC_AXIS_FORMAT } from './chart-format.js';
import { readingFor } from './widget-metric-readings.js';
import { DIM_SOURCE_AXES, dimSourceAxisOptions, dimAxisLabel } from './dim-sources-norm.js';
import WidgetMetrics from '@shared/widget-metrics';
import MetricRegistry from '@shared/metric-registry';
import { metricAvailability } from './metric-availability.js';
export { metricAvailability } from './metric-availability.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The plan fields a declared dimension does NOT open: a day count over the segment's own
 *  container window, which differs from row to row and answers a question nobody reading a
 *  breakdown asked. Kept beside the rule that reads it (reasonFor). */
const DIM_WINDOW_FIELDS = new Set(['daysLeft', 'daysPassed']);

/**
 * The human names of the 50 keys a formula chip can print: 47 delivery formula fields —
 * shown on the formula chips ("sp · Spend"), in the Builder Spotlight, and written into a
 * canonical auto label by report-render — plus the 3 CM360 comparison identifiers
 * (`cmIm` / `cmCl` / `cmCo`, spec 2026-09-16 §2.1), which share this table for the same chip
 * and auto-label reading but are not catalog entries (see the comment beside them below).
 *
 * It lived in FormulaField.jsx until P3 Task 0. That was a React component module, so
 * report-render — a pure module imported by host tests — could not import it and mirrored
 * it instead, with a test deep-equalling the two. This is the lasting fix P2 recorded: one
 * table, in a module both sides may import.
 *
 * NULL-prototype and frozen, because it is looked up BY A METRIC KEY that comes out of
 * stored config: on a plain object `FIELD_LABELS['constructor']` answers the Function
 * constructor, and a legend would print a function body instead of a name.
 */
export const FIELD_LABELS = Object.freeze({
  __proto__: null,
  im: 'Impressions', cl: 'Clicks', sp: 'Spend', co: 'Completes / listens',
  coViews: 'Views volume', cv: 'Conversions', pc: 'Post-click conv.', pv: 'Post-view conv.',
  dc: 'Client cost',
  // The VCR-eligible pair — the two numbers VCR is the ratio of. Named so a column can print
  // the completes its own rate divides by (section-widget parity 2026-09-04).
  coV: 'Completes (VCR basis)', imV: 'Impressions (VCR basis)',
  expIm: 'Expected impressions', expCo: 'Expected cost', expCl: 'Expected clicks', expVw: 'Expected views',
  // The impression-PACED half of `expIm`: the same curve read over the lines whose plan is
  // counted in impressions, which is the number the dashboard's own Delivery card and the
  // legacy Daily Performance totals row both show. The two names sit together on purpose —
  // on a mixed-rate pacing they are different numbers and an author has to be able to see
  // which one they are picking.
  imprExpected: 'Expected impressions (impression-paced lines)',
  // …and the click-PACED half of `expCl`, for the same reason: campM's `clicksExpected`.
  clExpected: 'Expected clicks (click-paced lines)',
  ctr: 'CTR', vcr: 'VCR', acr: 'ACR', cpm: 'CPM', cpc: 'CPC', cpv: 'CPV',
  budget: 'Client budget', costBud: 'Cost budget', costBudTotal: 'Cost budget (full flight)',
  planImpr: 'Planned impressions', planClicks: 'Planned clicks', planViews: 'Planned views',
  // The whole-flight twins of the four plan sums above, which follow a narrowed window
  // (2026-09-23). «(full flight)» is costBudTotal's own spelling of the same distinction.
  budgetTotal: 'Client budget (full flight)', planImprTotal: 'Planned impressions (full flight)',
  planClicksTotal: 'Planned clicks (full flight)', planViewsTotal: 'Planned views (full flight)',
  // The client's plan over the days `costBud` covers (2026-09-23), the Finance «Budget Plan to Date».
  budgetToDate: 'Client budget to date',
  daysLeft: 'Days left', daysPassed: 'Days passed',
  mTgt: 'Margin target %', ctrT: 'CTR target %', vcrT: 'VCR target %', acrT: 'ACR target %',
  tgtCpm: 'Target CPM',
  // The three CM360 counts (spec 2026-09-16 §2.1). They are NOT catalog entries and never
  // appear in a value picker — there is no `field:cmIm` — but they are named in a formula,
  // so the palette, the chip and an auto label all need the word for them, and this is the
  // one table those three read. The «CM360» prefix is the whole disambiguation: a header
  // reading «Impressions» beside one reading «CM360 impressions» is the difference the
  // author is drawing.
  cmIm: 'CM360 impressions', cmCl: 'CM360 clicks', cmCo: 'CM360 completions',
  // The six mart metrics added 2026-09-08 read their names from the registry. The classic
  // eight keep this table's own spellings (`co` is «Completes / listens» here and «Completes»
  // as a sheet role: the picker counts video completes AND audio listens).
  ...Object.fromEntries(MetricRegistry.ADDED_DELIVERY_KEYS.map((k) => [k, MetricRegistry.byKey(k).label])),
});

/**
 * The canonical half's names. The 18 campM keys need explicit authoring labels;
 * `tests/report-render-test.mjs` pins them to the renderer. This file reads the remaining
 * names from widget-metric-readings.
 *
 * The four `neededPerDay*` names stay exactly as the constructor writes them, and that is
 * the point of §4's warning: the CANONICAL scalar is the current needed-per-day for the
 * whole flight, while the §8 CALCULATION is a by-date series called «Needed per day to hit
 * goal (by date)». Different numbers, never one label — the tips below say which is which.
 */
const CANON_ONLY_LABELS = Object.freeze({
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
  hitBudgetAddImpr: 'Impressions to hit budget', hitBudgetAddViews: 'Views to hit budget',
  hitBudgetAddClicks: 'Clicks to hit budget', hitBudgetPerDayImpr: 'Impressions / day to hit budget',
  hitBudgetPerDayViews: 'Views / day to hit budget', hitBudgetPerDayClicks: 'Clicks / day to hit budget',
  hitBudgetAddInstalls: 'Installs to hit budget', hitBudgetPerDayInstalls: 'Installs / day to hit budget',
  hitBudgetPlan: 'Client budget (lines with a goal)', hitBudgetProjected: 'Projected client spend',
  hitBudgetGap: 'Budget gap at current rates',
  // The seven above, on the unit this pacing is BOUGHT on (2026-10-05) — impressions on a
  // CPM pacing, clicks on a CPC one, views on a CPV one, resolved at render by `primaryUnit`.
  // Labelled «buy unit» rather than naming a unit, because which one it is is the pacing's
  // answer and not the author's.
  unitToDatePct: 'Buy unit vs plan-to-date', unitActual: 'Actual buy units to date',
  unitExpected: 'Expected buy units to date', unitPlan: 'Planned buy units',
  unitDeviation: 'Buy unit deviation to date', neededPerDayUnit: 'Needed buy units / day',
  paceDeltaUnit: 'Buy unit pace delta',
});

/**
 * The format each of those 18 prints in — brick-data.js's own `CANON` table, which is
 * private to that module (it also carries the reading side: `cm` vs `flCM` vs derived).
 * Restated rather than exported from there, and `tests/metric-catalog-test.mjs` pins every
 * entry against what `brickValue` actually answers, so a change over there fails a test
 * instead of drifting into a picker.
 */
const CANON_ONLY_FORMAT = Object.freeze({
  __proto__: null,
  neededSpendPerDay: 'money', neededPerDayImpr: 'int', neededPerDayClicks: 'int',
  neededPerDayViews: 'int', neededPerDayInstalls: 'int', imprToDatePct: 'percent', imprActual: 'int',
  imprExpected: 'int', imprDeviation: 'int', forecastDspSpend: 'money',
  costBudTotal: 'money', costRemaining: 'money', clientPlanCpm: 'money',
  clientPlanCpc: 'money', clientPlanCpv: 'money4', bidPlanCpm: 'money',
  dynCpm: 'money', paceDeltaImpr: 'pp',
  hitBudgetAddImpr: 'int', hitBudgetAddViews: 'int', hitBudgetAddClicks: 'int',
  hitBudgetPerDayImpr: 'int', hitBudgetPerDayViews: 'int', hitBudgetPerDayClicks: 'int',
  hitBudgetAddInstalls: 'int', hitBudgetPerDayInstalls: 'int',
  hitBudgetPlan: 'money', hitBudgetProjected: 'money', hitBudgetGap: 'money',
  unitToDatePct: 'percent', unitActual: 'int', unitExpected: 'int', unitPlan: 'int',
  unitDeviation: 'int', neededPerDayUnit: 'int', paceDeltaUnit: 'pp',
});

/**
 * The two directions of the ONE unit statement this product already makes. A field's axis
 * scale (chart-format) says what unit it is in; the family says which formats print it and
 * which axis it may share. They are inverses, so neither can drift from the other.
 */
const FAMILY_OF_AXIS = { __proto__: null, percent: 'percent', currency: 'money', kilo: 'count', count1: 'count', number: 'number' };
const AXIS_OF_FAMILY = { __proto__: null, percent: 'percent', money: 'currency', count: 'kilo', number: 'number' };
/** A cell format, read as the family that prints it. `int` is shared with the dimensionless
 *  family, and every canonical metric that stores it is a count of impressions, clicks or
 *  views — so it reads as `count` here, and `flight` (the only `number` canonical) never
 *  reaches this map: its stored format is not a cell format at all. */
const FAMILY_OF_FORMAT = {
  __proto__: null,
  int: 'count', count1: 'count', money: 'money', money4: 'money', percent: 'percent', percent2: 'percent',
  pp: 'percent', number2: 'number',
};
/** What a freshly picked value prints in, per family. Never `auto`: a table cell may say
 *  "you pick", a KPI and a pie may not (§5.3/§5.4), and one default has to serve all three. */
const DEFAULT_FORMAT_BY_FAMILY = { __proto__: null, count: 'int', money: 'money', percent: 'percent', number: 'int' };

/** The delivery fields the CM360 dataset also carries, and the name it carries them under
 *  (§4). Today the three are the whole CM360 field set, so the CM-ONLY class is empty —
 *  the chip grammar still allows one, and an entry would simply declare `sources: ['cm']`. */
const CM_TWIN = { __proto__: null, im: 'impressions', cl: 'clicks', co: 'completions' };

// The Spotlight's grouped map (§4): Delivery / Money / Rates / Plan & pacing / Calculations
// & comparisons — and Dimensions, which is `dimensionEntries` below rather than a group of
// this list. The order inside each group is the order the map prints.
const FIELD_GROUPS = [
  ['delivery', ['im', 'rc', 'cl', 'lc', 'st', 'q1', 'q2', 'q3', 'co', 'coV', 'imV', 'coViews', 'cv', 'pc', 'pv']],
  ['money', ['sp', 'dc']],
  ['rates', ['ctr', 'vcr', 'acr', 'cpm', 'cpc', 'cpv']],
  ['plan', ['expIm', 'imprExpected', 'expCo', 'expCl', 'clExpected', 'expVw', 'budget', 'budgetTotal', 'budgetToDate', 'costBud', 'costBudTotal',
    'planImpr', 'planImprTotal', 'planClicks', 'planClicksTotal', 'planViews', 'planViewsTotal', 'daysLeft', 'daysPassed',
    'mTgt', 'ctrT', 'vcrT', 'acrT', 'tgtCpm']],
];

// The one-line notes the map prints under a name. Only where the name alone would mislead:
// a note that restates its label is noise the reader learns to skip. No em dashes in any of
// them (the copy rule) — `—` is the empty-cell placeholder in this product.
const CUMULATIVE = 'Cumulative to date.';
// The rate tips state the DASHBOARD rule rather than a literal formula, the same correction
// FormulaField's chip tips carry: the literal text contradicted the §3 canon and produced
// «your numbers are wrong» reports on mixed campaigns.
const DASHBOARD_RATE = 'As the dashboard computes it here, not raw division.';
// The four plan sums follow a window the viewer narrowed (2026-09-23); their twins do not.
// Each sentence has to hold in every mode (review 2026-09-23). The plan follows only a window
// the viewer narrowed (useWidgetData `planFollowsRange`): a range such as 7d or a Custom range.
// A widget that follows a selected period reads that period's own plan (virtual plans) and
// never follows a narrower window inside it. So a twin is the flight's whole plan, or the
// period's. Exported so the formula editor's tips (FormulaEditorDialog.jsx) are these words.
export const PLAN_FOLLOWS_WINDOW = 'Only the plan inside a narrowed date window (such as 7d or a Custom range), '
  + 'else the whole plan. A widget that follows a selected period always reads that period’s whole plan.';
export const PLAN_WHOLE = 'The whole plan, whatever the date window: the flight’s, or the selected '
  + 'period’s when the widget follows one.';
// campM's `costPr` and the widget field `costBud` (liPlanScalars → prorateRange): the cost
// curve from the window's first day to its last day or asOf, whichever comes first. On Flight
// that is «to date»; on a window that ended before asOf it is the whole window.
export const COST_BUD_SPAN = 'Cost budget planned from the first day of the date window to its last day '
  + 'or the last data day, whichever comes first. Net of the margin target.';
// widget-data's `budgetToDate` (2026-09-23): the same days as the cost budget above, in the
// client's money, added up line by line. «Whatever each line's margin» is the point of it: the
// cost budget over one blended margin is the client's plan only while every margin is the same.
export const BUDGET_TO_DATE_SPAN = 'Client budget planned from the first day of the date window to its '
  + 'last day or the last data day, whichever comes first. Added up line by line, so it is the '
  + 'client’s money whatever each line’s margin.';
// The campaign CTR and its target (owner decision 2026-09-23). The CTR counts every line;
// the target reads delivery, and falls back to the plan where the window has none from the
// lines that carry one. Exported so the formula editor's tips (FormulaEditorDialog.jsx) are
// these words.
export const CTR_TIP = 'Clicks divided by impressions, every line counted.';
export const CTR_TARGET_TIP = 'CTR target: each line’s target weighted by its impressions in the date window; '
  + 'when none of those lines has impressions there, by planned impressions.';
const TIP_BY_FIELD = {
  __proto__: null,
  expIm: CUMULATIVE, expCl: CUMULATIVE, expVw: CUMULATIVE,
  expCo: 'Expected COST, cumulative to date. Not completes.',
  imprExpected: 'Cumulative to date, over the lines whose plan is counted in impressions. '
    + 'Expected impressions beside it counts every line, including a click-paced line’s '
    + 'planned clicks.',
  clExpected: 'Cumulative to date, over the lines whose plan is counted in clicks (CPC). '
    + 'Expected clicks beside it also counts the clicks every other line’s CTR target implies.',
  tgtCpm: 'Cost budget over planned impressions, on the CPM lines. A flight constant: it does '
    + 'not follow the widget’s window.',
  costBud: `${COST_BUD_SPAN} `
    + 'The field beside it, Cost budget (full flight), is the same money without the proration.',
  budget: PLAN_FOLLOWS_WINDOW, planImpr: PLAN_FOLLOWS_WINDOW,
  planClicks: PLAN_FOLLOWS_WINDOW, planViews: PLAN_FOLLOWS_WINDOW,
  budgetTotal: PLAN_WHOLE, planImprTotal: PLAN_WHOLE,
  planClicksTotal: PLAN_WHOLE, planViewsTotal: PLAN_WHOLE,
  budgetToDate: BUDGET_TO_DATE_SPAN,
  costBudTotal: 'The whole flight’s cost budget: it does not follow the widget’s window. '
    + 'The range-prorated figure is the Cost budget field.',
  ctr: CTR_TIP, ctrT: CTR_TARGET_TIP, vcr: DASHBOARD_RATE, acr: DASHBOARD_RATE,
  cpm: DASHBOARD_RATE, cpv: DASHBOARD_RATE,
  // The CM360 side spells this field «Completions», and that is what a value minted onto
  // the CM source prints (report-render's V2_CM_LABELS, the same word the comparison panel
  // headers use). The delivery field keeps the engine's own «Completes / listens», because
  // on this side it counts video completes AND audio listens.
  co: 'On the CM360 source the same field is named Completions.',
  // The pair VCR divides: completes and impressions over the lines whose completes are video
  // completes. A display line's impressions never enter it, and neither do an audio line's
  // listen-throughs, which is what keeps the rate from being diluted by a different question.
  coV: 'Completes on the lines VCR is measured over. The rate beside it divides by exactly this.',
  imV: 'Impressions on the lines VCR is measured over: the denominator of VCR.',
  ...Object.fromEntries(MetricRegistry.ADDED_DELIVERY_KEYS.map((k) => [k, MetricRegistry.byKey(k).tip])),
};

const TIP_CANON_DEFAULT = 'Full flight; the period switch does not change it.';
// §4's warning, in the words the map prints: this is the CURRENT needed-per-day for the
// whole flight, and «Needed per day to hit goal (by date)» is a different number.
const NEEDED_NOW = 'Current needed per day, full flight. The by-date calculation is a separate series.';
// «Impressions to Hit Budget» (2026-09-29): one rate for all three tips, each rate type's own.
const HIT_BUDGET_RATE = 'At each rate type’s average Dyn rate over the flight, or the selected period under period scope.';
const HIT_BUDGET_ADD = 'Units to add to the plan so its lines land on their client budget. '
  + 'Negative: the budget runs out first. ' + HIT_BUDGET_RATE;
const HIT_BUDGET_DAY = 'Units per day from now to the end, plan remainder included, to land on the client budget. '
  + HIT_BUDGET_RATE;
const TIP_BY_CANON = {
  __proto__: null,
  neededSpendPerDay: NEEDED_NOW, neededPerDayImpr: NEEDED_NOW,
  neededPerDayClicks: NEEDED_NOW, neededPerDayViews: NEEDED_NOW,
  costBudTotal: 'The whole flight’s cost budget. The range-prorated figure is the Cost budget field.',
  hitBudgetAddImpr: HIT_BUDGET_ADD, hitBudgetAddViews: HIT_BUDGET_ADD, hitBudgetAddClicks: HIT_BUDGET_ADD,
  hitBudgetPerDayImpr: HIT_BUDGET_DAY, hitBudgetPerDayViews: HIT_BUDGET_DAY, hitBudgetPerDayClicks: HIT_BUDGET_DAY,
  hitBudgetAddInstalls: HIT_BUDGET_ADD, hitBudgetPerDayInstalls: HIT_BUDGET_DAY,
  hitBudgetProjected: HIT_BUDGET_RATE, hitBudgetGap: HIT_BUDGET_RATE,
};

/**
 * A family slot in the env, read as a list. It may arrive as one family, an array (what
 * `familyOf` answers with) or a Set (what a picker holds while it accumulates one), because
 * asking every caller to convert is asking one of them to convert wrongly. Anything that is
 * not a family the grammar has is DROPPED rather than carried: a rule that fires off a
 * misspelt unit refuses a legal pick, which is the one error a picker must not make.
 */
function familyList(x) {
  const raw = typeof x === 'string' ? [x] : (x instanceof Set ? [...x] : (Array.isArray(x) ? x : []));
  const out = [];
  for (const f of raw) if (UNIT_FAMILIES.includes(f) && !out.includes(f)) out.push(f);
  return out;
}

/** «count», «count and money», «count, money and percent» — how a refusal names a set. */
function joinAnd(list) {
  if (list.length < 2) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * Why this entry cannot be picked HERE, or null. One rule set, read off the entry's own
 * flags, so a refusal the builder shows and the one the validator would give are the same
 * rule stated once.
 *
 * The order is which reason ANSWERS first, and it runs outermost-first: a view that cannot
 * hold the value at all, then the grain it would be computed on, then the slot inside the
 * view. A reader fixes the outer one anyway.
 *
 * Three of the rules need something only the CALLER knows — what the KPI's value is measured
 * in, whether the series adds up, what the chart's axes already draw. Each rides an OPTIONAL
 * env slot and fires only when that slot is filled: an env that says nothing refuses nothing,
 * so a caller that knows less is safe rather than wrong.
 */
function reasonFor(entry, env) {
  const anchor = env && env.anchor;
  const grain = env && env.grain;
  // A chart's series value answers to the view («chart») and to the row («series») — the two
  // words the UI uses for the one slot. Normalized once, here, rather than at each rule.
  const inSeries = anchor === 'chart' || anchor === 'series';

  // §3.6 of the mart-metrics spec: a metric this pacing's delivery data does not carry, or
  // has not been rebuilt to carry yet. Only the entries the inventory judges; only when the
  // env says what the file carried.
  //
  // …and only on a DELIVERY grain. A `ds:` grain draws its numbers out of a dimension
  // source's own file, which the delivery inventory says nothing about: on an
  // adjustments-view pacing (no `reach` in the mart) with a devices source that has it, this
  // rule would mute a metric the tile beside it draws. `grainKey` is optional, so a caller
  // that does not know its grain still gets the old behaviour; the tile judges those grains
  // (report-render's `unavailableMetric`).
  const dsGrain = env && typeof env.grainKey === 'string' && env.grainKey.startsWith('ds:');
  if (!dsGrain && entry.kind === 'metric' && entry.inventoried && env && hasOwn(env, 'availableMetrics')) {
    const why = metricAvailability(entry.key, env.availableMetrics, entry.label);
    if (why) return why;
  }

  // §5.4 / normPieView: a pie cuts ONE total into slices, so its value adds up. And a
  // canonical metric is one campaign number — report-render answers PIE_NO_CANONICAL at
  // render time; said before the pick, it is one fewer dead end.
  if (anchor === 'pie') {
    if (entry.kind === 'canonical') {
      return 'One number for the whole flight, so there is no total to cut into slices';
    }
    // …and on a CM360 widget the three fields BOTH sources carry are read through the join,
    // which groups them by the mapping's dimensions and not by the one a pie cuts. `cmName`
    // is what makes an entry one of the three; on a delivery widget the same entry is an
    // ordinary count with real per-dimension buckets, so the dataset is half the rule.
    if (entry.cmName && env && env.datasetType === 'deliveryCm360') {
      return 'On a CM360 widget this number is grouped by the mapping dimensions, so it cannot be cut by this one';
    }
    // …and the plan half a declared dimension opens (2026-09-12) is summable but not WHOLE:
    // a pacing declares some of its values and not others, so the ring would be drawn out of
    // the declared part and presented as the total. Said here rather than at the dim rule
    // below, because a pie is refused even where a table of the same cut is fine.
    if (grain === 'dim' && DIM_PLAN_FIELDS.has(entry.key)) {
      return 'A pie cuts one total into slices, and a plan covers only the values this pacing declared';
    }
    if (!ADDITIVE_FAMILIES.includes(entry.unitFamily)) {
      return `A pie cuts one total into slices, and ${entry.unitFamily} values are not summable`;
    }
  }

  // widget-data.js: a dimension bucket has no per-dim expected curve and no per-dim plan.
  // Those fields used to read as a confident, wrong 0 there.
  //
  // …unless the pacing DECLARES the dimension (2026-09-12). A container's `dim_children` are
  // a real plan for one value of one dimension, and dim Scope has paced the dashboard
  // headline against exactly that since it shipped — a widget cut by the same dimension was
  // refusing the number its own headline shows. `dimPlanEligible` is the caller's answer to
  // "does this pacing declare this dimension", and it rides an OPTIONAL env slot like every
  // other per-pacing fact here: an env that does not say refuses everything, as before.
  if (grain === 'dim' && !entry.dimEligible) {
    if (!(env && env.dimPlanEligible)) {
      return 'Dimension buckets carry no plan and no expected curve';
    }
    // The two that stay out even on a declared dimension: they describe a WINDOW, and a
    // segment's window is its container's, so one table would report different day counts
    // row by row over the same calendar.
    if (DIM_WINDOW_FIELDS.has(entry.key)) {
      return 'A segment is planned inside its own container window, so this day count would differ from one row to the next';
    }
    if (!DIM_PLAN_FIELDS.has(entry.key)) {
      return 'Dimension buckets carry no plan and no expected curve';
    }
  }

  // §7.2 / normGuide, the rule the legacy validator has enforced all along: a bare daily
  // flow field is a WINDOW total, so against per-day series the reference line lands off by
  // the window length. Legal off a date axis, where a bar is a window total too.
  //
  // Read by the entry's KEY, which makes this deliberately stricter than the server on one
  // dataset: on `deliveryCm360` the same entry mints `impressions`, and the grammar's
  // `flowFieldOf` tests FLOW_FIELDS — a name it does not carry, so normGuide would accept it.
  // The number is a window total either way, so the builder refuses the pick that draws a
  // line nowhere near the data. Not a mirror bug: a client that refuses more than the server
  // never produces a save the server rejects.
  if (anchor === 'guide' && grain === 'date' && entry.kind === 'metric' && FLOW_FIELDS.includes(entry.key)) {
    return `“${entry.key}” is a window total, so against a daily series the line would sit nowhere near the data`;
  }

  // normKpiView (~:1113): a target is measured against the value, so it is measured in the
  // SAME unit — and for a bound value EVERY option must be, because the switch moves the
  // value while the target stays. The builder knows the value before the target is picked,
  // so the map says it first instead of the save saying it.
  if (anchor === 'target' && env && env.targetFamily != null) {
    const want = familyList(env.targetFamily);
    if (want.length > 1) {
      return `The value switches between ${joinAnd(want)}, and a target is measured in one of them`;
    }
    if (want.length === 1 && want[0] !== entry.unitFamily) {
      return `A target carries the unit family of the value it measures, so this one is ${entry.unitFamily} and the value is ${want[0]}`;
    }
  }

  // normSeries: the KIND half first, exactly as the grammar orders it. A canonical metric is
  // ONE number for the whole flight, so a running sum adds that number to itself once per day
  // and draws a staircase describing nothing. The family rule below cannot catch it —
  // `imprExpected` is a count, and counts add up.
  if (inSeries && env && env.accumulate === 'cumulative' && entry.kind === 'canonical') {
    return 'One number for the whole flight, so there is nothing to add up day by day';
  }

  // normSeries (~:772): a cumulative series adds itself up across the window, and only a
  // count or money value means anything added up. A running CTR is a number nobody can read.
  if (inSeries && env && env.accumulate === 'cumulative' && !ADDITIVE_FAMILIES.includes(entry.unitFamily)) {
    return `This series adds up over the window (cumulative), so it holds a count or money value, not ${entry.unitFamily}`;
  }

  // normChartView (~:879-892), both cross-series rules, outermost first: two axes cannot hold
  // three unit families, and series sharing an EXPLICIT axis must share a unit.
  //
  // `axisFamilies` carries what the OTHER series already draw — per explicit axis and over
  // the whole chart — which is the union a picker can compute. That answers the SOUND half of
  // each rule: a family an axis does not hold at all is disjoint from every series on it, so
  // the grammar refuses it for certain. Where the union alone cannot decide (one bound series
  // spanning two families, another fixed beside it), nothing is refused here and normReport
  // stays the authority: a builder that refuses a legal chart is the worse of the two errors.
  if (inSeries && env && env.axisFamilies) {
    const af = env.axisFamilies;
    const all = familyList(af.all);
    // The 2 is the number of axes a chart has, which is structural, not a tunable cap.
    if (all.length >= 2 && !all.includes(entry.unitFamily)) {
      return `This chart already draws ${joinAnd(all)}, and its two axes cannot hold a third unit`;
    }
    // `auto` is not a side: the renderer places it, and the grammar pairs only series that
    // sit on the same EXPLICIT axis.
    if (env.axis === 'left' || env.axis === 'right') {
      const on = familyList(af[env.axis]);
      if (on.length && !on.includes(entry.unitFamily)) {
        return `The ${env.axis} axis draws ${joinAnd(on)}, and a ${entry.unitFamily} value shares no unit with it, so it belongs on the other axis`;
      }
    }
  }

  return null;
}

/** The closure has to see the finished entry, so the key is declared first (which also
 *  fixes its place in the key order) and filled in before the object is frozen. */
function makeEntry(e) {
  const entry = { ...e, disabledReason: null };
  entry.disabledReason = (env) => reasonFor(entry, env);
  return Object.freeze(entry);
}

function fieldEntry(group, key) {
  // The round trip is the point: the family is READ off the field's axis scale, and the
  // entry's own axis scale is written back from the family — so a canonical entry, which
  // has no delivery-field row to read, derives its scale by the same rule. The two maps are
  // inverses and the suite pins the loop closed.
  const unitFamily = FAMILY_OF_AXIS[METRIC_AXIS_FORMAT[key]];
  const cmName = hasOwn(CM_TWIN, key) ? CM_TWIN[key] : null;
  return makeEntry({
    id: `field:${key}`,
    kind: 'metric',
    key,
    label: FIELD_LABELS[key],
    group,
    unitFamily,
    sources: Object.freeze(cmName ? ['bq', 'cm'] : ['bq']),
    cmName,
    // Every one of these is read in the WIDGET's context rather than the campaign's, which
    // is what this flag says and what separates them from the canonical half. Several plan
    // scalars are constants the window cannot move (`costBudTotal` and the four *Total
    // twins, the targets); their own tips say so, and none of them needs the «full flight»
    // badge, which is about a number that ignores a Period switch the tile is showing.
    // `budget` and the plan units DO follow a narrowed window (2026-09-23).
    windowEligible: true,
    dimEligible: DIM_FIELDS_SET.has(key),
    // The six the per-pacing inventory judges (spec §3.6); the classic eight are exempt.
    inventoried: MetricRegistry.ADDED_DELIVERY_KEYS.includes(key),
    defaultFormat: isConversionMetric(key) ? 'count1' : DEFAULT_FORMAT_BY_FAMILY[unitFamily],
    axisFormat: METRIC_AXIS_FORMAT[key],
    tip: hasOwn(TIP_BY_FIELD, key) ? TIP_BY_FIELD[key] : null,
  });
}

function canonEntry(key) {
  const reading = readingFor(key);
  const format = reading ? reading.format : CANON_ONLY_FORMAT[key];
  // `flight` (days left) stores `'number'`, which is a CHART axis scale. Carried
  // through, badCellFormat would refuse the first
  // save, so it mints the dimensionless family and takes that family's own default.
  const legal = CELL_FORMATS.includes(format);
  const unitFamily = legal ? FAMILY_OF_FORMAT[format] : 'number';
  return makeEntry({
    id: `canon:${key}`,
    kind: 'canonical',
    key,
    label: reading ? reading.title : CANON_ONLY_LABELS[key],
    group: 'calc',
    unitFamily,
    sources: Object.freeze(['bq']),
    cmName: null,
    // §2: campaign-level, so the Period switch does not recompute them — and the map has
    // to say so, or the reader takes a full-flight number for a windowed one.
    windowEligible: false,
    // It renders on a dimension grain: the campaign constant, repeated on every row (the
    // table model's own decision). Nothing about it is per-dimension, which is what the
    // «full flight» tag is for.
    dimEligible: true,
    defaultFormat: legal ? format : DEFAULT_FORMAT_BY_FAMILY[unitFamily],
    axisFormat: AXIS_OF_FAMILY[unitFamily],
    tip: hasOwn(TIP_BY_CANON, key) ? TIP_BY_CANON[key] : TIP_CANON_DEFAULT,
  });
}

/**
 * Every value a picker may offer, in the order the grouped map prints them: the 31 delivery
 * fields by group, then the 46 canonical metrics in WIDGET_METRICS' own order.
 *
 * FROZEN, entries included — it is read on every keystroke of a Spotlight query and handed
 * straight to renderers, and a caller that could push onto it would be a second catalog.
 */
export const CATALOG = Object.freeze([
  ...FIELD_GROUPS.flatMap(([group, keys]) => keys.map((k) => fieldEntry(group, k))),
  ...WidgetMetrics.WIDGET_METRICS.map(canonEntry),
]);

/**
 * The entries BOTH sources carry, in the grammar's own order (`CM_FIELDS`).
 *
 * One derivation, because four screens ask the same question of it and each of them is
 * about the same rule (`isDualSource`, shared/report-v2.js): a Δ% compares one of these, a
 * compare view's metric switch may offer only these, `+ Add view → Compare` mints its
 * switch from them, and a table's Row share offers the same list where the rows join
 * (`TableCard.jsx`, §2.6). A second `CATALOG.find` typed at one of those callers is a second
 * answer to «which fields are dual-source» waiting for a fifth field to be added.
 */
export const DUAL_SOURCE_ENTRIES = Object.freeze(CM_FIELDS
  .map((name) => CATALOG.find((e) => e.cmName === name))
  .filter(Boolean));

/**
 * entriesFor(env) → every entry with the answer to "can I pick this HERE", never a shorter
 * list. §1.1.3: nothing is hidden silently — an entry that does not apply is shown disabled
 * with its reason, one click away behind the group's «▸ N unavailable here» counter.
 *
 * `env` — the four the slot always knows:
 *   datasetType       'delivery' | 'deliveryCm360' — the dataset the widget reads
 *   anchor            which slot is being filled: chart (a chart's series value, also
 *                     accepted as 'series') / table / kpi / pie / guide / target / switch
 *   grain             the grain the value is computed on — a chart's X type, a table's row
 *                     type, `'dim'` for a pie's slices, null for a KPI
 *   hasMetricControl  whether a metric switch exists. It changes NO entry's availability
 *                     (§2: the map shows the full catalog); it is here because the
 *                     Spotlight's second step — ⇄ / BQ / CM — is decided from these same
 *                     facts, and two envs for one decision are two envs that drift.
 *
 * …and five OPTIONAL ones, each carrying a rule the entry alone cannot answer. Omit one and
 * its rule stays silent — the map then refuses less, never wrongly:
 *   availableMetrics  the pacing's mart-metrics inventory (spec 2026-09-08 §3.6): the blob's
 *                     `{delivery: keys}`, or null when the file predates the change. Judged
 *                     only for the six entries the inventory covers (`inventoried`). A caller
 *                     that knows nothing leaves it out or passes `undefined`; `null` is not
 *                     that — it SAYS the file carries none of them, and refuses all six.
 *   grainKey          the grain's raw key beside `grain`'s type, when the caller has one: a
 *                     `ds:<source>:<dim>` key turns the inventory rule OFF, because the
 *                     numbers then come out of that source's file and not the delivery one.
 *                     Absent means «an ordinary grain», which is what it was before.
 *   targetFamily      anchor 'target': the family the KPI's VALUE carries. A family, a list
 *                     (what `familyOf` answers with) or a Set. Two families means a bound
 *                     value the switch moves between, and no single target measures it.
 *   accumulate        a series pick: 'daily' | 'cumulative'.
 *   axis              a series pick: 'left' | 'right' | 'auto' — the side this series sits
 *                     on. Only an explicit side can conflict with a neighbour.
 *   axisFamilies      a series pick: `{left, right, all}` — the families the OTHER series
 *                     already draw on each explicit axis and across the whole chart (each a
 *                     family, a list, a Set, or null for a side nothing sits on). A pick that
 *                     REPLACES a value leaves that series' own family out; a pick that adds
 *                     one passes every series.
 */
export function entriesFor(env) {
  return CATALOG.map((entry) => {
    const reason = entry.disabledReason(env);
    return { entry, available: reason === null, reason };
  });
}

/**
 * mintValue(entry, {source, datasetType}) → the value object to STORE, in the grammar's own
 * key order (`kind,metric,source,unitFamily` / `kind,key,unitFamily`). The stored JSON is
 * byte-compared — by the goldens, and by the drawer's dirty fingerprint — so the order is
 * part of the value, not a detail of how it was written.
 *
 * A `cm` value ALWAYS mints its CM NAME, on either dataset: the grammar accepts only
 * `impressions` / `clicks` / `completions` under `source:'cm'` (`CM_FIELDS`), so spelling one
 * `im` writes a value the save refuses by name. That is the whole reason the builder mints
 * from an entry instead of spreading a source across a stored value.
 *
 * On a `deliveryCm360` widget the BQ side mints the CM name too: the delivery half of a
 * comparison is fed by the CM360 adapter (report-render's `cmFeedOf` reads exactly
 * `{metric: 'impressions', source: 'bq', unitFamily: 'count'}`) so that both lines describe the
 * same population, and handing the engine `impressions` — a field it does not have — would draw
 * «Unknown field». On a DELIVERY widget the bq side stays the engine's own key: an ordinary
 * widget's numbers must not change because a cm series joined it (spec 2026-08-25 §3).
 *
 * So the two conjuncts are one rule read from two ends: the CM name is what a cm value is
 * called, and what a CM360 widget calls both halves of its pair.
 *
 * It THROWS rather than guessing, on the same rule `valueToExpr` throws by: a missing
 * `datasetType` does not produce something the caller can branch on, it produces the wrong
 * metric key, silently. A source the entry does not carry is a caller that skipped
 * `entriesFor` — a programming error, not a user one.
 */
export function mintValue(entry, opts) {
  const o = opts || {};
  const { source = 'bq', datasetType } = o;
  if (!entry || typeof entry !== 'object') throw new TypeError('mintValue: an entry is required');
  if (datasetType !== 'delivery' && datasetType !== 'deliveryCm360') {
    throw new TypeError('mintValue: datasetType is required (pass the draft spec\'s dataset type)');
  }
  // The source rail runs BEFORE the kinds, so it is one rule rather than one per branch: a
  // canonical metric is read from the campaign context and from nowhere else, and answering
  // `source:'cm'` on one with a value would have handed a CM360 panel a campaign scalar.
  if (!Array.isArray(entry.sources) || !entry.sources.includes(source)) {
    throw new TypeError(`mintValue: "${entry.id}" is not read from the ${source} source`);
  }
  if (entry.kind === 'canonical') {
    return { kind: 'canonical', key: entry.key, unitFamily: entry.unitFamily };
  }
  const metric = (entry.cmName && (source === 'cm' || datasetType === 'deliveryCm360'))
    ? entry.cmName : entry.key;
  return { kind: 'metric', metric, source, unitFamily: entry.unitFamily };
}

/**
 * entryOf(value, datasetType) → the catalog entry a STORED value was minted from, or null.
 *
 * `mintValue`'s read-back twin, and it has to be one function rather than a predicate typed
 * at each picker: on a `deliveryCm360` widget a dual-source field is stored under its CM
 * NAME on both sides (`impressions`, not `im`), so «which row of the map is this value»
 * cannot be answered by the key alone. A picker that got it wrong would show the wrong row
 * selected — and then re-mint from it on the next change.
 *
 * A `formula` or a `bound` value is minted from no entry and answers null: neither names a
 * metric, which is exactly why the popover shows them as their own option.
 *
 * ON A CM360 WIDGET BOTH SPELLINGS ANSWER, because `setDataset` re-mints nothing (its own
 * docblock): a KPI added on a delivery report still says `im` after the source is added, and
 * reading only the CM name answered `null` for it. A controlled `<select>` whose value is in
 * none of its options marks its FIRST enabled option selected — «Metric switch ⇄» on every
 * report that has a switch — so all four Value pickers stated that the KPI followed the
 * switch while it stored a fixed Impressions. Both readings are the same field and both work
 * on that dataset (`im` is the engine's own key, and a CM360 widget still reads delivery
 * facts); only the CM-joined twin needs the CM name, which is why that spelling wins when
 * both could match.
 *
 * ON A DELIVERY WIDGET THE CM SPELLING UNDER THE BQ SOURCE IS STILL NOTHING. There is no
 * `impressions` field on the engine side, and answering `field:im` for one would hide a value
 * the engine cannot evaluate behind a picker that looks settled. The builder does not produce
 * that state: removing the source re-mints through `remintForDelivery` (report-draft.js).
 *
 * A cm VALUE, though, reads back on either dataset — since widget value sources phase 1 it is
 * a legal pick on a delivery widget, and `mintValue` spells it by its CM name there too. So the
 * CM reading is asked for whenever the value's own `source` is cm, or the widget is a CM360 one
 * (where the bq half is join-fed and carries the CM name as well).
 */
export function entryOf(value, datasetType) {
  if (!value || typeof value !== 'object') return null;
  if (value.kind === 'canonical') {
    return CATALOG.find((e) => e.kind === 'canonical' && e.key === value.key) || null;
  }
  if (value.kind !== 'metric') return null;
  if (value.source !== 'cm' && datasetType !== 'deliveryCm360') {
    return CATALOG.find((e) => e.kind === 'metric' && e.key === value.metric) || null;
  }
  return CATALOG.find((e) => e.kind === 'metric' && (e.cmName || e.key) === value.metric)
    || CATALOG.find((e) => e.kind === 'metric' && e.key === value.metric)
    || null;
}

/**
 * familyOf(value, spec) → the unit families a STORED value can show, de-duplicated.
 *
 * A list, not one family, because a bound value spans its switch's options — which is the
 * set every rule that reads a family already works on (the axis rules, the format check,
 * the cumulative refusal, the pie's summability). One fixed value answers with one entry;
 * an unresolvable bound value answers with none, and the caller draws nothing rather than
 * assuming a unit.
 *
 * It READS `unitFamily`, it never re-derives it (the P2 global constraint): the client
 * stamped the family when it minted the value and the server checked it, so a value that
 * says `impressions` in the money family answers money — and the refusal that follows names
 * the real fault instead of a symptom.
 */
export function familyOf(value, spec) {
  if (!value || typeof value !== 'object') return [];
  if (value.kind !== 'bound') {
    return UNIT_FAMILIES.includes(value.unitFamily) ? [value.unitFamily] : [];
  }
  const controls = spec && Array.isArray(spec.controls) ? spec.controls : [];
  // The FIRST metric control, which is report-render's own read (`metricControl`). Table C
  // caps a spec at one, so the two can only differ on a DRAFT mid-edit — and there the tile
  // beside the picker is drawn by the renderer, so a second idiom would grey out a family the
  // reader can see on screen. (The grammar's `optionValues` sweeps to the last; on the valid
  // spec it judges, there is only one.)
  let ctl = null;
  for (const c of controls) if (c && c.type === 'metric') { ctl = c; break; }
  if (!ctl || !Array.isArray(ctl.options)) return [];
  const out = [];
  for (const opt of ctl.options) {
    const fam = opt && opt.value && opt.value.unitFamily;
    if (UNIT_FAMILIES.includes(fam) && !out.includes(fam)) out.push(fam);
  }
  return out;
}

/**
 * The namebuilder dimensions a widget axis may name, plus `channel`.
 *
 * The SAME eleven `dash-gate/lib/widgets-validate.mjs` accepts, in its order —
 * `tests/metric-catalog-test.mjs` pins this list against that literal. `channel` belongs
 * because it is a property of the line item (normalize.js) rather than a split of the
 * facts: it was added to the editor and the maths on 2026-08-11 and NOT to the server,
 * so a channel axis could be picked, drawn, and never saved — every settings save from
 * that drawer answered `bad_widgets`.
 */
export const DIM_KEYS = Object.freeze([
  'audience', 'tactic', 'platform', 'comment', 'geo', 'creative', 'message', 'keyword',
  'flight', 'language', 'channel',
]);

/** The words this product already prints for those dimensions — the Breakdown panel's own
 *  table (`LineItemList/Breakdown.jsx`), which is where a reader has seen them; pinned to it
 *  by source text, because that file is a React module a pure one may not import. */
export const DIM_LABELS = Object.freeze({
  __proto__: null,
  audience: 'Audience', tactic: 'Funnel', platform: 'Platform', comment: 'Comment',
  geo: 'Geo', creative: 'Creative (tag)', message: 'Message', keyword: 'Keyword',
  flight: 'Flight', language: 'Language',
  // Not in that table: channel is not a namebuilder dim and has never had a breakdown.
  channel: 'Channel',
});

/**
 * The two AUX pipelines a breakdown can be cut by (section-widget parity 2026-09-04) — the
 * legacy Breakdown panel's `Creative (asset)` and `Conversion Action` tabs, which are the only
 * two of its twelve that read a file of their own rather than `liSplitDaily`:
 * `creatives.json` (the DSP's own creative, `data.fetch_creatives`) and `conversions.json`
 * (the conversions mart, `data.fetch_conversions`).
 *
 * A CLOSED list, not a shape like `ds:`: both names are code — `widget-data.js` writes a
 * bucket source per pipeline — so a third one is a code change, not config. And deliberately
 * outside `DIM_KEYS`, which is also the scope FILTER's vocabulary: it runs against factsDaily,
 * where no fact carries a creative asset or a conversion action, so a scope naming one could
 * only ever match nothing (`widgets-validate.mjs:295` states the same rule for `ds:`).
 *
 * `note` is the second line the legacy tab carries (`DIM_SUBLABELS` in Breakdown.jsx), which is
 * the one place a reader learns that «Creative (tag)» and «Creative (asset)» read different
 * data. Null-prototype, so `constructor` names no dimension.
 */
export const AUX_DIMS = Object.freeze({
  __proto__: null,
  'aux:creative': Object.freeze({ label: 'Creative (asset)', note: 'from DSP' }),
  'aux:conversion': Object.freeze({ label: 'Conversion Action', note: 'from conversions mart' }),
});

/** The two keys, in the order the legacy panel offers them. */
export const AUX_DIM_KEYS = Object.freeze(Object.keys(AUX_DIMS));

/** The second line under a built-in dimension's name, or null. `DIM_SUBLABELS` in the legacy
 *  Breakdown panel, which is where a reader has met these words. `tactic` says what its values
 *  look like; `creative` says where they come from, which is what tells it apart from the aux
 *  cut above. */
export const DIM_NOTES = Object.freeze({
  __proto__: null,
  tactic: 'Prospecting / Retargeting / …',
  creative: 'from planner / namebuilder',
});

/** The row grains a table runs down, and the two a chart's X may take. A grain is not a
 *  dimension, and the slot decides
 *  which of them it can offer — `kind` is what lets it filter. */
const GRAINS = Object.freeze([
  Object.freeze({ key: 'date', label: 'Date' }),
  Object.freeze({ key: 'li', label: 'Line item' }),
  Object.freeze({ key: 'dateLi', label: 'Date × line item' }),
]);

const DIM_SOURCE_ID_RE = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * «This pacing has no Funnel values» — said by the BUILDER's dimension pickers, where it is
 * the reason a row cannot be picked, and by a v2 TILE, where it is the reason a view drew
 * nothing (M4: a dimension switch's options travel with the widget, so landing on a pacing
 * that lacks one is the expected end of that portability, not a fault).
 *
 * One author, because it is one sentence in two places: two spellings would read as two
 * different facts to somebody who met both.
 */
export const noDimValues = (label) => `This pacing has no ${label} values`;


/**
 * The other half of the same answer: the pacing HAS the dimension, and every row of it
 * carries the same value, so the axis would draw one slice and say nothing.
 *
 * `channel`'s own refusal one function over says the same thing about bars; this is the
 * sentence for `tactic` and `platform`, which is the shape they have on most pacings.
 * The value is named because it is the useful half: «one slice» is a rule, «Prospecting»
 * is what the reader would have been looking at.
 */
export const oneDimValue = (value) => `Every line item on this pacing is “${value}”, so this axis would draw one slice`;

const NO_SPLITS = Object.freeze({});

/**
 * One walk over `availableSplits` for the one question left since the sections cutover: the
 * distinct VALUES per dimension, placeholders dropped. (It used to answer a second — which
 * dimensions the refresh had written a line item under — for `dimsWorthACut`, and that reader
 * went with the flow-tile predicate.)
 *
 * `liIds`, when given, restricts the walk to those line items.
 */
function walkInventory(splits, liIds) {
  const values = new Map();
  for (const k of Object.keys(splits)) {
    const dim = String(k).split(':')[0];
    if (!values.has(dim)) values.set(dim, new Set());
    const set = values.get(dim);
    const bucket = splits[k];
    // `{ [liId]: [values] }` is what the refresh writes; a bare array is what a hand-written
    // fixture sometimes carries. Both answer the one question this asks — and a bare array
    // names no line item, so `liIds` cannot narrow it.
    let lists;
    if (Array.isArray(bucket)) lists = bucket.length > 0 ? [bucket] : [];
    else if (bucket && typeof bucket === 'object') {
      const ids = Object.keys(bucket);
      lists = (liIds ? ids.filter((id) => liIds.has(id)) : ids).map((id) => bucket[id]);
    } else lists = [];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const v of list) {
        const val = v == null ? '' : String(v).trim();
        if (val && val !== '-') set.add(val);
      }
    }
  }
  return { values };
}

// One walk per inventory OBJECT. `availableSplits` is a store slice replaced only on load, so
// its identity is a safe key — and `dimValues` / `dimsWithValues`, the two readers left since
// the sections cutover, are asked from render paths over a map that can hold thousands of
// values. The record is SHARED: read it, never write it.
const INVENTORY_CACHE = new WeakMap();

function inventoryOf(availableSplits) {
  const splits = availableSplits && typeof availableSplits === 'object' ? availableSplits : NO_SPLITS;
  const hit = INVENTORY_CACHE.get(splits);
  if (hit) return hit;
  const built = walkInventory(splits, null);
  INVENTORY_CACHE.set(splits, built);
  return built;
}

/**
 * The VALUES each dimension carries on this pacing, from `availableSplits` — the per-line-item
 * inventory the refresh writes into `<slug>.json`, keyed `dim` (or, defensively, `dim:container`,
 * so the base key is the dimension).
 *
 * CONTENT, never keys. The builder initialises every bucket, so a key is present on every
 * pacing whether or not anything delivered under it, and reading presence-by-key is what made
 * all eight namebuilder chips appear everywhere while `tactic` and `platform` — dimensions with
 * no bucket until 2026-09-03 — could not appear at all.
 *
 * `''` and `'-'` are not values: `'-'` is the delivered placeholder for "no value", the same
 * rule `detectAvailDims` and `dimTaggedDelivery` apply on the facts side.
 *
 * @param {object} availableSplits the inventory.
 * @param {Iterable<string>} [liIds] read only these line items. The inventory is NOT restricted
 *   to `planByLineItem` — a BQ line item with no plan row still gets a bucket entry — so a
 *   caller whose other half is scoped to the plan (dimensionEntries) has to scope this one too,
 *   or it names a value no plan line carries.
 * @returns {Map<string, Set<string>>} dimension key → its distinct values. Treat as read-only:
 *   the unrestricted answer is cached and shared.
 */
export function dimValues(availableSplits, liIds) {
  const ids = liIds ? new Set(liIds) : null;
  if (!ids || ids.size === 0) return inventoryOf(availableSplits).values;
  const splits = availableSplits && typeof availableSplits === 'object' ? availableSplits : NO_SPLITS;
  return walkInventory(splits, ids).values;
}

/** The dimensions this pacing carries at all: a bucket with at least one value. */
export function dimsWithValues(availableSplits) {
  const out = new Set();
  for (const [dim, vals] of inventoryOf(availableSplits).values) if (vals.size > 0) out.add(dim);
  return out;
}

/**
 * The client mirror of `widgets-validate.mjs`'s `checkDimKey` (:191-216) — the injected
 * `ctx.checkDimKey` the draft validator hands `normReport`, answering with the SAME verdict
 * and the same sentence the server would give, minus its `widget <id>: ` prefix.
 *
 * The rule, both halves:
 *   · a plain key must be one of DIM_KEYS;
 *   · a `ds:<sourceId>:<dimKey>` axis is checked on its SHAPE — three parts, and on both
 *     halves the charset `dim-sources.mjs` enforces on a stored id, which is what stops a
 *     crafted id (`ds:../etc:x`) reaching a lookup;
 *   · a CATALOGUED source is then strict on its dimension: that dimension is code, not user
 *     input, so it cannot go missing under a stored widget. This is the drift guard between
 *     the server's DIM_SOURCE_CATALOG and the client's DIM_SOURCE_AXES;
 *   · a PER-PACING source is judged on its shape alone (spec 2026-08-11 §6.3). Neither the
 *     source nor the dimension has to exist: SettingsDrawer sends every widget with every
 *     settings save, so a widget refused here would fail EVERY save from that drawer — and
 *     removing a breakdown, or sharing a layout, has to stay possible.
 *
 * `catalog` is injectable so the strict half can be exercised past today's single entry;
 * it defaults to the client's own DIM_SOURCE_AXES, whose entries carry the dimension key
 * as `dim` (the server's carry it as `dim.key`).
 */
export function checkDimKey(where, key, opts) {
  const catalog = (opts && opts.catalog) || DIM_SOURCE_AXES;
  // The two aux pipelines, judged against their closed list — the server's own arm.
  if (typeof key === 'string' && key.startsWith('aux:')) {
    if (!hasOwn(AUX_DIMS, key)) return { ok: false, detail: `unknown ${where} aux dim "${key}"` };
    return { ok: true, key };
  }
  if (typeof key !== 'string' || !key.startsWith('ds:')) {
    if (!DIM_KEYS.includes(key)) return { ok: false, detail: `unknown ${where} dim "${key}"` };
    return { ok: true, key };
  }
  const parts = key.split(':');
  if (parts.length !== 3 || !DIM_SOURCE_ID_RE.test(parts[1]) || !DIM_SOURCE_ID_RE.test(parts[2])) {
    return { ok: false, detail: `malformed ${where} dimension-source key "${key}"` };
  }
  // Own-key checked, like the server's `catalogEntry`: 'constructor' names no source, and a
  // bare index read would let it answer for one.
  const entry = hasOwn(catalog, parts[1]) ? catalog[parts[1]] : null;
  if (!entry) return { ok: true, key };
  if (!entry.dim) {
    return { ok: false, detail: `${where} dimension source "${parts[1]}" carries no dimension` };
  }
  if (parts[2] !== entry.dim) {
    return { ok: false, detail: `${where} source "${parts[1]}" carries dimension "${entry.dim}", not "${parts[2]}"` };
  }
  return { ok: true, key };
}

/**
 * Does an aux file carry a row for a line item on this pacing? The legacy panel's own
 * presence-as-signal test (Breakdown.jsx: creatives / conversions with ≥1 row matching the LI
 * set), and it is deliberately not "the array is non-empty": the file is per pacing, but a
 * widget's picker is asked about the lines in the plan.
 */
function auxRowsPresent(rows, liPlan) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const ids = new Set(Object.keys(liPlan || {}));
  if (ids.size === 0) return false;
  for (const r of rows) if (r && ids.has(String(r.line_item_id))) return true;
  return false;
}

/**
 * dimensionEntries(store) → the grains and dimensions a Rows / X / Slice-by picker offers,
 * each with whether this pacing HAS it and, when it does not, why.
 *
 * `store` is the dashboard store (or a slice of it) — `availDims`, `availableSplits`,
 * `liPlan`, `dimSources` and `dataConfig` — read here rather than through a hook, so the same
 * list serves a host test.
 *
 * WHAT DECIDES AVAILABILITY: `availDims`, the shared rule (`selectors.js:selectAvailDims`,
 * which is the legacy Breakdown panel's `detectAvailDims` over the whole pacing). A caller
 * with no store — a pure one, a fixture — falls back to the CONTENT of `availableSplits`,
 * never to its keys: the builder initialises every bucket, so key presence said "yes" for
 * eight namebuilder dimensions on every pacing and "no" for `tactic` and `platform` on all
 * of them, which is how the Funnel axis went missing from a product that draws Funnel tabs.
 *
 * Canonical picker rules:
 *   · a dim with no values is LISTED with its reason, not dropped. Dropped, the reader has
 *     no way to ask why the axis they wanted is gone (§1.1.3);
 *   · the grains come with it, so one call fills a Rows picker.
 *
 * A dimension SOURCE contributes an axis only once its file has been READ — that is
 * `dimSourceAxisOptions`' own rule, and offering an unread source's axis builds a widget on
 * rows that are not there.
 */
export function dimensionEntries(store) {
  const s = store && typeof store === 'object' ? store : {};
  const splits = s.availableSplits && typeof s.availableSplits === 'object' ? s.availableSplits : {};
  const liPlan = s.liPlan && typeof s.liPlan === 'object' ? s.liPlan : {};
  const configured = s.dataConfig && Array.isArray(s.dataConfig.dim_sources) ? s.dataConfig.dim_sources : null;

  // What each dimension actually carries. Two jobs: the content fallback for a caller with
  // no `availDims`, and — when the rule says an axis is not available — NAMING the single
  // value that made it so, which is the difference between a rule and an answer.
  //
  // Read over the PLAN's line items, because that is the set `availDims` is computed over
  // (selectors.js: `Object.keys(liPlan)`). The inventory is not scoped to `planByLineItem`,
  // so a BQ line item with no plan row would otherwise let the refusal and its reason
  // disagree: «no Geo values» while the inventory holds two, or a named value no plan line
  // carries. An empty plan means nothing is loaded, and then nothing is narrowed either.
  const values = dimValues(splits, Object.keys(liPlan));
  // The shared rule's answer, when the caller has it. A Set from the selector; an array is
  // accepted so a fixture can write one.
  const availDims = s.availDims instanceof Set ? s.availDims
    : (Array.isArray(s.availDims) ? new Set(s.availDims) : null);
  // Channel needs no split — it is on the plan. Offered whenever more than one line item
  // would not collapse into a single bar.
  const channels = new Set(Object.values(liPlan).map((p) => (p && p.ch) || 'Unknown'));
  // Nothing read yet is not the same fact as nothing there. On an empty store «this pacing
  // has no Geo values» and «every line item is on one channel» both describe the STORE, and
  // a reader would act on either as if it described the pacing. The rows still exist (the
  // drawer opens before the fetch lands); the sentence is the honest one.
  const loaded = Object.keys(liPlan).length > 0 || values.size > 0;
  const NOT_LOADED = 'The pacing has not loaded yet';

  const out = GRAINS.map((g) => ({
    id: `grain:${g.key}`, key: g.key, label: g.label, note: null,
    kind: 'grain', available: true, reason: null,
  }));

  for (const key of DIM_KEYS) {
    const label = DIM_LABELS[key];
    const vals = values.get(key);
    const has = key === 'channel'
      ? channels.size > 1
      : (availDims ? availDims.has(key) : !!(vals && vals.size > 0));
    let reason = null;
    if (!has) {
      // Zero line items is the channel axis's own unloaded case: it is read off the plan, so
      // an empty plan says nothing about how many channels the pacing runs on.
      if (!loaded || (key === 'channel' && channels.size === 0)) reason = NOT_LOADED;
      else if (key === 'channel') reason = 'Every line item is on one channel, so this axis would draw one bar';
      // The rule refused an axis the pacing DOES carry: one value on all of the delivery.
      // The inventory is read only to NAME it — when it cannot name exactly one, the generic
      // sentence stands rather than a guess.
      else if (vals && vals.size === 1) reason = oneDimValue([...vals][0]);
      else reason = noDimValues(label);
    }
    out.push({
      id: `dim:${key}`,
      key,
      label,
      note: null,
      kind: 'dim',
      available: has,
      reason,
    });
  }

  // The two aux cuts, offered on the dimension SOURCE's rule rather than the namebuilder one:
  // listed only once their file has been read AND carries a row for a line item on this pacing.
  // A pacing with `fetch_creatives` off has no such file at all, and a picker row saying «this
  // pacing has no Creative (asset) values» about a pipeline nobody turned on describes the
  // config, not the delivery.
  for (const key of AUX_DIM_KEYS) {
    const rows = key === 'aux:creative' ? s.creatives : s.conversions;
    if (!auxRowsPresent(rows, liPlan)) continue;
    out.push({
      id: `dim:${key}`, key, label: AUX_DIMS[key].label, note: AUX_DIMS[key].note,
      kind: 'dim', available: true, reason: null,
    });
  }

  for (const [dimKey] of dimSourceAxisOptions(s.dimSources, configured)) {
    const id = dimKey.slice(3, dimKey.indexOf(':', 3));
    const builtIn = hasOwn(DIM_SOURCE_AXES, id) ? DIM_SOURCE_AXES[id] : null;
    const src = !builtIn && configured
      ? configured.find((x) => x && typeof x === 'object' && x.id === id)
      : null;
    out.push({
      id: `dim:${dimKey}`,
      key: dimKey,
      label: dimAxisLabel(dimKey, configured),
      note: builtIn ? builtIn.note : ((src && src.title) || null),
      kind: 'dim',
      // It is here BECAUSE its rows were read — that is what dimSourceAxisOptions answers.
      available: true,
      reason: null,
    });
  }

  return out;
}
