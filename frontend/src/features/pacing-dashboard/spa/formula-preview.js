import { upgradeConversionDefaults } from './standard-conversion-format.js';
// A formula preview is a read of the same prepared data and model builders as the
// ReportWidget already on screen. Editors supply a transient candidate Widget whose
// only change is the formula being typed; this module never writes that candidate back.
import {
  attachCmData, buildReportChartModel, buildReportKpiModel, buildReportTableModel, calculatedGuideLabel, fmtV2,
  fmtReportTableCell, focusTargetsOf, kpiViewShown, reportDimKey, reportShowsEmptyWithoutFacts, reportWindowHasFacts,
  resolveValue,
} from './report-render.js';
// `miniSeries` is the TILE's own mini-chart path, and the preview takes it whole rather than
// rebuilding the cm/delivery split beside it (§2.7). `cmMarkerOf` is the split's own question,
// imported so the two can never disagree about which lines the delivery engine may see.
import { brickValue, cellValue, canonicalNote, miniSeries } from './brick-data.js';
import { cmMarkerOf } from './cm-formula-context.js';
import { buildSeriesModel, sourceFilterReason } from './widget-data.js';
import { dimSourceMissingReason } from './dim-sources-norm.js';
import { fDs } from './format.js';
import { formatTooltipValue } from './chart-format.js';
import { fmtKpi } from './report/widget-format.js';
import { valueReadsCm } from './spotlight-items.js';
import { dualMoneyParts } from './dual-money.js';
import Currency from '@shared/currency';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const dateLabel = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? fDs(value) : value;

function findNode(list, id) {
  for (const node of Array.isArray(list) ? list : []) {
    if (!node || typeof node !== 'object') continue;
    if (node.id === id) return node;
    const child = findNode(node.children, id);
    if (child) return child;
  }
  return null;
}

/**
 * The stored value behind each previewable slot — the one the author is editing, and the only
 * one whose source the context line may speak for. A chart holding one bq series and one cm
 * series has two answers, so «does this VIEW hold a cm value» is the wrong question.
 *
 * `atomNote` is absent deliberately: a note is text, not a reading.
 */
const byId = (list, id) => (Array.isArray(list) ? list : []).find((entry) => entry?.id === id) || null;
const SLOT_VALUE = {
  __proto__: null,
  chartSeries: (node, target) => byId(node.series, target.elementId)?.value,
  chartGuide: (node, target) => byId(node.series, target.elementId)?.guide?.value,
  tableColumn: (node, target) => byId(node.columns, target.elementId)?.value,
  tableTarget: (node, target) => byId(node.columns, target.elementId)?.target?.value,
  kpiValue: (node) => node.value,
  kpiTarget: (node) => node.target?.value,
  atomValue: (node) => node.brick?.bind,
  atomTarget: (node) => node.brick?.target,
  atomTick: (node) => node.brick?.tick,
  atomCell: (node, target) => (Array.isArray(node.brick?.cells) ? node.brick.cells : [])[target.index]?.bind,
  atomMiniSeries: (node, target) => byId(node.brick?.series, target.elementId)
    || (Array.isArray(node.brick?.series) ? node.brick.series : [])[target.index],
  containerBadge: (node) => node.badge?.bind,
};

/** The word is the builder's own `valueReadsCm` answer for the slot's stored value, a bound
 *  value first resolved to the option the switch currently selects — the same read the
 *  builder's CM/BQ chip uses, so the two can never disagree. */
function sourceWordFor(node, target, spec, controlState) {
  const read = SLOT_VALUE[target.kind];
  const stored = read ? read(node, target) : null;
  const value = stored && typeof stored === 'object' && stored.kind === 'bound'
    ? resolveValue(stored, spec, controlState) : stored;
  return valueReadsCm(value) ? 'CM360' : 'Delivery';
}

/** `source` is the word the numbers below this line came FROM. A cm-bearing draft reads the
 *  CM360 join, and a context line that still said «Delivery» over those numbers would be the
 *  one sentence on the panel that is wrong. */
