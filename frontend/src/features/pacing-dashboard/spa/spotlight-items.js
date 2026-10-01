// workspace/src/pages/Dashboard/components/Settings/Widgets/Builder/spotlight-items.js
//
// The MAPS the Spotlight shows (widget-builder v2 spec 2026-08-19 §4). The shell
// (`components/ui/Spotlight.jsx`) builds no list of its own: an anchor fixes the
// context and this file answers what that anchor can offer, already judged — the
// enabled rows, the unavailable ones with their reason, and the group each sits in.
//
// Pure: everything arrives as `env`, nothing here reads a store or a hook, so the
// same lists serve the builder and a host test.
//
// §1.1.3 shapes every list: nothing is hidden. A row that cannot be picked HERE is
// still in the map, disabled, carrying the sentence that says why — the shell folds
// those behind «▸ N unavailable here» at rest and shows them inline while searching.
//
// ONE NAMESPACE FOR IDS. The shell keys its rows by `id`, so a name minted into two
// groups drops one of the pair. Every id below is prefixed by the thing it makes
// (`view:chart`), and a new anchor takes a new prefix rather than a new group.
//
// Anchors land task by task: `view` is T5's; `chartx`/`chart`/`series`/`guide` are T6's,
// `table`/`rows`/`column` T7's, `kpi`/`pie`/`piedim`/`target` T8's, `switch`/`source`/
// `control` T9's, and `link` T10's — which also puts Compare on the `view` map.
//
// A map is also what fills a POPOVER's Value select (T8): the same anchor, judged once, is
// rendered as `<optgroup>`s by `optionGroups` in `popovers/rows.jsx`. The select and the
// Spotlight are two doors onto one slot, and two judgings of one slot is how they start to
// disagree about what may be picked.
import { DELTA_ROW_TYPES, ROW_TYPES, X_TYPES } from './report-v2.js';
import { DUAL_SOURCE_ENTRIES, entriesFor, entryOf } from './metric-catalog.js';
import { dimIsNamebuilder, dimKeyPlanEligible } from './widget-data.js';
import { isCmBearing } from './cm-formula-context.js';

/**
 * spotlightItems(anchor, env) → the rows for one anchor, in render order.
 *
 * `env` carries what the anchor needs and nothing else. For `view`, `chartx`, `rows` and
 * `piedim`:
 *   dims   `dimensionEntries(store)` — the grains and dimensions this pacing has, each
 *          with `available` and, when it is not, `reason`.
 *   dimensionControl  the draft's dimension switch, or null. The three grain maps offer a
 *          row that FOLLOWS it (M4), and only the draft knows whether one exists.
 * For the VALUE anchors (`chart`, `series`, `guide`, `table`, `column`) it is the metric
 * catalog's own env — `datasetType`, `grain`, `hasMetricControl` and its optional rule
 * slots — MINUS `anchor`, which this function stamps: the caller names the anchor once, in
 * the argument, and a second spelling inside the env is one to drift from. The `table`
 * anchor takes one more, `deltaRefusal` (below).
 *
 * An anchor nobody has built yet THROWS rather than answering with an empty list: an
 * empty map renders as «this slot offers nothing», which is a sentence about the
 * pacing, and this would be a sentence about the code.
 */
export function spotlightItems(anchor, env) {
  const e = env || {};
  if (anchor === 'view') return viewItems(e);
  if (anchor === 'chartx') return grainItems(e, X_TYPES, 'x', 'X axis');
  // A table's Rows takes ONE more grain than a chart's X: date × line item is table-only
  // (§5.1), and the list that says so is the grammar's, not a filter typed here.
  if (anchor === 'rows') return grainItems(e, ROW_TYPES, 'rows', 'Rows');
  // A pacing calculation is a Guide on its value series (+ Guide), never a series of its own
  // (spec 2026-09-10 «Standalone calculation series»): + Add series offers values only.
  if (anchor === 'chart') return metricItems(e, anchor);
  if (anchor === 'guide') {
    const metrics = metricItems(e, anchor), daily = guideCalcItems(e);
    return daily[1].disabled ? metrics.concat(daily) : daily.concat(metrics);
  }
  if (anchor === 'series') return metricItems(e, anchor);
  // …and a table's `+ Add column` is the only one that also adds a Δ%, for the same
  // reason: a Δ% is a column KIND (Table G), not a value. `column` is that map minus the
  // Δ% row — what a column's VALUE slot may hold — and both judge as the catalog's own
  // `table` anchor, because they fill the same slot on the same rows.
  if (anchor === 'table') return metricItems(e, 'table').concat(deltaItems(e));
  if (anchor === 'column') return metricItems(e, 'table');
  // The two views that hold ONE value. Neither takes a calculation: a Plan/Needed line is a
  // chart series kind, and a value SLOT holds a value. `kpi` refuses nothing — a KPI is one
  // number over the window, which every entry is — while `pie` carries §5.4's own three
  // refusals, and `target` the family of the value it measures. All three are the catalog's
  // to answer; this file only says which anchor to ask it under.
  if (anchor === 'kpi' || anchor === 'pie' || anchor === 'target') return metricItems(e, anchor);
  // …and the dimension a pie is cut by (§5.4). Dimensions ONLY: a grain is not one, and
  // `checkDim` is what a stored `sliceBy.key` goes through.
  if (anchor === 'piedim') return dimItems(e);
  // A metric switch's OPTIONS (§6): free metric choices, so the catalog refuses nothing on
  // its own here — whether an option is legal depends on the elements that follow the
  // switch, which only the draft knows. The panel asks `validateReportDraft` for that and
  // names the offender in place.
  if (anchor === 'switch') return metricItems(e, anchor);
  // The two rows of §3's Data and Controls, and the only anchors whose map is a fixed list
  // rather than the catalog.
  if (anchor === 'source') return sourceItems(e);
  if (anchor === 'control') return controlItems(e);
  // …and the chart a Compare view's `tupleFocus` may point at (§5.6). Views, not metrics,
  // so the caller hands the list: only the draft knows which of its cards are charts.
  if (anchor === 'link') return linkItems(e);
  throw new TypeError(`spotlightItems: unknown anchor "${String(anchor).slice(0, 24)}"`);
}

