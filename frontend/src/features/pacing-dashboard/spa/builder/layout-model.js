// Pure authoring model for a canonical v2 Layout View.
//
// Layout is deliberately not implemented through the retired Composite editor. The stored
// tree is already the editor's tree (rows -> cols -> blocks), so every operation below
// replaces only the arrays/objects on that path and writes back through the Builder's spec
// patch. Empty editor intermediates are kept: the preview then becomes empty immediately,
// while normLayoutView supplies the Save refusal in its own words.
import {
  CELL_FORMATS, LIMITS, LAYOUT_BADGE_WORDS, LAYOUT_BRICK_TYPES,
  LAYOUT_CANON_NOTES, LAYOUT_CANON_SERIES, LAYOUT_CANON_SOURCES,
  LAYOUT_FRAMES, LAYOUT_KV_EMPHASIS, LAYOUT_MONEY_ROLES, LAYOUT_DELIVERY_UNITS, LAYOUT_RATE_UNITS, LAYOUT_HEADER_CONTENTS,
  LAYOUT_PILL_VARIANTS, LAYOUT_STATROW_LAYOUTS, normLayoutView, leafViews, formatLegal,
} from '../report-v2.js';
import { LAYOUT_READING_OPTIONS } from '../layout-readings.js';
import { CATALOG } from '../metric-catalog.js';
import { updateView } from '../report-draft.js';
import { formulaScopeFor } from '../formula-scope.js';
import { normalizeRateUnitsForSeries } from '../layout-options.js';

const hasOwn = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
const isObj = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const arr = (value) => (Array.isArray(value) ? value : []);
const clone = (value) => structuredClone(value);

export const LAYOUT_BLOCK_CHOICES = Object.freeze([
  ['bigStat', 'Big number', 'One value, with an optional label and target'],
  ['meter', 'Meter', 'A value measured against a required target'],
  ['pill', 'Pill', 'Authored words or a value in a status chip'],
  ['statRow', 'Stat row', 'One to four labelled values side by side'],
  ['header', 'Heading', 'A heading and optional explanation'],
  ['miniChart', 'Mini chart', 'One or two trends over the selected period'],
  ['detailCard', 'Detail card', 'A value or a ready-made set of readings'],
  ['unitBars', 'Delivery bars', 'Delivery progress for each unit'],
  ['gauge', 'Deviation gauge', 'A value around a target on a signed scale'],
  ['moneyStat', 'Money', 'Client or buying-side amount, with its currency'],
  ['kvRow', 'Label and value', 'A labelled value with optional supporting text'],
  ['rateRows', 'Rate rows', 'One row per active rate type'],
  ['progressBar', 'Progress bar', 'A value measured against a target, with an optional marker'],
  ['flightBullet', 'Flight', 'Days passed and days remaining'],
  ['note', 'Note', 'Your text or a computed summary'],
]);

export const LAYOUT_BLOCK_LABELS = Object.freeze(Object.fromEntries(
  LAYOUT_BLOCK_CHOICES.map(([type, label]) => [type, label]),
));
export const LAYOUT_BLOCK_HINTS = Object.freeze(Object.fromEntries(
  LAYOUT_BLOCK_CHOICES.map(([type, , hint]) => [type, hint]),
));