function contextFor(widget, data, grain, source = 'Delivery') {
  const range = data?.range;
  const span = range?.from && range?.to
    ? (range.from === range.to ? fDs(range.from) : `${fDs(range.from)} – ${fDs(range.to)}`)
    : 'Current period';
  const qualifiers = [];
  const scope = widget?.scope;
  const hasPinnedScope = scope && Object.entries(scope).some(([key, item]) => (
    key === 'time' ? item === 'absolute' : (Array.isArray(item) ? item.length > 0 : item != null)
  ));
  if (hasPinnedScope) qualifiers.push('Widget scope');
  const breakdowns = data?.sources?.brkf;
  const breakdownCount = Array.isArray(breakdowns) ? breakdowns.length : (breakdowns ? 1 : 0);
  if (breakdownCount) {
    qualifiers.push(`${breakdownCount} breakdown filter${breakdownCount === 1 ? '' : 's'}`);
  }
  return {
    sourceLabel: source,
    grainLabel: grain,
    contextLabel: [source, span, grain, ...qualifiers].filter(Boolean).join(' · '),
  };
}

const loading = () => ({ status: 'loading', shape: 'scalar', message: 'Waiting for current report data.' });
const failure = (message, context) => ({ status: 'error', shape: 'scalar', message: message || 'This formula could not be evaluated.', ...context });
const empty = (message, context, shape = 'scalar') => ({ status: 'empty', shape, message, ...context });

function scalar({
  value, format = 'auto', label = 'Result', context, formatter = fmtV2, warned = false,
  formatted = null, secondaryFormatted = null,
}) {
  if (value == null || !Number.isFinite(Number(value))) {
    return empty('No value for the current context.', context);
  }
  return {
    status: 'ready', shape: 'scalar', label, value: Number(value),
    formatted: formatted ?? formatter(value, format), secondaryFormatted, format, warned, ...context,
  };
}

export function normalizeFormulaPreviewPoints(points, format, formatter) {
  return points.map((point) => {
    const value = point.value != null && Number.isFinite(Number(point.value)) ? Number(point.value) : null;
    return { label: String(point.label ?? ''), value, formatted: value == null ? '—' : formatter(format, value) };
  });
}

function series({ points, format, label, context, formatter = formatTooltipValue, warned = false }) {
  const normalized = normalizeFormulaPreviewPoints(points, format, formatter);
  if (!normalized.some((point) => point.value != null)) {
    return empty('No points for the current context.', context, 'series');
  }
  return {
    status: 'ready', shape: 'series', label, points: normalized, format, warned, ...context,
  };
}

function rows({ rows: input, column, label, context, total = null }) {
  const format = column.format;
  const rows = normalizeFormulaPreviewPoints(input, format, (_format, value) => fmtReportTableCell(value, column));
  if (!rows.some((row) => row.value != null)) {
    return empty('No rows for the current context.', context, 'rows');
  }
  return {
    status: 'ready', shape: 'rows', label, rows, format,
    total: total == null ? null : { value: total, formatted: fmtReportTableCell(total, column) },
    displayNote: column.zeroAs === 'blank' && (total === 0 || rows.some((row) => row.value === 0))
      ? 'Zero values are shown as empty cells.' : null,
    ...context,
  };
}

function aggregateValue({
  value, format, spec, controlState, data, campCtx, context, label, formatter, attach = (model) => model,
}) {
  const probe = { id: 'formula_preview', kind: 'kpi', title: label, value, format: format || 'auto' };
  // The probe IS a kpi view, so a cm-bearing guide or column target reaches the second pass
  // the way the tile's own KPI does. Without this the probe prints the model's own null — a
  // dash — for the expression the tile beside it draws a number for.
  const model = attach(buildReportKpiModel(probe, spec, controlState, data, campCtx), probe);
  if (model.error) return failure(model.error, context);
  return scalar({ value: model.value, format: format || model.format, label, context, warned: model.warned, formatter });
}

/**
 * target.kind is one of:
 * chartSeries/chartGuide, tableColumn/tableTarget, kpiValue/kpiTarget,
 * atomValue/atomTarget/atomTick/atomCell/atomMiniSeries/atomNote, containerBadge.
 * viewId addresses the recursive composition node; elementId addresses a series or
 * column, while index addresses a stat-row cell or mini-chart line as a legacy fallback.
 */