/** The pacing's own dimensions — grains are not dimensions, and an unavailable one is
 *  a dimension whose values this pacing does not carry. */
const dimsOf = (env) => (Array.isArray(env.dims) ? env.dims : [])
  .filter((d) => d && d.kind === 'dim' && d.available);

const NO_PIE_DIM = 'This pacing carries no dimension to cut a pie by';
/** A compare view reads CM360 beside delivery, and the dataset is the one thing that makes
 *  a widget CM360 (Table H). The words are the brief's: it names the door to press, which
 *  is one chip up in the same window, rather than restating the grammar's rule. */
const CM_FIRST = 'Add the CM360 source first';

/**
 * `+ Add view` (§4's own row: Chart, Table, KPI, Pie, Compare, Layout).
 *
 * The notes are dash-free by the copy rule (§3): `—` is the empty-cell placeholder in
 * this renderer, and a sentence that spends it teaches the reader the wrong thing.
 *
 * The glyph is the shell's `family` badge. A view is not a metric, so each kind takes
 * its own mark rather than inheriting the default `#` — which means "a metric" and
 * would be wrong on four of these five rows.
 *
 * TWO AUTHORS on the Compare row, the split `deltaItems` and `controlItems` already use.
 * Whether it can be picked at all is decided HERE, off the draft's own dataset, so a caller
 * that forgot to ask cannot offer a view the grammar has no shape for. What is refused
 * about the draft the pick would PRODUCE — a metric switch this comparison cannot drive —
 * arrives as `env.compareRefusal`, because that is the grammar's own sentence and a refusal
 * is never re-worded here.
 */
function viewItems(env) {
  const pieDim = dimsOf(env)[0] || null;
  const pie = {
    id: 'view:pie',
    label: 'Pie',
    note: 'Shares of one metric, cut by a dimension',
    family: '◔',
  };
  // A pie is BORN with its slice dimension (`addView` throws without one — guessing it
  // would cut the pie by rows that are not there), so with none to offer the row says so.
  if (!pieDim) { pie.disabled = true; pie.reason = NO_PIE_DIM; }
  const compare = {
    id: 'view:compare',
    label: 'Compare',
    note: 'Delivery beside CM360, by dimension',
    // Two panes side by side, in the same box family as the chart's and the table's mark.
    // NOT `⇄`, which means «this follows the metric switch» everywhere else in this window.
    family: '◫',
  };
  const compareWhy = env.datasetType !== 'deliveryCm360' ? CM_FIRST : (env.compareRefusal || null);
  if (compareWhy) { compare.disabled = true; compare.reason = compareWhy; }
  const layout = {
    id: 'view:layout',
    label: 'Layout',
    note: 'Rows, columns and typed blocks',
    family: '▦',
  };
  if (env.layoutRefusal) { layout.disabled = true; layout.reason = env.layoutRefusal; }
  return [
    { g: 'Views' },
    // Each note fits ONE line of a Spotlight cell (measured at the shell's 215px column):
    // a note that truncates loses the half that names the third thing the view can do.
    { id: 'view:chart', label: 'Chart', note: 'Series by date, line item or dimension', family: '▤' },
    { id: 'view:table', label: 'Table', note: 'Rows by date, line item or dimension', family: '▦' },
    { id: 'view:kpi', label: 'KPI', note: 'One number, with an optional target', family: '#' },
    pie,
    compare,
    layout,
  ];
}

/**
 * The second question a Pie pick opens (the shell's `step`): which dimension cuts it.
 *
 * Only the dimensions this pacing HAS — a step has no disabled row and no reason slot,
 * and the `view` row above already carries the honest answer for "none of them". The
 * key rides along on the option so the mutator gets it back from the shell untouched.
 */