// Every starter is strict-v2-valid when placed inside a non-empty Layout. In particular,
// target + invert are atomic in the v2 grammar and mini-chart series carry a real node id.
export const NEW_LAYOUT_BLOCK = Object.freeze({
  bigStat: { type: 'bigStat', label: 'Spend', bind: { expr: 'sp' }, format: 'money' },
  meter: {
    type: 'meter', bind: { metric: 'margin' }, target: { metric: 'margin' },
    invert: false, format: 'percent',
  },
  pill: { type: 'pill', variant: 'status', text: 'On plan' },
  statRow: {
    type: 'statRow', layout: 'flex',
    cells: [{ label: 'Impressions', bind: { expr: 'im' }, format: 'int' }],
  },
  header: { type: 'header', label: 'Overall', content: 'text' },
  miniChart: {
    type: 'miniChart', label: 'Impressions',
    series: [{ id: 'line1', label: 'Impressions', expr: 'im' }],
  },
  detailCard: { type: 'detailCard', label: 'Plan', source: 'planUnits' },
  unitBars: { type: 'unitBars', units: [...LAYOUT_DELIVERY_UNITS] },
  gauge: {
    type: 'gauge', bind: { metric: 'margin' }, target: { metric: 'margin' },
    invert: false, spread: 10, format: 'percent',
  },
  moneyStat: { type: 'moneyStat', label: 'Client budget', role: 'client', bind: { expr: 'budget' } },
  kvRow: {
    type: 'kvRow', label: 'Spend', bind: { expr: 'sp' }, format: 'money', emphasis: 'muted',
  },
  rateRows: { type: 'rateRows', series: 'planRate', units: ['CPM', 'CPC', 'CPV'] },
  progressBar: {
    type: 'progressBar', bind: { expr: 'im' }, target: { expr: 'planImpr' }, invert: false,
  },
  flightBullet: { type: 'flightBullet' },
  note: { type: 'note', text: 'Note', align: 'start' },
});

/** Known keys are exported so the UI can show every extra instead of silently losing it. */
export const LAYOUT_BLOCK_KEYS = Object.freeze({
  bigStat: ['type', 'label', 'bind', 'target', 'invert', 'format', 'highlights'],
  meter: ['type', 'label', 'bind', 'target', 'invert', 'format', 'highlights'],
  pill: ['type', 'label', 'variant', 'text', 'bind', 'target', 'invert', 'format', 'highlights'],
  statRow: ['type', 'label', 'cells', 'layout'],
  header: ['type', 'label', 'sub', 'content', 'highlights'],
  miniChart: ['type', 'label', 'series'],
  detailCard: ['type', 'label', 'source', 'bind', 'format', 'sub', 'highlights'],
  unitBars: ['type', 'units', 'highlights'],
  gauge: ['type', 'label', 'bind', 'target', 'invert', 'spread', 'format', 'highlights'],
  moneyStat: ['type', 'label', 'bind', 'target', 'invert', 'role', 'highlights'],
  kvRow: ['type', 'label', 'bind', 'target', 'invert', 'format', 'emphasis', 'sub', 'highlights'],
  rateRows: ['type', 'series', 'units', 'highlights'],
  progressBar: ['type', 'label', 'bind', 'target', 'invert', 'tick', 'tickLabel', 'tone', 'size', 'highlights'],
  flightBullet: ['type', 'highlights'],
  note: ['type', 'align', 'source', 'text', 'style', 'highlights'],
});

export const LAYOUT_COLUMN_KEYS = Object.freeze(['span', 'frame', 'title', 'sub', 'badge', 'bricks']);
export const LAYOUT_ROW_KEYS = Object.freeze(['cols']);
// `besideNext` is not a Layout key and is listed here all the same: it is the one key EVERY
// view kind may carry (section view rows, spec 2026-08-27 §2), and this list is what the
// card's «extra fields» escape hatch calls UNKNOWN. Left off it, a Layout that shares a row
// would print `{"besideNext": true}` in a JSON textarea directly under the toggle that set
// it — an authored setting offered twice, once as a control and once as debris.
export const LAYOUT_VIEW_KEYS = Object.freeze(['id', 'kind', 'title', 'rows', 'besideNext']);

