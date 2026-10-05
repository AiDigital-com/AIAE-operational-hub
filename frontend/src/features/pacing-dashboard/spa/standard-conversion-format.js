import { stdEntry } from './std-catalog.js';
import { isConversionValue } from './conversion-format.js';

// Old Standard snapshots have no link to their template and carry an explicit
// integer format. Only an unchanged whole Standard table is safe to recognize;
// a user's edited label, expression, column, or format must remain their choice.
const stable = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
function tableSignature(view) {
  const ids = new Map(view.columns.map((column, index) => [column.id, `column_${index}`]));
  const out = { ...view, id: 'table', columns: view.columns.map(column => ({ ...column, id: ids.get(column.id) })) };
  if (view.sort) out.sort = { ...view.sort, columnId: ids.get(view.sort.columnId) || view.sort.columnId };
  if (view.share?.columnId) out.share = { ...view.share, columnId: ids.get(view.share.columnId) || view.share.columnId };
  return stable(out);
}
// The Daily table's Clicks target was `planClicks` until 2026-10-05 (`clExpected` since). The
// snapshots recognized here were stored before that, so each table is signed in both shapes.
const withPlanClicksTarget = (view) => ({ ...view, columns: view.columns.map(column => (column.target?.value?.metric === 'clExpected'
  ? { ...column, target: { ...column.target, value: { ...column.target.value, metric: 'planClicks' } } } : column)) });
const legacyTables = new Set();
for (const key of ['std:v2:daily', 'std:v2:breakdown']) {
  for (const view of stdEntry(key).definition.spec.views) {
    if (view.kind !== 'table' || !view.columns.some(column => isConversionValue(column.value))) continue;
    for (const shape of [view, withPlanClicksTarget(view)]) {
      const old = structuredClone(shape);
      for (const column of old.columns) if (isConversionValue(column.value) && column.format === 'count1') column.format = 'int';
      legacyTables.add(tableSignature(old));
    }
  }
}
const upgradedSpecs = new WeakMap();
function upgradeView(view) {
  if (view?.kind === 'table' && Array.isArray(view.columns) && legacyTables.has(tableSignature(view))) {
    return { ...view, columns: view.columns.map(column => isConversionValue(column.value)
      ? { ...column, format: 'count1' } : column) };
  }
  if (Array.isArray(view?.children)) return { ...view, children: view.children.map(upgradeView) };
  return view;
}

/* ── Flight targets (2026-09-23) ────────────────────────────────────────────
 * `planClicks` (with `budget`, `planImpr`, `planViews`) follows a window the viewer narrowed,
 * so the Targets CPC target the Standard shipped with — `costBudTotal / planClicks` — would
 * divide the flight's cost budget by a week's clicks ($0.90 read $7.97 on 7d). The template
 * now says `costBudTotal / planClicksTotal`; this rewrites the stored copies of the old text,
 * wherever they sit in a spec (a KPI target, a table column's target, a brick bind).
 *
 * The same pass rebinds the Standard Delivery bar: `im` (every line's impressions) over
 * `planImpr` (the impression-paced lines' plan) drew 296.9% of plan on a CPM+CPC pacing, so
 * the bar's value is now the impression-paced actual, the Fact cell's own basis. Only the
 * bar exactly as the Standard shipped it — the same six keys, its canonical `imprExpected`
 * marker and «needed today» label — is that bar. `im` over `planImpr` alone is also the
 * Builder's own new progress bar and the target it suggests for `im`, and the Builder shows
 * and saves this upgrade, so matching on those two snapped an author's bar to «Actual
 * impressions to date» (review 2026-09-23).
 *
 * Matched with every space removed, so `costBudTotal/planClicks` and `costBudTotal  /
 * planClicks` are the same text. Anything else is the author's and is left alone. */
const OLD_CPC_TARGET = 'costBudTotal/planClicks';
const NEW_CPC_TARGET = 'costBudTotal / planClicksTotal';

