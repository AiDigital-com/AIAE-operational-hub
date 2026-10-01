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
const legacyTables = new Set();
for (const key of ['std:v2:daily', 'std:v2:breakdown']) {
  for (const view of stdEntry(key).definition.spec.views) {
    if (view.kind !== 'table' || !view.columns.some(column => isConversionValue(column.value))) continue;
    const old = structuredClone(view);
    for (const column of old.columns) if (isConversionValue(column.value) && column.format === 'count1') column.format = 'int';
    legacyTables.add(tableSignature(old));
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
  if (isStdDeliveryBar(node)) set('bind', { metric: 'imprActual' });
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