export const LAYOUT_FORMATS = CELL_FORMATS;
export const LAYOUT_FRAMES_LIST = LAYOUT_FRAMES;
export const LAYOUT_RATE_SERIES = LAYOUT_CANON_SERIES;
export { LAYOUT_DELIVERY_UNITS, LAYOUT_RATE_UNITS, LAYOUT_HEADER_CONTENTS };
export const LAYOUT_DETAIL_SOURCES = LAYOUT_CANON_SOURCES;
export const LAYOUT_NOTE_SOURCES = LAYOUT_CANON_NOTES;
export const LAYOUT_NOTE_LABELS = {
  __proto__: null,
  flightDays: 'Flight days', marginTarget: 'Margin target',
  marginDelta: 'Margin vs target', deliverySubtitle: 'Delivery summary',
  flightPosition: 'Flight day and duration', flightRemaining: 'Flight time remaining',
};
export const LAYOUT_MONEY_SIDES = LAYOUT_MONEY_ROLES;
export const LAYOUT_EMPHASIS = LAYOUT_KV_EMPHASIS;
export const LAYOUT_STAT_LAYOUTS = LAYOUT_STATROW_LAYOUTS;
export const LAYOUT_PILL_STYLES = LAYOUT_PILL_VARIANTS;
export const LAYOUT_BADGES = LAYOUT_BADGE_WORDS;
export { normalizeRateUnitsForSeries };
export const LAYOUT_METRICS = Object.freeze(CATALOG.filter((entry) => entry.kind === 'canonical')
  .map((entry) => Object.freeze({ key: entry.key, label: entry.label })));
const aggregateFields = formulaScopeFor({ type: 'agg' }).fieldSet;
export const LAYOUT_VALUES = Object.freeze(CATALOG.filter((entry) => entry.kind === 'canonical'
  || aggregateFields.has(entry.key)).concat(LAYOUT_READING_OPTIONS.map((entry) => Object.freeze({
    ...entry, id: `reading:${entry.key}`, kind: 'reading', unitFamily: 'count', defaultFormat: 'int', tip: entry.note,
  }))));
export function layoutBindingEntry(bind) {
  if (!isObj(bind) || ['metric', 'expr', 'reading'].filter((key) => hasOwn(bind, key)).length !== 1) return null;
  if (hasOwn(bind, 'reading')) return LAYOUT_VALUES.find((entry) => entry.kind === 'reading' && entry.key === bind.reading) || null;
  return LAYOUT_VALUES.find((entry) => entry.kind === 'canonical'
    ? bind.metric === entry.key : typeof bind.expr === 'string' && bind.expr.trim() === entry.key) || null;
}
export const layoutBindingFor = (entry) => entry?.kind === 'reading' ? { reading: entry.key }
  : entry?.kind === 'canonical' ? { metric: entry.key } : { expr: entry?.key || '' };

/** Known plan counterparts only. An arbitrary formula has no safely inferred target. */
export function suggestLayoutTarget(block) {
  const bind = block?.bind;
  if (!isObj(bind)) return null;
  if (hasOwn(bind, 'reading')) return bind.reading === 'flight.day' ? { reading: 'flight.total' } : null;
  if (hasOwn(bind, 'metric')) {
    return ['margin', 'cpm', 'spend', 'ctr', 'vcr', 'cpc', 'cpv', 'budget', 'marginbar'].includes(bind.metric)
      ? { metric: bind.metric } : null;
  }
  const target = ({ __proto__: null, sp: 'costBud', dc: 'budget', im: 'planImpr', cl: 'planClicks', coViews: 'planViews', ctr: 'ctrT', vcr: 'vcrT', acr: 'acrT' })[bind.expr?.trim()];
  return target ? { expr: target } : null;
}

/** These canonical readings carry their own runtime target. Formula and domain readings do not. */
export function layoutBindingHasIntrinsicTarget(bind) {
  if (!isObj(bind) || !hasOwn(bind, 'metric')) return false;
  const suggested = suggestLayoutTarget({ bind });
  return suggested?.metric === bind.metric;
}

export function layoutBlockNeedsExplicitTarget(block) {
  if (!isObj(block)) return false;
  if (block.type === 'meter' || block.type === 'gauge') return true;
  if (block.type === 'progressBar') return !layoutBindingHasIntrinsicTarget(block.bind);
  return block.type === 'pill' && hasOwn(block, 'bind') && block.variant === 'delta'
    && !layoutBindingHasIntrinsicTarget(block.bind);
}