/* ── Finance «Budget Plan to Date» (owner-approved 2026-09-23) ─────────────────
 * The Standard Finance cell read `if(mTgt < 100, costBud / (1 - mTgt / 100), budget)`: the
 * cost plan to date over ONE budget-weighted margin, which is the client's plan only while
 * every line and part has the same margin. It now binds the field `budgetToDate`, each line's
 * client money over the same days. This rewrites the stored copies of the old text, matched
 * with every space removed like the CPC target above, wherever an `expr` holds it. Where the
 * copy is a cell whose whole bind is that text, its label «Budget Plan» (the Standard's own
 * label before 2026-09-23) becomes «Budget Plan to Date»; any other label is the author's and
 * stays, and so does every other formula. */
const OLD_BUDGET_TO_DATE = 'if(mTgt<100,costBud/(1-mTgt/100),budget)';
const NEW_BUDGET_TO_DATE = 'budgetToDate';
const OLD_BUDGET_LABEL = 'Budget Plan';
const NEW_BUDGET_LABEL = 'Budget Plan to Date';

/* ── Daily Performance clicks target (2026-10-05) ──────────────────────────────
 * The Standard Daily table stacked `planClicks` under the Clicks total: on Full Flight the WHOLE
 * planned clicks, beside an Impressions and a Spend that read to date. It now stacks
 * `clExpected`, the click-paced lines' expected clicks to date. A stored table that is exactly
 * the old Standard one (column ids aside, its conversions in either format) reads as today's;
 * one the author changed in any way is theirs and keeps its target. */
const OLD_DAILY_TABLES = new Set();
for (const view of stdEntry('std:v2:daily').definition.spec.views) {
  if (view.kind !== 'table') continue;
  const old = withPlanClicksTarget(view);
  const legacy = structuredClone(old);
  for (const column of legacy.columns) if (isConversionValue(column.value) && column.format === 'count1') column.format = 'int';
  OLD_DAILY_TABLES.add(tableSignature(old)).add(tableSignature(legacy));
}
const isOldDailyTable = (node) => ownValue(node, 'kind') === 'table' && Array.isArray(ownValue(node, 'columns'))
  && OLD_DAILY_TABLES.has(tableSignature(node));
const withExpectedClicksTarget = (view) => ({ ...view, columns: view.columns.map(column => (column.target?.value?.metric === 'planClicks'
  ? { ...column, target: { ...column.target, value: { ...column.target.value, metric: 'clExpected' } } } : column)) });

const squash = (text) => text.replace(/\s+/g, '');
const bindsExpr = (bind, field) => !!bind && typeof bind.expr === 'string' && squash(bind.expr) === field
  && Object.keys(bind).length === 1;
const bindsMetric = (bind, metric) => !!bind && bind.metric === metric && Object.keys(bind).length === 1;
const STD_DELIVERY_BAR_KEYS = ['type', 'bind', 'target', 'invert', 'tick', 'tickLabel'];
/** The Standard Delivery card's bar as std-entries.js shipped it before 2026-09-23. */
function isStdDeliveryBar(node) {
  const keys = Object.keys(node);
  return node.type === 'progressBar'
    && keys.length === STD_DELIVERY_BAR_KEYS.length && STD_DELIVERY_BAR_KEYS.every((key) => keys.includes(key))
    && bindsExpr(node.bind, 'im') && bindsExpr(node.target, 'planImpr') && node.invert === false
    && bindsMetric(node.tick, 'imprExpected') && node.tickLabel === 'needed today';
}

/** An own DATA property, or undefined: an accessor is nobody's stored text (see the loop below). */
function ownValue(node, key) {
  const d = Object.getOwnPropertyDescriptor(node, key);
  return d && 'value' in d ? d.value : undefined;
}

/** The old Finance cell (or any cell) whose whole bind is the old «Budget Plan» formula. */
function bindsOldBudgetToDate(node) {
  const bind = ownValue(node, 'bind');
  if (!bind || typeof bind !== 'object' || Array.isArray(bind)) return false;
  const expr = ownValue(bind, 'expr');
  return typeof expr === 'string' && squash(expr) === OLD_BUDGET_TO_DATE && Object.keys(bind).length === 1;
}