export function sliceByOptions(env) {
  return dimsOf(env || {}).map((d) => ({ id: d.id, label: d.label, key: d.key }));
}

/* ── the two grain maps (§4's `Chart X:` and `Table Rows:` chip rows) ─────── */

/**
 * `X: Date | Line item | <dim>` (§5.1) and `Rows: … | Date × line item | <dim>` (§5.2).
 * ONE function, because they are one question asked over two vocabularies: the GRAINS the
 * grammar allows in that slot, then the DIMENSIONS this pacing carries.
 *
 * `types` is the grammar's own list — `X_TYPES` or `ROW_TYPES` — rather than a filter typed
 * here, which is what keeps `dateLi` off the chart's axis and on the table's rows without
 * either list being restated. `dimensionEntries` offers all three grains, because a Rows
 * picker takes all three.
 *
 * Unavailable dimensions are LISTED with their reason (§1.1.3), unlike the pie's second
 * step, which has no reason slot to carry one.
 */
function grainItems(env, types, prefix, group) {
  const all = Array.isArray(env.dims) ? env.dims : [];
  const out = [{ g: group }];
  for (const d of all) {
    if (d && d.kind === 'grain' && types.indexOf(d.key) !== -1) out.push(axisRow(d, `${prefix}:${d.key}`));
  }
  const dims = all.filter((d) => d && d.kind === 'dim');
  if (dims.length) out.push({ g: 'Dimensions' });
  for (const d of dims) out.push(axisRow(d, `${prefix}:dim:${d.key}`));
  if (types.indexOf('control') !== -1) out.push(...switchRow(env, `${prefix}:control`));
  return out;
}

/** «Follows the dimension switch» — the one row on a grain map that is not a dimension but a
 *  CONTROL (M4). Listed even when the report has no such switch, with the reason, because a
 *  door the reader cannot see is a feature they cannot find (§1.1.3); the reason names the
 *  chip to press, one section up in the same window. */
const NO_DIM_SWITCH = 'This Widget has no dimension switch; add one in Controls';
function switchRow(env, id) {
  const ctl = env.dimensionControl || null;
  const row = { id, label: ctl ? (ctl.label || 'Dimension switch') : 'The dimension switch', family: '⇄' };
  row.note = ctl
    ? 'The viewer picks the cut; every view that follows it moves together'
    : 'The viewer picks the cut, out of the dimensions you offer';
  if (!ctl) { row.disabled = true; row.reason = NO_DIM_SWITCH; }
  return [{ g: 'Controls' }, row];
}

/**
 * `Slice by: <dim>` (§5.4) — the pacing's dimensions, and nothing else.
 *
 * The grain half of `grainItems` is deliberately absent rather than filtered: a pie is cut
 * by a `sliceBy.key`, which `checkDim` resolves against the pacing's dimensions, so «Date»
 * is not a shape the grammar has here. Unavailable ones are LISTED with their reason
 * (§1.1.3), unlike `+ Add view`'s own second step, which has no reason slot to carry one.
 */
function dimItems(env) {
  const all = Array.isArray(env.dims) ? env.dims : [];
  const out = [{ g: 'Dimensions' }];
  for (const d of all) if (d && d.kind === 'dim') out.push(axisRow(d, `piedim:${d.key}`));
  // …and the same «follows the dimension switch» row the other two grain maps carry. A pie
  // is cut by one dimension like they are; the only difference is that it stores no `type`.
  out.push(...switchRow(env, 'piedim:control'));
  return out;
}

/** One axis row. `▦` is the shell's dimension glyph: an axis is not a metric, and `#`
 *  — the default — would say it is. */
function axisRow(d, id) {
  const row = { id, label: d.label, note: d.note || null, family: '▦' };
  if (!d.available) { row.disabled = true; row.reason = d.reason || null; }
  return row;
}

/* ── the value anchors (§4's grouped map) ─────────────────────────────────── */

/** §4's own group names, over the keys the catalog files its entries under. The catalog
 *  answers WHICH entries and in what order; these are the words the map prints over them.
 *  Exported because the series popover's Value select groups the SAME catalog the same way,
 *  and two spellings of «Plan & pacing» would read as two different shelves. */
export const GROUP_LABEL = {
  __proto__: null,
  delivery: 'Delivery', money: 'Money', rates: 'Rates',
  plan: 'Plan & pacing', calc: 'Calculations & comparisons',
};
/** What the source pill says, per source — the two words the builder's Data chips already
 *  wear, so one pill means one thing across the window. */
const SOURCE_PILL = { __proto__: null, bq: 'BQ', cm: 'CM' };
/** …and the whole phrase, on the second step, where the pill alone would not say which
 *  dataset it means. */
const SOURCE_LABEL = { __proto__: null, bq: 'BQ · Delivery', cm: 'CM · CM360' };