/** Changing presentation carries compatible authored settings and names everything left behind. */
export function convertLayoutBlock(block, nextType, spec) {
  if (!isObj(block) || block.type === nextType) return { brick: clone(block), incompatible: [], needsTarget: false };
  const brick = freshLayoutBlock(nextType, spec);
  const allowed = new Set(LAYOUT_BLOCK_KEYS[nextType]);
  const entry = layoutBindingEntry(block.bind);
  for (const [key, value] of Object.entries(block)) {
    if (key === 'type' || !allowed.has(key)) continue;
    if (key === 'units') {
      const supported = nextType === 'unitBars' ? LAYOUT_DELIVERY_UNITS : LAYOUT_RATE_UNITS;
      const compatible = Array.isArray(value) ? value.filter((unit) => supported.includes(unit)) : [];
      if (compatible.length) brick.units = compatible;
      continue;
    }
    if (key === 'source') continue; // Source vocabularies mean different things on a detail and a note.
    if (key === 'series' && Array.isArray(value) !== Array.isArray(brick.series)) continue;
    if (key === 'sub' && typeof value === 'string' && value.length > (nextType === 'detailCard' ? LIMITS.support : LIMITS.label)) continue;
    if (key === 'format' && entry && !formatLegal(entry.unitFamily, value)) continue;
    brick[key] = clone(value);
  }
  if (hasOwn(block, 'bind') && allowed.has('bind')) {
    delete brick.source; delete brick.text;
    if (!hasOwn(block, 'label') && hasOwn(brick, 'label')) brick.label = entry?.label || 'Value';
    if (allowed.has('format') && (!hasOwn(block, 'format') || (entry && !formatLegal(entry.unitFamily, block.format)))) brick.format = entry?.defaultFormat || 'auto';
    if (!hasOwn(block, 'target')) { delete brick.target; delete brick.invert; }
  }
  if (nextType === 'pill' && hasOwn(brick, 'bind')) delete brick.text;
  if (nextType === 'detailCard' && hasOwn(brick, 'bind')) delete brick.source;
  const requiresTarget = layoutBlockNeedsExplicitTarget(brick);
  if (requiresTarget && !hasOwn(brick, 'target')) {
    brick.target = suggestLayoutTarget(brick) || {};
    brick.invert = false;
  }
  const labels = { label: 'label', bind: 'value', format: 'number format', target: 'target', invert: 'target direction', sub: 'supporting text', cells: 'values', series: 'lines', source: 'computed content', text: 'text', role: 'money side', emphasis: 'emphasis', spread: 'gauge spread', tick: 'marker', tickLabel: 'marker label', align: 'alignment', layout: 'cell layout', variant: 'pill style', units: 'selected units', content: 'heading content', style: 'text style', tone: 'colour', size: 'thickness' };
  const incompatible = Object.keys(block).filter((key) => key !== 'type' && JSON.stringify(block[key]) !== JSON.stringify(brick[key]))
    .map((key) => ({ key, label: labels[key] || key }));
  return { brick, incompatible, needsTarget: requiresTarget && !Object.keys(brick.target || {}).length };
}

export const layoutRows = (view) => arr(view && view.rows);
export const layoutCols = (row) => arr(row && row.cols);
export const layoutBlocks = (col) => arr(col && col.bricks);

export function countLayoutBlocks(view) {
  return layoutRows(view).reduce((total, row) => total + layoutCols(row)
    .reduce((rowTotal, col) => rowTotal + layoutBlocks(col).length, 0), 0);
}

/** Unknown keys in insertion order, for the visible JSON escape hatch. */
export function unknownLayoutFields(value, knownKeys) {
  if (!isObj(value)) return {};
  const known = new Set(knownKeys || []);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !known.has(key)));
}

/** Replace only unknown keys. Known fields retain their values and key order. */
export function replaceUnknownLayoutFields(value, knownKeys, extras) {
  if (!isObj(value) || !isObj(extras)) return value;
  const known = new Set(knownKeys || []);
  const out = {};
  for (const [key, field] of Object.entries(value)) if (known.has(key)) out[key] = field;
  for (const [key, field] of Object.entries(extras)) if (!known.has(key)) out[key] = clone(field);
  return out;
}