/* ── The Delivery card's unit (2026-10-05) ─────────────────────────────────────
 * The Standard Delivery card bound campM's IMPRESSIONS family: `imprToDatePct`, `imprActual`,
 * `imprExpected`, `imprDeviation`, `neededPerDayImpr`, `paceDeltaImpr`. campM gates CPC and CPV
 * lines out of that family on purpose, so on a click- or view-paced pacing the card printed
 * «0% of plan-to-date», Fact 0, Needed 0, Deviation 0 and «Deliver today 0» while the real
 * figures sat one family over. The binds are now the `unit*` ones, which resolve through
 * `primaryUnit` at render — impressions on a CPM pacing, so this changes no number there.
 *
 * Each brick is matched WHOLE, the same rule `isStdDeliveryBar` above uses and for the same
 * reason: `{ metric: 'imprActual' }` on its own is also a bind an author may have written, and
 * only the card's own slot, with the card's own neighbouring keys, is the card's.
 */
const sameKeys = (node, keys) => {
  const own = Object.keys(node);
  return own.length === keys.length && keys.every((k) => own.includes(k));
};
const metricBind = (node, key, metric) => bindsMetric(ownValue(node, key), metric);
const UNIT_OF_IMPR = {
  __proto__: null,
  imprToDatePct: 'unitToDatePct', imprActual: 'unitActual', imprExpected: 'unitExpected',
  imprDeviation: 'unitDeviation', neededPerDayImpr: 'neededPerDayUnit', paceDeltaImpr: 'paceDeltaUnit',
};
const rebind = (bind) => ({ metric: UNIT_OF_IMPR[bind.metric] });

/** The card's big «% of plan-to-date». */
const isStdDeliveryBigStat = (node) => ownValue(node, 'type') === 'bigStat'
  && sameKeys(node, ['type', 'bind', 'format']) && ownValue(node, 'format') === 'percent'
  && metricBind(node, 'bind', 'imprToDatePct');

/** Its bar, in either stored shape: the pre-2026-09-23 `im`/`planImpr` one and the
 *  `imprActual`/`planImpr` one that upgrade produced. */
const isStdDeliveryUnitBar = (node) => ownValue(node, 'type') === 'progressBar'
  && sameKeys(node, STD_DELIVERY_BAR_KEYS) && ownValue(node, 'invert') === false
  && (bindsExpr(ownValue(node, 'bind'), 'im') || metricBind(node, 'bind', 'imprActual'))
  && bindsExpr(ownValue(node, 'target'), 'planImpr')
  && metricBind(node, 'tick', 'imprExpected') && ownValue(node, 'tickLabel') === 'needed today';

/** Its Fact / Needed / Deviation row, all three cells together. */
const DELIVERY_CELLS = [['Fact', 'imprActual'], ['Needed', 'imprExpected'], ['Deviation', 'imprDeviation']];
function isStdDeliveryStatRow(node) {
  if (ownValue(node, 'type') !== 'statRow' || ownValue(node, 'layout') !== 'flex') return false;
  if (!sameKeys(node, ['type', 'cells', 'layout'])) return false;
  const cells = ownValue(node, 'cells');
  return Array.isArray(cells) && cells.length === DELIVERY_CELLS.length
    && cells.every((cell, i) => cell && sameKeys(cell, ['label', 'bind', 'format'])
      && cell.label === DELIVERY_CELLS[i][0] && cell.format === 'int'
      && bindsMetric(cell.bind, DELIVERY_CELLS[i][1]));
}

/** Its «Deliver today» row. */
const isStdDeliveryKvRow = (node) => ownValue(node, 'type') === 'kvRow'
  && sameKeys(node, ['type', 'label', 'bind', 'format', 'emphasis', 'sub'])
  && ownValue(node, 'label') === 'Deliver today' && ownValue(node, 'format') === 'int'
  && ownValue(node, 'emphasis') === 'strong' && ownValue(node, 'sub') === 'to be on plan'
  && metricBind(node, 'bind', 'neededPerDayImpr');

