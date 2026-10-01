import { buildSeriesModel, buildTabularModel, buildCategoryModel, kpiHighlightValue } from './widget-data.js';
import { resolveValue, resolveGrain, valueToExpr, seriesExpr, compositionContext, cmRowJoin, cmMetricsOf } from './report-render.js';
import { evaluateHighlights, highlightExpressions } from './widget-highlights.js';
import { FUNCTIONS } from './widget-formula.js';
import { layoutReading } from './layout-readings.js';
import { isCmBearing, cmPairMarkerOf } from './cm-formula-context.js';
import { cmHighlightOne, cmHighlightSeries } from './cm-highlight-read.js';

const finite = Number.isFinite;
const rowKey = (row, grain) => grain.type === 'date' ? String(row.date)
  : grain.type === 'dateLi' ? `${row.date}|${row.liId}`
    : grain.type === 'li' ? String(row.liId) : String(row.label);
const categoryKey = (row) => row.highlightKey || row.__highlightKey || JSON.stringify([row.label ?? row.x, !!(row.others || row.__others), !!row.residual]);
const uniq = (values) => [...new Set(values.filter((value) => typeof value === 'string' && value))];
const toDefs = (expressions) => expressions.map((expr, i) => ({ id: `highlight_${i}`, expr }));
const unavailableReading = () => null;

/** One highlight expression on one slot, read off the matched pairs: `read(metric)` is the
 *  slot's join and `scalars` the plan half published for it. The rule itself lives in
 *  cm-highlight-read.js, which the Layout block pass reads through too. */
const cmReadFor = (read, scalars) => (expr) => cmHighlightOne(expr, read, scalars);

/**
 * Per EXPRESSION, never per owner (§2.8). A plain `im` column with a `cmIm * 0.9` threshold
 * keeps its BQ value and its BQ guard; only the cm-bearing operand goes to the cm arm, on
 * that row's own join. With no reader a cm-bearing expression is null — the absence answer —
 * rather than falling to the BQ engine, which has no field by these names.
 */
const dispatch = (readCm, readBq) => (expr) => (
  isCmBearing(expr) ? (readCm ? readCm(expr) : null) : readBq(expr)
);

/**
 * …and the one case the OWNER does decide (2026-09-18): on a CM-FED owner every expression is
 * read off the pairs, a delivery one included. The BQ engine cannot describe a cm-fed value's
 * mapped or focused population, which is why such a rule used to read nothing at all; the
 * pair's delivery half CAN, because it is the other half of the very number the owner prints.
 * So «red when cl < 100» beside a CM360 column reads `cl` as `pair.delivery`, on that row's
 * own join. A name the pairs cannot serve (spend, a rate) is null in `cmContext`, and a null
 * operand cannot make a rule match. A flight READING is still the BQ engine's and stays out.
 */
const onPairs = (readCm) => (expr) => (readCm ? readCm(expr) : null);

/** The BQ engine never sees a cm-bearing expression (§2.8): it names fields that engine has
 *  no column for, so compiling it would write «Unknown field "cmIm"» into `colErrors` and
 *  darken a column that draws perfectly well. */
export const bqOnly = (expressions) => expressions.filter((expr) => !isCmBearing(expr));

/** The plan half of one read, off the engine's own published objects (§2.4). A DATE row
 *  prints the window's campaign plan, which is what every date row prints; a DIMENSION row
 *  prints its own, the very object the plan cell beside it was computed from, so the two
 *  cannot disagree. A row that declared nothing reads `absent`, whose scalars are nulls. */
function cmPlanScalars(cmPlan, join) {
  if (!cmPlan) return null;
  if (join.join === 'date') return cmPlan.window?.scalars || null;
  const hit = cmPlan.byKey ? cmPlan.byKey.get(String(join.key)) : null;
  return (hit || cmPlan.absent)?.scalars || null;
}

/** A window function is a claim about a RUN of days, so a cm-bearing expression holding one
 *  is evaluated over the whole axis at once rather than row by row. Regex, not a walk: the
 *  names are DERIVED from `widget-formula.js`'s own `FUNCTIONS` table (the `tsOnly` ones,
 *  reserved names that can only appear as calls) rather than retyped, so a fourth window
 *  function joining the parser is a window function here too, with no second edit. */
const CM_WINDOW_RE = new RegExp(
  `\\b(?:${Object.keys(FUNCTIONS).filter((name) => FUNCTIONS[name].tsOnly).join('|')})\\s*\\(`,
);