/** `undefined` means remove the optional key; null remains a real authored value. */
export function mergeLayoutFields(value, fields) {
  if (!isObj(value) || !isObj(fields)) return value;
  const out = { ...value };
  for (const [key, field] of Object.entries(fields)) {
    if (field === undefined) delete out[key];
    else out[key] = clone(field);
  }
  return out;
}

function idsIn(value, into = new Set()) {
  if (Array.isArray(value)) {
    for (const child of value) idsIn(child, into);
  } else if (isObj(value)) {
    if (typeof value.id === 'string') into.add(value.id);
    for (const child of Object.values(value)) idsIn(child, into);
  }
  return into;
}

export function newLayoutNodeId(spec, prefix = 'line') {
  const safe = /^[a-z][a-z0-9_]*$/.test(prefix) ? prefix.slice(0, 15) : 'line';
  const used = idsIn(spec);
  for (let n = 1; n < 100000; n += 1) {
    const candidate = `${safe}${n}`.slice(0, LIMITS.nodeId);
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Layout could not mint a free node id');
}

export function freshLayoutBlock(type, spec) {
  if (!hasOwn(NEW_LAYOUT_BLOCK, type)) throw new TypeError(`Unknown Layout block type "${String(type)}"`);
  const block = clone(NEW_LAYOUT_BLOCK[type]);
  if (type === 'miniChart') block.series[0].id = newLayoutNodeId(spec, 'line');
  return block;
}

export function freshLayoutColumn() {
  return { span: null, frame: 'none', bricks: [] };
}

export function freshLayoutRow() {
  return { cols: [] };
}

function withLayoutView(spec, viewId, mutate) {
  return updateView(spec, viewId, (view) => view.kind === 'layout' ? mutate(view) : view);
}

export function patchLayoutView(spec, viewId, fields) {
  return withLayoutView(spec, viewId, (view) => mergeLayoutFields(view, fields));
}

export function replaceLayoutView(spec, viewId, next) {
  return withLayoutView(spec, viewId, () => clone(next));
}

function withRow(spec, viewId, rowIndex, mutate) {
  return withLayoutView(spec, viewId, (view) => {
    const rows = layoutRows(view);
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows.length) return view;
    const next = mutate(rows[rowIndex]);
    if (next === rows[rowIndex]) return view;
    return { ...view, rows: rows.map((row, i) => (i === rowIndex ? next : row)) };
  });
}

function withCol(spec, viewId, rowIndex, colIndex, mutate) {
  return withRow(spec, viewId, rowIndex, (row) => {
    const cols = layoutCols(row);
    if (!Number.isInteger(colIndex) || colIndex < 0 || colIndex >= cols.length) return row;
    const next = mutate(cols[colIndex]);
    if (next === cols[colIndex]) return row;
    return { ...row, cols: cols.map((col, i) => (i === colIndex ? next : col)) };
  });
}

function swap(list, index, direction) {
  const target = index + direction;
  if (!Array.isArray(list) || !Number.isInteger(index) || !Number.isInteger(direction)
    || index < 0 || target < 0 || index >= list.length || target >= list.length) return list;
  const out = [...list];
  [out[index], out[target]] = [out[target], out[index]];
  return out;
}

export function addLayoutRow(spec, viewId) {
  return withLayoutView(spec, viewId, (view) => {
    const rows = layoutRows(view);
    if (rows.length >= LIMITS.layoutRows) return view;
    return { ...view, rows: [...rows, freshLayoutRow()] };
  });
}

export function patchLayoutRow(spec, viewId, rowIndex, fields) {
  return withRow(spec, viewId, rowIndex, (row) => mergeLayoutFields(row, fields));
}

export function replaceLayoutRow(spec, viewId, rowIndex, next) {
  return withRow(spec, viewId, rowIndex, () => clone(next));
}