/** Its pace badge. */
const isStdDeliveryBadge = (node) => ownValue(node, 'words') === 'pace'
  && sameKeys(node, ['words', 'bind']) && metricBind(node, 'bind', 'paceDeltaImpr');

function upgradeTargetsNode(node) {
  if (Array.isArray(node)) {
    let changed = false;
    const out = node.map((item) => {
      const next = upgradeTargetsNode(item);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : node;
  }
  if (!node || typeof node !== 'object') return node;
  let out = node;
  const set = (key, value) => {
    if (out === node) out = { ...node };
    out[key] = value;
  };
  if (isOldDailyTable(node)) return withExpectedClicksTarget(node);
  // Before the 2026-09-23 bar rule: this one recognizes the SAME bar and writes the buy-unit
  // binds, so a spec stored in either shape lands on today's in one pass.
  if (isStdDeliveryUnitBar(node)) {
    set('bind', { metric: 'unitActual' });
    set('target', { metric: 'unitPlan' });
    set('tick', { metric: 'unitExpected' });
  } else if (isStdDeliveryBar(node)) set('bind', { metric: 'imprActual' });
  if (isStdDeliveryBigStat(node) || isStdDeliveryKvRow(node) || isStdDeliveryBadge(node)) {
    set('bind', rebind(ownValue(node, 'bind')));
  }
  if (isStdDeliveryStatRow(node)) {
    set('cells', ownValue(node, 'cells').map((cell) => ({ ...cell, bind: rebind(cell.bind) })));
  }
  if (bindsOldBudgetToDate(node)) {
    set('bind', { expr: NEW_BUDGET_TO_DATE });
    if (ownValue(node, 'label') === OLD_BUDGET_LABEL) set('label', NEW_BUDGET_LABEL);
  }
  for (const key of Object.keys(node)) {
    // Stored data only: a spec is JSON, and an accessor is nobody's stored text. Reading one
    // would run code this upgrade has no business running (and the preview's own throw test
    // relies on a view's other keys being left unread here).
    if (!('value' in Object.getOwnPropertyDescriptor(node, key))) continue;
    const value = out[key];
    if (key === 'expr' && typeof value === 'string') {
      const text = squash(value);
      if (text === OLD_CPC_TARGET) set(key, NEW_CPC_TARGET);
      else if (text === OLD_BUDGET_TO_DATE) set(key, NEW_BUDGET_TO_DATE);
      continue;
    }
    if (value && typeof value === 'object') {
      const next = upgradeTargetsNode(value);
      if (next !== value) set(key, next);
    }
  }
  return out;
}

const upgradedTargets = new WeakMap();
/** The flight-target read upgrade, which also carries the Finance «Budget Plan to Date» one:
 *  the same spec object when there is nothing to do, and one stable upgraded object per stored
 *  spec otherwise. Opening alone writes nothing; the first save carries the upgraded text. */
export function upgradeFlightTargets(spec) {
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.views)) return spec;
  if (!upgradedTargets.has(spec)) upgradedTargets.set(spec, upgradeTargetsNode(spec));
  return upgradedTargets.get(spec);
}

/** Read upgrade shared by renderer and editor. Opening alone writes nothing.
 * The first edit carries the marker through Save, clone and share, so choosing
 * Integer later stays Integer even if it recreates the old template byte for byte.
 *
 * The flight-target upgrade runs first, and before the version check: it is not a
 * format default, and a spec that already carries the marker can still hold the old text. */
export function upgradeConversionDefaults(input) {
  const spec = upgradeFlightTargets(input);
  if (!spec || typeof spec !== 'object' || spec.formatDefaultsVersion != null || !Array.isArray(spec.views)) return spec;
  if (!upgradedSpecs.has(spec)) upgradedSpecs.set(spec, {
    ...spec, views: spec.views.map(upgradeView), formatDefaultsVersion: 1,
  });
  return upgradedSpecs.get(spec);
}