/**
 * The metric catalog as a grouped map: every ENTRY, in the catalog's own order, each with
 * the catalog's verdict on whether it can be picked HERE (§1.1.3 — never a shorter list of
 * metrics; their source chips are a separate question, and since 2026-09-02 that list does
 * shorten — `sourceOptions` below owns the rule and the reason).
 *
 * The `anchor` is stamped onto the env here rather than read out of it, so the caller names
 * the slot once. Everything else — the grain, the dataset, the axis families a series pick
 * has to fit between — arrives from the caller because only the draft knows it.
 */
function metricItems(env, anchor) {
  const judged = entriesFor({ ...env, anchor });
  const out = [];
  let group = null;
  for (const { entry, available, reason } of judged) {
    if (entry.group !== group) {
      group = entry.group;
      out.push({ g: GROUP_LABEL[group] || group });
    }
    const row = {
      id: entry.id,
      label: entry.label,
      note: entry.tip || null,
      // Every source the metric has that THIS PACING is in conversation with (owner ruling
      // 2026-09-02, and spec 2026-08-25 §4) — the CM one muted, with the reason, on the rungs
      // between «configured» and «ready»; absent entirely on a pacing that has no CM360, where
      // a permanent grey chip on the three most-used metrics advertised a feature instead of
      // describing this pacing. «+ Add source» is where that advertisement belongs.
      //
      // NO `held` HERE, and that is not an omission: the map judges what a NEW pick can read,
      // and a pick has no source yet. What source a STORED value already reads is a different
      // question, and the Source row is where it is asked — that surface passes `held`, which
      // is why a value drawing from CM360 keeps its chip after the config is gone while the
      // map beside it stops offering CM360 to anything new.
      chips: sourceOptions(entry, { ...env, anchor }).map((o) => ({
        id: o.source,
        label: SOURCE_PILL[o.source],
        off: !!o.disabled,
        title: o.reason || null,
      })),
    };
    if (!available) { row.disabled = true; row.reason = reason; }
    out.push(row);
  }
  return out;
}

/* ── which sources a value may be read from HERE (spec 2026-08-25 §4) ─────── */

/** Set up, but nothing has landed yet: a fetch that has not run, or ran and found nothing.
 *  The FIRST thing a cm chip can say, because a pacing with no CM360 at all shows no chip —
 *  it is out of the conversation, and `sourceOptions` drops the source rather than muting it
 *  (owner ruling 2026-09-02). There is no «CM360 is not set up on this pacing» sentence any
 *  more: nothing asks the question on a pacing that could be answered with it. */
export const CM_NO_DATA = 'CM360 data is not loaded yet';
/** …and the D1 rule (spec §3): a cm value always reads through a resolved mapping, so its
 *  numbers agree with the Compare view's everywhere. Worded off `CM_NO_MAPPING`, the
 *  precedent this window already prints for the CM360 SOURCE, with the tail moved from the
 *  widget to the value — here it is one number that reads through the join, not a dataset. */
export const CM_VALUE_NO_MAPPING = 'This pacing has no dimension mapping yet, and a CM360 value reads its rows through one';
/** §5.4 and the grammar's own pie rail (`normPieView`: «a CM360 number, grouped by the
 *  mapping dimensions and not by this one»), which refuses a cm value on EITHER dataset.
 *  A slot rule, not a pacing fact — so it answers before the three above. */
export const CM_NO_PIE = 'A pie cuts one delivery total into shares, and a CM360 number is grouped by the mapping dimensions';

/**
 * Does this VALUE read CM360? Two shapes, one word for the chip (§2.10):
 *   · a `cm` METRIC says so on the value;
 *   · a FORMULA says so in its identifiers, which is why a formula carries no `source` key
 *     and never gained one.
 * Every card asks it about the row it is drawing. It lives here, beside the rest of the
 * builder's value rules, because a chip that disagreed with the sentence under it, or with
 * the header the tile draws (`nameColumns`), is the product telling one author two things.
 */
export const valueReadsCm = (value) => !!value && typeof value === 'object'
  && ((value.kind === 'metric' && value.source === 'cm') || isCmBearing(value.expr));

/**
 * cmRefusal(env) → why a cm value cannot be read HERE, or null when it can.
 *
 * Two altitudes, outermost first, the order `reasonFor` reads by: the SLOT (a pie cuts
 * delivery, whatever the pacing carries), then what this PACING can serve.
 *
 * On a `deliveryCm360` widget the pacing half is not asked at all: the dataset IS the CM360
 * source, its config and mapping were settled when the source was added (`sourceItems` below
 * refuses the add without a mapping), and a tile that then finds nothing to join says so
 * through the comparison's own fourteen-state ladder rather than through a picker. Asking
 * again here would refuse picks on a widget that has always taken them.
 *
 * `env`:
 *   datasetType   the widget's dataset
 *   anchor        the slot being filled — the pie is the one that refuses cm outright
 *   sourceFacts   the store's own `{cm360: {configured, present, row_count}}`, or absent
 *   mappings      `store.mappingsV3` — D1: a cm value reads through a resolved mapping
 *   held          the source this slot ALREADY reads, when it reads one
 *
 * An env that carries no facts refuses cm on a delivery widget, which is exactly what the
 * builder did before this existed: a caller that knows less is safe rather than wrong.
 */