/**
 * Window functions inside a cm-bearing highlight on a date grain (§2.8, §2.9).
 *
 * The axis is the one the MODEL published — `cmRowOrder` for a date-rows table, `cmDates`
 * for a chart — so neither the authored sort nor a header click can change what a running
 * total means. The NUMBER is `evaluateMaskedSeries`' own, which is the number the cell beside
 * the rule prints (`cmWindowValues` in report-render.js writes `present[i] ? values[i] :
 * null`): a highlight judges what is on screen. Under holes the two evaluators genuinely
 * disagree — `rolling` here averages the days that joined, while the flattened series divides
 * by the window's width and counts a hole as a zero — and taking the value from anywhere else
 * would let a rule refuse to paint the very cell it is describing.
 *
 * `evaluateHighlightSeries`' `checked()` stays as the second gate, not as the value: it nulls
 * a zero denominator and a window whose input was never measured. So a day is a number only
 * where the mask says the join answered AND that gate allows it, which is why a running ratio
 * over a zero-delivery window cannot match and a leading hole starts the line where the data
 * starts.
 *
 * null when the widget published NO axis — a widget whose only CM360 expression is a
 * highlight is not `cmPending`, so no calendar was published for it. The caller answers null
 * for a window-bearing rule there rather than falling back to the per-row canon, which reads
 * one day and could not run a window function over it.
 */
function cmSeriesReader(cmReader, model) {
  const order = model.cmRowOrder || model.cmDates;
  if (!cmReader || !Array.isArray(order) || !order.length) return null;
  const cache = new Map();
  const build = (expr) => {
    const values = cmHighlightSeries(expr, order, (metric, date) => cmReader.atDate(metric, date),
      model.cmPlan?.window?.scalars || null);
    return values ? new Map(order.map((date, i) => [String(date), values[i]])) : null;
  };
  return (expr, key) => {
    if (!cache.has(expr)) cache.set(expr, build(expr));
    const byKey = cache.get(expr);
    return byKey ? byKey.get(String(key)) ?? null : null;
  };
}

/** One row's cm reader, or null where the row has no join at all — `li` and `dateLi` rows,
 *  the «Others» fold and the residual, which `cmRowJoin` answers null for. A rule there
 *  reports «Value unavailable» rather than a number nobody can explain. */
function cmRowReader(cmReader, model) {
  if (!cmReader) return () => null;
  const series = cmSeriesReader(cmReader, model);
  return (row) => {
    const join = row ? cmRowJoin(model, row) : null;
    if (!join) return null;
    const one = cmReadFor((metric) => (join.join === 'date'
      ? cmReader.atDate(metric, join.key) : cmReader.atLabel(metric, join.key)),
    cmPlanScalars(model.cmPlan, join));
    // A window function is legal only on a date grain — `validate` answers «cumsum() needs a
    // date axis» anywhere else — and the value is written back by the row's own key, so the
    // run is the calendar's and the cell is this row's. With no calendar published there is
    // no run to read, and the rule says «Value unavailable»: the per-row reader beside it
    // would answer one day's number for a claim about a sequence of them.
    return (expr) => (join.join === 'date' && CM_WINDOW_RE.test(expr)
      ? (series ? series(expr, join.key) : null) : one(expr));
  };
}

/**
 * The `total` join: the rendered rows' pairs summed, then evaluated — the number the Totals
 * cell prints (§2.8), and deliberately NOT `totals(metric)`, which on a dimension cut covers
 * tuples this table folded away. The search box's subset is `retotal`'s business and never a
 * highlight's. No row with a pair means no total, rather than a zero.
 *
 * It sums by `tableWithCm`'s own `totalOver` rule (§2.2, aggregate THEN compute), which is
 * why the metrics come from the expression rather than one at a time: a row counts only
 * where it joined for EVERY metric the expression reads. Summing each metric over its own
 * row set would let `cmIm / im` divide one population by another and put a number on the
 * Totals row that the Totals cell beside it does not print.
 */