export function buildFormulaPreview({
  widget, target, controlState = {}, data, campCtx = null, layoutCtx = null, cm = null,
}) {
  if (!data) return loading();
  const spec = upgradeConversionDefaults(widget?.spec);
  const node = findNode(spec?.views, target?.viewId);
  if (!spec || !node || !target?.kind) {
    return failure('The edited element is no longer in this Widget.', contextFor(widget, data, 'Current context'));
  }

  // Resolved ONCE: the slot does not change while a preview is built, and a per-call read
  // would let the failure paths below disagree with the ready one about what was read. EVERY
  // path below goes through `contextAt`, the thrown one included; the refusal above is the one
  // that cannot, because there is no `node` there to read a word off.
  const word = sourceWordFor(node, target, spec, controlState);
  const contextAt = (grain) => contextFor(widget, data, grain, word);
  const baseContext = contextAt('Current context');
  if (!data.sources?.effLIs?.length) {
    return empty('No line items match the current Widget scope and filters.', baseContext);
  }
  if (reportShowsEmptyWithoutFacts(spec, controlState)
    && !reportWindowHasFacts(spec, data.sources, data.range)) {
    return empty('No delivery data in the current period.', baseContext);
  }
  const dim = reportDimKey(node, spec, controlState);
  const missingSource = dimSourceMissingReason(
    dim, data.sources?.dimSourceConfigs, data.sources?.dimSources,
  ) || sourceFilterReason(data.sources, dim, data.range);
  if (missingSource) return empty(missingSource, baseContext);

  // The CM360 half, on the SAME gate `ReportBody`'s models memo uses: a projection built over
  // a mapping that classifies nothing, or over a file that never landed, has numbers of a
  // sort — all of them zero — and attaching those prints a measured 0 where the model's own
  // null prints the placeholder.
  //
  // `cm` arrives already masked by the dashboard's dimension/platform filters: the hook owns
  // that mask now (design §2.7), so there is nothing to re-ask here and no second answer to
  // keep in step with the tile's.
  //
  // The focused projection is picked by the DECLARED `tupleFocus` alone (§5.6), with no focus
  // state read: `useReportCm360` returns `focusedProjection === projection` whenever no row is
  // focused, so this is the tile's pick with its redundant half dropped.
  //
  // `owner` defaults to `view` but the guide/column-target aggregate probe passes the node it
  // stands in for: the probe's own id ('formula_preview') can never be a tupleFocus target, so
  // without an explicit owner it would always read the unfocused projection even while the
  // chart or table it belongs to is the declared focus target.
  const focusTargets = focusTargetsOf(spec);
  const withCm = (model, view, owner = view) => {
    if (!model || !model.cmPending || !cm || !cm.status || !cm.status.modelReady) return model;
    return attachCmData(
      model, cm.dataset, focusTargets.has(owner.id) ? cm.focusedProjection : cm.projection, view,
    );
  };

  try {
    if (target.kind === 'chartSeries' || target.kind === 'chartGuide') {
      const chart = withCm(buildReportChartModel(node, spec, controlState, data, campCtx), node);
      const entry = chart.series.find((candidate) => candidate.id === target.elementId);
      const stored = (node.series || []).find((candidate) => candidate?.id === target.elementId);
      const grain = chart.xType === 'date' ? 'Daily' : (chart.xType === 'li' ? 'Line items' : 'Dimension buckets');
      const context = contextAt(grain);
      if (!entry && stored?.hidden) {
        return empty('This series is hidden in the Widget.', context,
          target.kind === 'chartGuide' && !stored.guide?.calc ? 'scalar' : 'series');
      }
      if (!entry) return failure('The edited chart series is no longer available.', context);
      const format = chart.formats[entry.axisSide] || 'number';
      if (target.kind === 'chartGuide') {
        if (stored?.guide?.calc) {
          const guide = chart.guides.find((candidate) => candidate.seriesId === stored.id && candidate.dynamic);
          if (!guide) return empty('The daily Guide is unavailable for this chart.', context, 'series');
          if (guide.error) return failure(guide.error, context);
          return series({ label: stored.guide.label || calculatedGuideLabel(stored.guide, stored.accumulate), format, context,
            points: chart.rows.map((row) => ({ label: dateLabel(row.x), value: row[guide.key] })) });
        }
        if (!stored?.guide?.value) return failure('The edited guide is no longer available.', context);
        return aggregateValue({ value: stored.guide.value, format, spec, controlState, data, campCtx,
          formatter: (value, axisFormat) => formatTooltipValue(axisFormat, value),
          attach: (model, view) => withCm(model, view, node),
          context: contextAt('Window total'), label: stored.guide.label || 'Guide result' });
      }
      if (hasOwn(chart.errors, entry.id)) return failure(chart.errors[entry.id], context);
      return series({
        label: entry.label || 'Series result', format: entry.valueFormat || format, context,
        points: chart.rows.map((row) => ({ label: chart.xType === 'date' ? dateLabel(row.x) : row.x, value: row[entry.key] })),
      });
    }

    if (target.kind === 'tableColumn' || target.kind === 'tableTarget') {
      const table = withCm(buildReportTableModel(node, spec, controlState, data, campCtx), node);
      const modelColumn = table.columns.find((candidate) => candidate.id === target.elementId);
      const storedColumn = (node.columns || []).find((candidate) => candidate?.id === target.elementId);
      const column = modelColumn || storedColumn;
      const grain = table.rowType === 'date' ? 'Daily'
        : table.rowType === 'dateLi' ? 'Date × line item'
          : table.rowType === 'li' ? 'Line items' : 'Dimension buckets';
      const context = contextAt(grain);
      if (!column) return failure('The edited table column is no longer available.', context);
      if (!modelColumn && storedColumn?.hideWhenEmpty) {
        return empty('This column is hidden when empty in the Widget.', context,
          target.kind === 'tableTarget' ? 'scalar' : 'rows');
      }
      if (target.kind === 'tableTarget') {
        const stored = storedColumn;
        if (!stored?.target?.value) return failure('The edited target is no longer available.', context);
        // The table model resolves target `auto` from the target's own family/canonical
        // reading. Use that published format and visibility rather than formatting a
        // second aggregate opinion beside it.
        if (modelColumn?.target && modelColumn.target.value != null) {
          return scalar({ value: modelColumn.target.value, format: modelColumn.target.format,
            label: `${column.label || 'Column'} target`, context: contextAt('Window total') });
        }
        const probe = aggregateValue({ value: stored.target.value, format: stored.target.format || column.format,
          spec, controlState, data, campCtx, context: contextAt('Window total'),
          attach: (model, view) => withCm(model, view, node), label: `${column.label || 'Column'} target` });
        return probe.status === 'error' ? probe
          : empty('This target is zero or unavailable, so the table does not draw it.',
            contextAt('Window total'));
      }
      if (hasOwn(table.colErrors, target.elementId)) return failure(table.colErrors[target.elementId], context);
      return rows({
        label: column.label || 'Column result', column, context,
        rows: table.rows.map((row) => ({
          label: table.rowType === 'date' || table.rowType === 'dateLi' ? dateLabel(row.label) : row.label,
          value: row.cells?.[target.elementId],
        })),
        total: table.totals?.[target.elementId],
      });
    }

    if (target.kind === 'kpiValue' || target.kind === 'kpiTarget') {
      const context = contextAt('Window total');
      if (!kpiViewShown(node, data)) {
        return empty('Not shown for the current campaign basis.', context);
      }
      if (target.kind === 'kpiTarget') {
        if (!node.target?.value) return failure('The edited target is no longer available.', context);
        // Build the authored KPI itself so its basis narrows target and value together.
        // A generic aggregate probe would read all line items and disagree on mixed
        // campaigns with a video/audio/CPC basis.
        const model = withCm(buildReportKpiModel(node, spec, controlState, data, campCtx), node);
        if (model.targetError) return failure(model.targetError, context);
        if (!model.target || model.target.value == null) return empty('No target value for the current context.', context);
        return scalar({ value: model.target.value, format: model.format, label: `${node.title || 'KPI'} target`,
          context, warned: model.warned });
      }
      const model = withCm(buildReportKpiModel(node, spec, controlState, data, campCtx), node);
      if (model.error) return failure(model.error, context);
      return scalar({ value: model.value, format: model.format, label: node.title || 'KPI result', context, warned: model.warned });
    }

    if (target.kind === 'atomMiniSeries') {
      const lines = Array.isArray(node.brick?.series) ? node.brick.series : [];
      const line = lines.find((candidate) => candidate?.id === target.elementId) || lines[target.index];
      const context = contextAt('Daily');
      if (!line) return failure('The edited mini chart line is no longer available.', context);
      const label = line.label || 'Line result';
      // A cm-bearing line takes the TILE's own path (§2.7): `miniSeries` holds it OUT of the
      // delivery engine — which has no field called `cmIm` — and evaluates it over the calendar
      // the engine built, through `layoutCtx.cmRead`. Handed to `buildSeriesModel` instead it
      // answered NO_CM_JOIN under a header this same call labels «CM360», for a line the tile
      // beside the editor was drawing. The split is `miniSeries`' own question, so a cm-bearing
      // expression that does not PARSE still falls through to the engine's own error below.
      if (cmMarkerOf(line.expr)) {
        const [cmLine] = miniSeries({ series: [line] }, { ...(layoutCtx || {}), data }, true);
        // No sources at all — the same placeholder an empty engine answer gives below. With no
        // reader the line is all nulls, which is that placeholder too: the file has not landed,
        // and a refusal would say something about the formula that is not true of it.
        if (!cmLine) return empty('No points for the current context.', context, 'series');
        // §2.4's field-set gate answered on the line: the author is the one who can act on it,
        // and the mini chart itself has nowhere to print a sentence.
        if (cmLine.error) return failure(cmLine.error, context);
        return series({ label, format: 'number', context,
          points: cmLine.dates.map((date, index) => ({ label: dateLabel(date), value: cmLine.values[index] })) });
      }
      const built = buildSeriesModel([line], data.range, data.sources);
      if (hasOwn(built.errors, line.id)) return failure(built.errors[line.id], context);
      const values = built.series[0]?.values || [];
      return series({ label, format: 'number', context,
        points: built.dates.map((date, index) => ({ label: dateLabel(date), value: values[index] })) });
    }

    const context = contextAt('Window total');
    const ctx = layoutCtx || { data };
    const brick = node.brick || {};
    if (target.kind === 'atomNote') {
      const text = canonicalNote(brick.source, ctx.cm, ctx.flCM, ctx.effLIs, ctx.facts);
      return typeof text === 'string' && text ? { status: 'ready', shape: 'text', formatted: text, ...context }
        : failure('No text in the current context.', context);
    }
    let out;
    let label = brick.label || 'Result';
    if (target.kind === 'atomCell') {
      const cells = Array.isArray(brick.cells) ? brick.cells : [];
      const cell = cells[target.index];
      if (!cell) return failure('The edited value is no longer available.', context);
      out = cellValue(cell, ctx); label = cell.label || label;
    } else if (target.kind === 'containerBadge') {
      if (!node.badge || typeof node.badge !== 'object') return failure('The edited badge is no longer available.', context);
      out = brickValue({ bind: node.badge.bind }, ctx); label = node.title ? `${node.title} badge` : 'Badge result';
    } else if (target.kind === 'atomTarget') {
      out = brickValue({ bind: brick.target, format: brick.format }, ctx); label = `${label} target`;
    } else if (target.kind === 'atomTick') {
      out = brickValue({ bind: brick.tick, format: brick.format }, ctx); label = brick.tickLabel || 'Marker result';
    } else if (target.kind === 'atomValue') {
      out = brickValue(brick, ctx);
    } else {
      return failure('This formula preview type is not supported.', context);
    }
    if (out.error) return failure(out.error, context);
    if (brick.type === 'moneyStat' && (target.kind === 'atomValue' || target.kind === 'atomTarget')
      && out.value != null && Number.isFinite(Number(out.value))) {
      const money = dualMoneyParts({
        native: Currency.usdToNative(out.value, ctx.rate), usd: out.value,
        currency: ctx.currency, role: brick.role,
      });
      return scalar({ value: out.value, format: out.format || brick.format || 'money', label, context,
        formatted: money.primary, secondaryFormatted: money.secondary, warned: out.warned });
    }
    return scalar({ value: out.value, format: out.format || brick.format || 'auto', label, context,
      formatter: (value, format) => fmtKpi(value, format), warned: out.warned });
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error), contextAt('Current context'));
  }
}