export function cmRefusal(env) {
  const e = env || {};
  if (e.anchor === 'pie') return CM_NO_PIE;
  // The value already reads CM360. A picker that refuses the source a stored value is
  // drawing from would silently re-mint it onto the delivery side on the next edit — a
  // different number, from an edit that was about something else.
  if (e.held === 'cm') return null;
  if (e.datasetType === 'deliveryCm360') return null;
  const cm = (e.sourceFacts && e.sourceFacts.cm360) || null;
  // UNREACHABLE through `sourceOptions`, which is the only caller: every way to be in
  // conversation with CM360 either short-circuits above or means `configured` is true. Kept
  // as a defensive answer for a future caller that asks cmRefusal directly, skipping the
  // conversation gate — such a caller gets the muted rung, so it fails visible-safe rather
  // than by crashing or by minting a cm value on a pacing that has no CM360 to read.
  if (!cm || !cm.configured) return CM_NO_DATA;
  if (!cm.present || !(Number(cm.row_count) > 0)) return CM_NO_DATA;
  if (!dimensionMappings(e.mappings).length) return CM_VALUE_NO_MAPPING;
  return null;
}

/**
 * The two keys of the builder `env` that every value map and every second step has to carry
 * TOGETHER — «is there CM360 data» and «is there a mapping to read it through» are two halves
 * of one verdict, and a surface that passed one of them would refuse or allow by half a rule.
 * Spread into a pick env (`{...sourceEnv(env), datasetType, …}`) so the pair travels as a pair.
 */
export const sourceEnv = (env) => ({
  sourceFacts: (env && env.sourceFacts) || null,
  mappings: (env && env.mappings) || null,
  // The mart-metrics inventory (spec 2026-09-08 §3.6); undefined when the env has none, so
  // the catalog's rule stays silent rather than calling every pacing «not built».
  ...(env && Object.prototype.hasOwnProperty.call(env, 'availableMetrics') ? { availableMetrics: env.availableMetrics } : {}),
});

/**
 * May a value on THIS dimension grain carry a plan (plan metrics on dim rows, 2026-09-12)?
 *
 * One question, asked the same way by the column map, the series map and the formula palette,
 * so an author cannot be offered a field in the Spotlight that the select beside it refuses.
 *
 * A dimension SWITCH has no key while the widget is being authored — the viewer chooses it —
 * so the answer is «yes if any option it could land on is declared». Landing on one that is
 * not prints em dashes with the tile's own note, which is the same graceful degradation a
 * Library widget needs anyway: it is validated with no pacing in hand and will arrive on
 * pacings that declare nothing.
 */
export function dimPlanEnv(env, dimKey, dimensionControl) {
  const declared = env && env.declaredDims;
  if (!declared || declared.size === 0) return false;
  if (typeof dimKey === 'string' && dimKey) return dimKeyPlanEligible(declared, dimKey);
  if (!dimensionControl) return false;
  // An AUTO switch resolves its options at render, and `autoDimensionOptions` deliberately
  // appends every dimension source and the two aux cuts — none of which can carry a plan at
  // all. So the answer is no: offering the plan half here would hand the viewer a column that
  // turns into a refusal the moment they pick one of those.
  if (dimensionControl.optionsAuto) return false;
  // A stored switch is answerable, and the bar is EVERY option rather than any: a viewer who
  // lands on an option that cannot carry a plan must not meet a dead column. An option that is
  // a namebuilder dimension but undeclared is fine — it prints em dashes, which is the same
  // graceful degradation a Library widget needs anyway.
  const options = dimensionControl.options || [];
  if (options.length === 0) return false;
  return options.every((k) => dimIsNamebuilder(k)) && options.some((k) => dimKeyPlanEligible(declared, k));
}

/**
 * Every source this entry carries that this PACING is even in conversation with, each judged
 * for THIS slot — `[{source, disabled, reason}]`. The pill row and the second step are both
 * built from it, so what the map shows muted and what the step refuses are one judgement.
 *
 * ONE source is dropped from the list rather than muted (owner ruling 2026-09-02): cm on a
 * pacing with NO CM360 configured. §1.1.3's «show it muted with the reason» is for a choice
 * the author is one step away from; on a pacing that has never touched CM360 the grey chip is
 * a permanent advertisement on the three most-used metrics, and the advertisement already
 * lives where it belongs — «+ Add source» names CM360 in the Data row. From the moment CM360
 * IS configured the chip appears and walks the author through its own ladder (data loading,
 * then the mapping) — hiding it mid-setup would make it blink. A value that already READS cm
 * keeps its chip whatever the facts say (`held`, cmRefusal's first answer): a stored source
 * must never vanish from under its own value.
 */