export function moveLayoutRow(spec, viewId, rowIndex, direction) {
  return withLayoutView(spec, viewId, (view) => {
    const rows = layoutRows(view);
    const next = swap(rows, rowIndex, direction);
    return next === rows ? view : { ...view, rows: next };
  });
}

export function removeLayoutRow(spec, viewId, rowIndex) {
  return withLayoutView(spec, viewId, (view) => {
    const rows = layoutRows(view);
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows.length) return view;
    return { ...view, rows: rows.filter((_, index) => index !== rowIndex) };
  });
}

export function addLayoutCol(spec, viewId, rowIndex) {
  return withRow(spec, viewId, rowIndex, (row) => {
    const cols = layoutCols(row);
    if (cols.length >= LIMITS.layoutCols) return row;
    return { ...row, cols: [...cols, freshLayoutColumn()] };
  });
}

export function patchLayoutCol(spec, viewId, rowIndex, colIndex, fields) {
  return withCol(spec, viewId, rowIndex, colIndex, (col) => mergeLayoutFields(col, fields));
}

export function replaceLayoutCol(spec, viewId, rowIndex, colIndex, next) {
  return withCol(spec, viewId, rowIndex, colIndex, () => clone(next));
}

export function moveLayoutCol(spec, viewId, rowIndex, colIndex, direction) {
  return withRow(spec, viewId, rowIndex, (row) => {
    const cols = layoutCols(row);
    const next = swap(cols, colIndex, direction);
    return next === cols ? row : { ...row, cols: next };
  });
}

export function removeLayoutCol(spec, viewId, rowIndex, colIndex) {
  return withRow(spec, viewId, rowIndex, (row) => {
    const cols = layoutCols(row);
    if (!Number.isInteger(colIndex) || colIndex < 0 || colIndex >= cols.length) return row;
    return { ...row, cols: cols.filter((_, index) => index !== colIndex) };
  });
}

export function addLayoutBlock(spec, viewId, rowIndex, colIndex, type) {
  return withCol(spec, viewId, rowIndex, colIndex, (col) => {
    const blocks = layoutBlocks(col);
    const view = leafViews(spec?.views).find((candidate) => candidate && candidate.id === viewId);
    if (blocks.length >= LIMITS.layoutBricksPerCol || countLayoutBlocks(view) >= LIMITS.layoutBricks) return col;
    return { ...col, bricks: [...blocks, freshLayoutBlock(type, spec)] };
  });
}

export function patchLayoutBlock(spec, viewId, rowIndex, colIndex, blockIndex, fields) {
  return withCol(spec, viewId, rowIndex, colIndex, (col) => {
    const blocks = layoutBlocks(col);
    if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= blocks.length) return col;
    const current = blocks[blockIndex];
    const next = typeof fields === 'function' ? fields(current) : mergeLayoutFields(current, fields);
    if (next === current) return col;
    return { ...col, bricks: blocks.map((block, index) => (index === blockIndex ? clone(next) : block)) };
  });
}

export function moveLayoutBlock(spec, viewId, rowIndex, colIndex, blockIndex, direction) {
  return withCol(spec, viewId, rowIndex, colIndex, (col) => {
    const blocks = layoutBlocks(col);
    const next = swap(blocks, blockIndex, direction);
    return next === blocks ? col : { ...col, bricks: next };
  });
}

export function removeLayoutBlock(spec, viewId, rowIndex, colIndex, blockIndex) {
  return withCol(spec, viewId, rowIndex, colIndex, (col) => {
    const blocks = layoutBlocks(col);
    if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= blocks.length) return col;
    return { ...col, bricks: blocks.filter((_, index) => index !== blockIndex) };
  });
}

export function replaceLayoutBlock(spec, viewId, rowIndex, colIndex, blockIndex, type) {
  const fresh = freshLayoutBlock(type, spec);
  return patchLayoutBlock(spec, viewId, rowIndex, colIndex, blockIndex, () => fresh);
}