function cmTotalReader(cmReader, model) {
  if (!cmReader) return null;
  // The rows that name a tuple at all, read once for the whole pass: `cmRowJoin` answers null
  // for the «Others» fold, the residual and an li / dateLi grain, and those join nothing.
  const joins = (model.rows || []).map((row) => cmRowJoin(model, row)).filter(Boolean);
  const byMetric = new Map();
  const pairsOf = (metric) => {
    if (!byMetric.has(metric)) {
      byMetric.set(metric, joins.map((join) => (join.join === 'date'
        ? cmReader.atDate(metric, join.key) : cmReader.atLabel(metric, join.key))));
    }
    return byMetric.get(metric);
  };
  const sums = new Map();
  const sumsFor = (metrics) => {
    const cacheKey = metrics.join('|');
    if (sums.has(cacheKey)) return sums.get(cacheKey);
    const columns = metrics.map((metric) => pairsOf(metric));
    const out = new Map(metrics.map((metric) => [metric, { delivery: 0, cm360: 0 }]));
    let n = 0;
    for (let i = 0; i < joins.length; i += 1) {
      if (columns.some((column) => !column[i])) continue;
      for (let m = 0; m < metrics.length; m += 1) {
        const pair = columns[m][i];
        const sum = out.get(metrics[m]);
        sum.delivery += Number.isFinite(pair.delivery) ? pair.delivery : 0;
        sum.cm360 += Number.isFinite(pair.cm360) ? pair.cm360 : 0;
      }
      n += 1;
    }
    const answer = n === 0 ? null : out;
    sums.set(cacheKey, answer);
    return answer;
  };
  const scalars = model.cmPlan?.totals?.scalars || null;
  return (expr) => {
    const marker = cmPairMarkerOf(expr);
    if (!marker) return null;
    const summed = sumsFor(cmMetricsOf(marker));
    if (!summed) return null;
    return cmReadFor((metric) => summed.get(metric) || null, scalars)(expr);
  };
}

function dateReader(expressions, data) {
  const definitions = toDefs(expressions);
  const built = buildSeriesModel(definitions, data.range, data.sources, true);
  const rows = new Map(built.dates.map((date, i) => [date, i]));
  const series = new Map(built.series.map((item) => [item.id, item.values]));
  const slots = new Map(definitions.map((item) => [item.expr, item.id]));
  return (expr, date) => {
    const id = slots.get(expr);
    return Object.hasOwn(built.errors, id) ? null : series.get(id)?.[rows.get(date)] ?? null;
  };
}

function categoryReader(expressions, ranking, grain, limit, residual, data) {
  const ordered = uniq([ranking, ...expressions]);
  const definitions = toDefs(ordered);
  const built = buildCategoryModel({ expressions: definitions, grain, limit, residual, highlightSafe: true, identities: true, rankExpression: ranking || null }, data.range, data.sources);
  const rows = new Map(built.categories.map((row) => [categoryKey(row), row.values]));
  const slots = new Map(definitions.map((item, i) => [item.expr, { id: item.id, index: i }]));
  return (expr, row) => {
    const slot = slots.get(expr);
    if (!slot || Object.hasOwn(built.errors, slot.id)) return null;
    return rows.get(categoryKey(row))?.[slot.index] ?? null;
  };
}

function tableReader(expressions, grain, data, residual) {
  const definitions = toDefs(expressions);
  const built = buildTabularModel({
    grain, columns: definitions.map(({ id, expr }) => ({ id, source: { expr } })),
    totals: true, residual, highlightSafe: true,
  }, data.range, data.sources);
  const rows = new Map(built.rows.map((row) => [rowKey(row, grain), row.cells]));
  const slots = new Map(definitions.map((item) => [item.expr, item.id]));
  return (expr, row, total = false) => {
    const id = slots.get(expr);
    if (!id || Object.hasOwn(built.colErrors, id)) return null;
    return (total ? built.totals : rows.get(row.key))?.[id] ?? null;
  };
}

function scopedRules(rules, total) {
  return (rules || []).filter((rule) => total ? rule.scope === 'total' || rule.scope === 'both' : rule.scope !== 'total');
}

/** Called after the final source attachment. These are transient annotations;
 * neither the data cache nor the authored widget is modified. */