export function sourceOptions(entry, env) {
  const e = env || {};
  const list = entry && Array.isArray(entry.sources) ? entry.sources : [];
  const cmFacts = (e.sourceFacts && e.sourceFacts.cm360) || null;
  // «In conversation»: the widget reads CM360 by dataset, this value already reads it, or
  // the pacing has it configured. Anything else hides cm entirely — slot reasons included,
  // because a sentence about what a pie does with CM360 is noise on a pacing that has none.
  const inConversation = e.held === 'cm' || e.datasetType === 'deliveryCm360'
    || !!(cmFacts && cmFacts.configured);
  return list.map((source) => {
    if (source !== 'cm') return { source };
    if (!inConversation) return null;
    const why = cmRefusal(e);
    return why ? { source, disabled: true, reason: why } : { source };
  }).filter(Boolean);
}

/** …and the ones that can actually be PICKED — what a caller mints from, so a source this
 *  pacing cannot serve is refused before `mintValue` is ever handed it. */
export function sourcesFor(entry, env) {
  return sourceOptions(entry, env).filter((o) => !o.disabled).map((o) => o.source);
}

/* ── the calculated Guide ────────────────────────────────────────────────── */

/**
 * `normSeries`'s own refusal, restated dash-free — the catalog's rule for every sentence it
 * shows in the map (`—` is this product's empty-cell placeholder and the copy rule keeps it
 * for that). The grammar refuses the SAVE; this refuses the pick.
 */
const NO_PLAN_ON_CM = 'Pacing calculations are delivery pacing maths, and a CM360 Widget carries no plan';

/**
 * The ONE calculation the `+ Guide` door offers (spec 2026-09-10 «The child»): Expected, the
 * parent series' own plan — Plan / Reforecast is a mode in its settings, and per-day versus
 * cumulative is the parent's accumulate, so the picker names neither.
 */
function guideCalcItems(env) {
  const reason = env.datasetType === 'deliveryCm360' ? NO_PLAN_ON_CM
    : env.grain !== 'date' ? 'A calculated Guide needs a date axis.' : env.guideCalculationRefusal;
  return [{ g: 'Calculated guide' }, { id: 'guidecalc:projection', label: 'Expected',
    note: 'The plan of this series, or its reforecast', family: 'ƒ', ...(reason ? { disabled: true, reason } : {}) }];
}

/* ── the Δ% column (§5.2) ─────────────────────────────────────────────────── */

/**
 * The `Difference %` row of `+ Add column`, in the group the canonical scalars and the §8
 * calculations already share — a Δ% is a comparison, and that is what the group is called.
 *
 * TWO AUTHORS, ON PURPOSE. Whether it can be picked is decided HERE, from the grammar's own
 * two facts (`normColumn`'s delta branch asks the dataset first, then `DELTA_ROW_TYPES`), so
 * a caller that forgot to ask cannot offer a pick that breaks the draft. What the refusal
 * SAYS arrives as `env.deltaRefusal` — the sentence `validateReportDraft` answered with on
 * the very draft this pick would have produced, because a refusal is the grammar's own
 * words and never a second wording of them (P3 ruling).
 */
const DELTA_ROW = {
  id: 'delta:pct',
  label: 'Difference %',
  // Dash-free by the copy rule (§3): `—` is this renderer's empty-cell placeholder.
  note: 'CM360 against delivery, as a share of delivery',
  family: 'Δ',
};

function deltaItems(env) {
  const row = { ...DELTA_ROW };
  const legal = env.datasetType === 'deliveryCm360' && DELTA_ROW_TYPES.indexOf(env.grain) !== -1;
  if (!legal) { row.disabled = true; row.reason = env.deltaRefusal || null; }
  return [row];
}

/**
 * deltaMetricStep(env) → the second question a `Difference %` pick opens: OF WHICH metric.
 *
 *   metricControl  the draft's metric switch, or null. Offered first, as everywhere else.
 *   boundRefusal   the grammar's sentence for a bound Δ% on THIS widget, or null — every
 *                  option of the switch has to be a dual-source field, and only the draft
 *                  knows whether they are. The card asks; this prints what came back.
 *
 * There is no «BQ / CM / Both» here: a Δ% reads BOTH sides by definition, so the source
 * question has one answer and would be a click with no choice in it.
 */
export function deltaMetricStep(env) {
  const e = env || {};
  const out = [];
  if (e.metricControl) {
    const row = { id: 'bound', label: 'Metric switch ⇄', bound: true };
    if (e.boundRefusal) { row.disabled = true; row.reason = e.boundRefusal; }
    out.push(row);
  }
  for (const entry of DUAL_SOURCE_ENTRIES) out.push({ id: entry.id, label: entry.label, entry });
  return out;
}

/* ── the Data row's `+ Add source` (§3, §4) ───────────────────────────────── */

/** The mapping ENTITIES a CM360 report can read its rows through — the panel's own filter
 *  (`ThirdPartyPanel.jsx:202`, `compare-state.js:resolveMappingChoice`), which is also what
 *  a runtime binding resolves against. Exported because the source popover names one and
 *  this map decides whether there is one to name. */
export const dimensionMappings = (mappings) => (Array.isArray(mappings) ? mappings : [])
  .filter((m) => m && m.kind === 'dimensions');