export function addLayoutCell(spec, viewId, rowIndex, colIndex, blockIndex) {
  return patchLayoutBlock(spec, viewId, rowIndex, colIndex, blockIndex, (block) => {
    const cells = arr(block && block.cells);
    if (block?.type !== 'statRow' || cells.length >= LIMITS.layoutCells) return block;
    return { ...block, cells: [...cells, { label: `Value ${cells.length + 1}`, bind: { expr: 'im' }, format: 'int' }] };
  });
}

export function removeLayoutCell(spec, viewId, rowIndex, colIndex, blockIndex, cellIndex) {
  return patchLayoutBlock(spec, viewId, rowIndex, colIndex, blockIndex, (block) => {
    const cells = arr(block && block.cells);
    if (block?.type !== 'statRow' || !Number.isInteger(cellIndex)
      || cellIndex < 0 || cellIndex >= cells.length) return block;
    return { ...block, cells: cells.filter((_, index) => index !== cellIndex) };
  });
}

export function patchLayoutCell(spec, viewId, rowIndex, colIndex, blockIndex, cellIndex, fields) {
  return patchLayoutBlock(spec, viewId, rowIndex, colIndex, blockIndex, (block) => {
    const cells = arr(block && block.cells);
    if (block?.type !== 'statRow' || !Number.isInteger(cellIndex)
      || cellIndex < 0 || cellIndex >= cells.length) return block;
    return { ...block, cells: cells.map((cell, index) => (
      index === cellIndex ? mergeLayoutFields(cell, fields) : cell
    )) };
  });
}

export function addLayoutMiniSeries(spec, viewId, rowIndex, colIndex, blockIndex) {
  const id = newLayoutNodeId(spec, 'line');
  return patchLayoutBlock(spec, viewId, rowIndex, colIndex, blockIndex, (block) => {
    const series = arr(block && block.series);
    if (block?.type !== 'miniChart' || series.length >= LIMITS.layoutSeries) return block;
    return { ...block, series: [...series, { id, label: `Line ${series.length + 1}`, expr: 'im' }] };
  });
}

export function removeLayoutMiniSeries(spec, viewId, rowIndex, colIndex, blockIndex, seriesIndex) {
  return patchLayoutBlock(spec, viewId, rowIndex, colIndex, blockIndex, (block) => {
    const series = arr(block && block.series);
    if (block?.type !== 'miniChart' || !Number.isInteger(seriesIndex)
      || seriesIndex < 0 || seriesIndex >= series.length) return block;
    return { ...block, series: series.filter((_, index) => index !== seriesIndex) };
  });
}

export function patchLayoutMiniSeries(spec, viewId, rowIndex, colIndex, blockIndex, seriesIndex, fields) {
  return patchLayoutBlock(spec, viewId, rowIndex, colIndex, blockIndex, (block) => {
    const series = arr(block && block.series);
    if (block?.type !== 'miniChart' || !Number.isInteger(seriesIndex)
      || seriesIndex < 0 || seriesIndex >= series.length) return block;
    return { ...block, series: series.map((line, index) => (
      index === seriesIndex ? mergeLayoutFields(line, fields) : line
    )) };
  });
}

/** The exact strict normalizer's first refusal, for the always-visible card banner. */
export function layoutViewRefusal(view) {
  const result = normLayoutView(view, '/view', {
    isCanonicalMetric: (key) => LAYOUT_METRICS.some((metric) => metric.key === key),
  });
  return result.ok ? null : result.detail;
}

// Pins the UI vocabulary to the closed grammar during module evaluation. A forgotten editor
// row becomes a loud build failure rather than a stored block falling into a blank panel.
if (LAYOUT_BRICK_TYPES.length !== LAYOUT_BLOCK_CHOICES.length
  || LAYOUT_BRICK_TYPES.some((type, index) => LAYOUT_BLOCK_CHOICES[index]?.[0] !== type)) {
  throw new Error('Layout block editor vocabulary drifted from report-v2');
}