export function applyReportHighlights(view, model, spec, controlState, data, campCtx, cmReader = null) {
  if (!model || !data?.sources) return model;
  const datasetType = spec?.dataset?.type || 'delivery';
  const expressionOf = (value) => valueToExpr(resolveValue(value, spec, controlState), datasetType);
  let readingContext;
  const readReading = (key) => {
    if (!data.sources.effLIs?.length) return null;
    readingContext ||= compositionContext(data);
    return layoutReading(key, readingContext);
  };

  if (view.kind === 'kpi' && view.highlights?.length) {
    const expr = expressionOf(view.value);
    const cache = new Map();
    const readFormula = (formula) => {
      if (!cache.has(formula)) cache.set(formula, kpiHighlightValue(formula, data.range, data.sources).value);
      return cache.get(formula);
    };
    const targetExpr = expressionOf(view.target?.value);
    const target = targetExpr && !finite(readFormula(targetExpr)) ? null : model.target?.value;
    // A KPI is one window number, so every cm-bearing expression here joins on `totals`
    // (§2.8's slot table) and reads its plan fields off the window's own scalars.
    //
    // …and a KPI the engine refused reads NOTHING, cm-bearing rules included: `available`
    // below is applied only to a rule with no `input` of its own (widget-highlights.js), so a
    // refusal said once there would leave a formula rule reading around the very error the
    // tile is printing. It is one gate in two places because the evaluator has two doors.
    const readCm = cmReader && !model.error
      ? cmReadFor((metric) => cmReader.totals(metric), model.cmPlan?.window?.scalars || null) : null;
    return { ...model, highlight: evaluateHighlights(view.highlights, {
      value: model.value, target, available: !model.error && (!!model.cm || !expr || finite(readFormula(expr))),
      // A cm-fed KPI reads every expression off the window's pairs (`onPairs`): the CM adapter
      // may represent a mapped or focused population, which the BQ engine cannot describe even
      // on the same dates, and the pair's delivery half can. A flight reading stays refused.
      readFormula: model.cm ? onPairs(readCm) : dispatch(readCm, readFormula),
      readReading: model.cm ? unavailableReading : readReading,
    }) };
  }

  if (view.kind === 'table' && view.columns?.some((column) => column.highlights?.length)) {
    const grain = resolveGrain(view.rows, spec, controlState);
    const owners = new Map(view.columns.filter((column) => column.highlights?.length).map((column) => [column.id, column]));
    const expressions = bqOnly(uniq([...owners.values()].flatMap((column) => [expressionOf(column.value), ...highlightExpressions(column.highlights)])));
    const read = tableReader(expressions, grain, data, view.residual);
    const columns = new Map(model.columns.map((column) => [column.id, column]));
    const cmRowRead = cmRowReader(cmReader, model);
    const cmTotals = cmTotalReader(cmReader, model);
    // A window function has no Totals reading, which is `cmWindowTotals`' own rule for the
    // column beside it (report-render.js): the last day of a running total already IS the
    // window's total, and summing the column would print the area under it. Without this the
    // rule would read the per-row canon, whose window branch is unreachable and answers 0.
    const cmTotalRead = cmTotals && ((expr) => (CM_WINDOW_RE.test(expr) ? null : cmTotals(expr)));
    const annotate = (row, total) => {
      const highlights = {};
      // One join per ROW, shared by every column's rules on it: the join is the row's, not
      // the column's, so `cmRowJoin` is asked once here rather than once per column.
      const readCm = total ? cmTotalRead : cmRowRead(row);
      for (const [id, owner] of owners) {
        if (!columns.has(id)) continue;
        const rules = scopedRules(owner.highlights, total);
        if (!rules.length) continue;
        const expr = expressionOf(owner.value);
        const cm = columns.get(id).cm;
        // A column the engine or `tableWithCm` REFUSED prints its sentence in the header and a
        // dash in every cell, and no rule on it may say anything: `available` is read only for
        // a rule with no `input` of its own (widget-highlights.js), so a cm-bearing rule has to
        // meet the refusal here or it would paint the very cell that has no number.
        const refused = Object.hasOwn(model.colErrors, id);
        const targetExpr = total ? expressionOf(owner.target?.value) : null;
        const target = total && !(targetExpr && !finite(kpiHighlightValue(targetExpr, data.range, data.sources).value))
          ? columns.get(id).target?.value : null;
        Object.defineProperty(highlights, id, { enumerable: true, value: evaluateHighlights(rules, {
          value: (total ? model.totals : row.cells)?.[id], target,
          available: !refused && (!!cm || !expr || finite(read(expr, row, total))),
          readFormula: cm ? onPairs(refused ? null : readCm) : dispatch(refused ? null : readCm, (formula) => read(formula, row, total)),
          readReading: cm ? unavailableReading : readReading,
        }) });
      }
      return highlights;
    };
    return { ...model, rows: model.rows.map((row) => ({ ...row, highlights: annotate(row, false) })),
      ...(model.totals ? { totalHighlights: annotate(null, true) } : null) };
  }

  if (view.kind === 'chart' && view.series?.some((series) => series.highlights?.length)) {
    const grain = resolveGrain(view.x, spec, controlState);
    const owners = new Map(view.series.filter((series) => series.highlights?.length).map((series) => [series.id, series]));
    // §2.9 made `seriesExpr` answer the cumsum-wrapped SOURCE for a cm-bearing series, which
    // is marker text and not engine input. This branch compiles whatever it is handed — into
    // the batched reader AND into the ranking expression a category reader sorts buckets by —
    // so the cm arm is dropped here: the delivery engine owns no `cmIm`. §2.8 does the same
    // for the other readers; `series.cm` is what keeps the highlight available regardless.
    const expression = (series) => {
      const expr = seriesExpr(resolveValue(series.value, spec, controlState), series.accumulate, datasetType);
      return expr != null && isCmBearing(expr) ? null : expr;
    };
    const expressions = bqOnly(uniq([...owners.values()].flatMap((series) => [series.kind === 'calc' ? null : expression(series), ...highlightExpressions(series.highlights)])));
    const renderedIds = new Set(model.series.map((series) => series.id));
    // The ranking orders the BQ reader's own category model, so it has to be an expression
    // that engine can compute. `expression` above has ALREADY nulled the cm arm, which is the
    // only reason a truthy result here is safe to hand the engine.
    const ranking = view.series.filter((series) => renderedIds.has(series.id) && !series.hidden && series.kind !== 'calc')
      .map(expression).find((expr) => !!expr);
    const read = grain.type === 'date' ? dateReader(expressions, data)
      : categoryReader(expressions, ranking, grain, view.topN, false, data);
    const guides = new Map(model.guides.map((guide) => [guide.seriesId, guide]));
    // The row's join, taken from the model's own X: a date bar by its date, a dimension bar
    // by its label, and nothing for the «Others» fold, which names no tuple (§2.8).
    const cmRowRead = cmRowReader(cmReader, model);
    return { ...model, rows: model.rows.map((row) => {
      const highlights = {};
      const readCm = cmRowRead(row);
      for (const series of model.series) {
        const owner = owners.get(series.id);
        if (!owner) continue;
        const expr = owner.kind === 'calc' ? null : expression(owner);
        // A series the engine or `chartWithCm` REFUSED draws nothing and prints its sentence,
        // so no rule on it may speak. `available` is read only for a rule with no `input` of
        // its own (widget-highlights.js), so the refusal has to meet the cm reader here as
        // well, exactly as the table arm does for a refused column.
        const refused = Object.hasOwn(model.errors, series.id);
        const readFormula = (formula) => read(formula, grain.type === 'date' ? row.x : row);
        const guideExpr = expressionOf(owner.guide?.value);
        const drawnGuide = guides.get(series.id);
        const guide = guideExpr && !finite(kpiHighlightValue(guideExpr, data.range, data.sources).value)
          ? null : drawnGuide?.dynamic ? row[drawnGuide.key] : drawnGuide?.value;
        highlights[series.key] = evaluateHighlights(owner.highlights, {
          value: row[series.key], guide,
          available: !refused && (!!series.cm || !expr || finite(readFormula(expr))),
          readFormula: series.cm ? onPairs(refused ? null : readCm) : dispatch(refused ? null : readCm, readFormula),
          readReading: series.cm ? unavailableReading : readReading,
        });
      }
      return { ...row, highlights };
    }) };
  }

  if (view.kind === 'pie' && view.highlights?.length) {
    const grain = resolveGrain(view.sliceBy?.controlId ? { type: 'control', controlId: view.sliceBy.controlId }
      : { type: 'dim', key: view.sliceBy?.key }, spec, controlState);
    const expr = expressionOf(view.value);
    const read = categoryReader(bqOnly(uniq([expr, ...highlightExpressions(view.highlights)])), expr, grain, view.topN, !!view.residual, data);
    return { ...model, slices: model.slices.map((slice) => ({ ...slice, highlight: evaluateHighlights(view.highlights, {
      value: slice.value, share: model.total > 0 && finite(slice.value) ? slice.value / model.total * 100 : null,
      // A pie has no CM360 join (§2.8): the counts are grouped by the mapping dimensions and
      // a slice cuts by one of the pacing's. The draft gate refuses a cm-bearing rule here
      // with PIE_NO_CM; a stored one reads null and says «Value unavailable».
      available: !expr || finite(read(expr, slice)),
      readFormula: dispatch(null, (formula) => read(formula, slice)), readReading,
    }) })) };
  }
  return model;
}