/** Why the one source there is to add cannot be added. Both are facts about THIS pacing and
 *  this draft, not rules of the grammar — so they are worded here, dash-free (§3). */
const CM_TAKEN = 'This Widget already reads CM360';
const CM_NO_MAPPING = 'This pacing has no dimension mapping yet, and a CM360 Widget reads its rows through one';

/**
 * `+ Add source` (§4's own row). ONE row today: the delivery facts are the widget's base and
 * are never added or removed, and CM360 is the only other source a report reads.
 *
 * `env`: `{datasetType, mappings}` — the draft's dataset and `store.mappingsV3`.
 */
function sourceItems(env) {
  const row = {
    id: 'source:cm360',
    label: 'CM360 (via mapping)',
    note: 'The ad server beside delivery, joined by a mapping',
    family: '⊕',
  };
  const why = env.sourceRefusal || (env.datasetType === 'deliveryCm360'
    ? CM_TAKEN
    : (dimensionMappings(env.mappings).length ? null : CM_NO_MAPPING));
  if (why) { row.disabled = true; row.reason = why; }
  return [{ g: 'Sources' }, row];
}

/* ── the Controls row's `+ Add control` (§4, §6) ──────────────────────────── */

/** The five control types (§6, Table C), in the STORED order the list is kept in — so the
 *  map reads in the same order as the chips it adds to. */
const CONTROL_ROWS = [
  { type: 'period', label: 'Period switch', note: 'Viewer chooses the widget’s date range' },
  { type: 'metric', label: 'Metric switch', note: 'Viewer picks the metric; every element that follows it moves' },
  { type: 'breakdown', label: 'Breakdown switch', note: 'Viewer picks which mapping dimensions a comparison is cut by' },
  { type: 'dimension', label: 'Dimension switch', note: 'Viewer picks the dimension a chart, a table or a pie is cut by' },
  { type: 'projection', label: 'Projection switch', note: 'Viewer switches a projection between Plan and Reforecast' },
];
/** Table C's own cap, said as a fact about this report rather than as a rule. */
const TAKEN = {
  __proto__: null,
  period: 'This Widget already has a period switch',
  metric: 'This Widget already has a metric switch',
  breakdown: 'This Widget already has a breakdown switch',
  dimension: 'This Widget already has a dimension switch',
  projection: 'This Widget already has a projection switch',
};

/**
 * `+ Add control` (§4's own row): the five types, always all five, each with why it cannot
 * be added HERE.
 *
 * TWO AUTHORS, the same split `deltaItems` uses. Whether one is already there is decided
 * here, off the draft's own control list — a caller that forgot to ask could otherwise offer
 * a second switch of a type Table C caps at one. What a refusal SAYS about the DATASET or
 * the views arrives as `env.refusals[type]`, because those are the grammar's sentences on
 * the very draft the pick would have produced. The known dataset refusal uses the
 * source's public name in this menu; other reasons pass through unchanged.
 *
 * `env`: `{controls, refusals: {period, metric, breakdown, dimension}}`.
 */
function controlItems(env) {
  const taken = new Set((Array.isArray(env.controls) ? env.controls : [])
    .filter((c) => c && typeof c.type === 'string').map((c) => c.type));
  const refusals = env.refusals || {};
  const rows = CONTROL_ROWS.map(({ type, label, note }) => {
    const row = { id: `control:${type}`, label, note, family: '⇄' };
    const why = taken.has(type) ? TAKEN[type] : (refusals[type] || null);
    if (why) {
      row.disabled = true;
      row.reason = type === 'breakdown' && why === 'a breakdown control picks mapping dimensions; it needs a deliveryCm360 dataset'
        ? 'Requires the CM360 source.' : why;
    }
    return row;
  });
  return [{ g: 'Controls' }, ...rows];
}

/* ── the compare card's `+ Link to chart` (§5.6) ──────────────────────────── */

/** Table H caps a PAIR at one wire — «one wire per pair», not one listener per chart — so
 *  this is a fact about THIS comparison and not a rule about the chart. Worded here for the
 *  same reason `TAKEN` and `CM_TAKEN` are: the grammar's own sentence for a repeat names
 *  the two view IDS, and a row labelled with the chart's NAME may not answer with an id. */
const ALREADY_LINKED = 'This comparison already focuses it';
const CANNOT_ANSWER = 'No series on it follows the comparison; give it a CM or switch-bound series first';

/**
 * `+ Link to chart` — the chart views this report holds, each with why this comparison
 * cannot be wired to it.
 *
 * `env`: `{charts: [{id, label, note}], linked: [viewId]}`. The CALLER resolves all three,
 * because a view's name is the card's own (`viewName`), its note is what it DRAWS — two
 * untitled charts are both called «Chart» — and only the draft knows which cards are charts.
 * An empty map is legal here and is NOT the «unknown anchor» case: a report with no chart is
 * an ordinary report, and the card says so in a sentence rather than opening a door onto
 * nothing.
 */
function linkItems(env) {
  const linked = new Set(Array.isArray(env.linked) ? env.linked : []);
  const charts = Array.isArray(env.charts) ? env.charts : [];
  const rows = charts.map((c) => {
    // `▤` is the chart glyph the `+ Add view` map already wears: these rows ARE chart views.
    const row = { id: `link:${c.id}`, label: c.label, note: c.note || null, family: '▤' };
    if (linked.has(c.id)) { row.disabled = true; row.reason = ALREADY_LINKED; }
    // A chart with no series the focus narrows cannot answer the wire (addView's own rule,
    // chartAnswersFocus) — offered with the reason, never a link that draws nothing.
    else if (c.answers === false) { row.disabled = true; row.reason = CANNOT_ANSWER; }
    return row;
  });
  return [{ g: 'Charts' }, ...rows];
}

/* ── the second step (§4) ─────────────────────────────────────────────────── */

/** «Both sources» adds TWO elements, and each one counts against the cap — so without room
 *  for both it is refused by name. Silently adding one would answer a different question;
 *  hiding the row would leave the reader looking for the option they had read about.
 *
 *  It names the ELEMENTS, so there is one sentence per slot that holds a list: «two series»
 *  on a chart, «two columns» on a table. A cap sentence that named the wrong thing would be
 *  read as being about a different control. */
const BOTH_NEEDS_TWO = {
  __proto__: null,
  chart: (n) => `Both sources adds two series, and this chart has room for ${n}`,
  table: (n) => `Both sources adds two columns, and this table has room for ${n}`,
};
const bothNeedsTwo = (addsTo, free) => (BOTH_NEEDS_TWO[addsTo] || BOTH_NEEDS_TWO.chart)(free === 1 ? 'one' : free);

/**
 * sourceStep(entry, env) → the options of §4's second step, or `null` when there is only
 * one way to add this pick and the question would be a click with no choice in it.
 *
 *   datasetType     the widget's dataset, `sourceFacts` + `mappings` the pacing's own
 *                   answer — together they decide whether `cm` can be picked here
 *                   (`cmRefusal`). Since phase 1 (spec 2026-08-25 §4) this step is
 *                   reachable on a DELIVERY widget too, and mints the same twin pair.
 *   metricControl   the draft's metric switch, or null. The ⇄ option is offered FIRST, and
 *                   only when THIS metric is one of the switch's options (§2 reachability):
 *                   a bound value the switch never lands on is a value that never draws.
 *   freeSlots       how many elements the target still has room for
 *   allowBoth       does this slot hold a LIST? A KPI value and a guide hold one value, so
 *                   «Both sources» is not an answer they have.
 *   addsTo          which list — `chart` or `table`. It decides only the words of the
 *                   «Both sources» cap sentence, which names the elements it would add.
 *
 * Pure, and it decides nothing about what the pick DOES — the card owns the question's
 * wording and the mutation, because only it knows which element is being filled.
 */
export function sourceStep(entry, env) {
  const e = env || {};
  const out = [];
  if (boundReachable(entry, e.metricControl, e.datasetType)) {
    out.push({ id: 'bound', label: 'Metric switch ⇄', bound: true });
  }
  const judged = sourceOptions(entry, e);
  for (const o of judged) {
    const row = { id: `src:${o.source}`, label: SOURCE_LABEL[o.source], source: o.source };
    if (o.disabled) { row.disabled = true; row.reason = o.reason; }
    out.push(row);
  }
  const sources = judged.filter((o) => !o.disabled).map((o) => o.source);
  if (e.allowBoth && sources.length > 1) {
    const both = { id: 'src:both', label: 'Both sources', sources };
    // Only when the caller SAID how much room there is. A missing count is a caller that
    // does not know, and refusing on that would be a sentence about a cap nobody measured.
    if (typeof e.freeSlots === 'number' && e.freeSlots < 2) {
      both.disabled = true;
      both.reason = bothNeedsTwo(e.addsTo, e.freeSlots);
    }
    out.push(both);
  }
  // ASKED on the count of REAL answers, not on the length of the list. A refused CM row is
  // shown where the question is being asked anyway (§1.1.3 — it is the one surface that can
  // carry the whole sentence), but it is not itself a reason to ask: on a pacing that HAS
  // CM360 but has not finished setting it up, every metric pick on every delivery widget
  // would otherwise open a second step whose only pickable answer is the one the click
  // already meant. (On a pacing with no CM360 at all the row is not in the list to begin
  // with — `sourceOptions` drops it — so this filter never sees it there.)
  return out.filter((o) => !o.disabled).length > 1 ? out : null;
}

/**
 * Does the metric switch ever land on this entry? Asked through the catalog's own read-back
 * (`entryOf`), because on a CM360 widget the same entry is stored under its CM name — so
 * «is this option this metric» is not a question about the key.
 */
function boundReachable(entry, control, datasetType) {
  if (!control || !Array.isArray(control.options) || !entry) return false;
  return control.options.some((o) => o && entryOf(o.value, datasetType) === entry);
}
