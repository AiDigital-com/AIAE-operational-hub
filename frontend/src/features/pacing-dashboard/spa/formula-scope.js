// Formula vocabulary follows the evaluator, not the wider value catalog. Canonical
// metrics remain separate bindings; a source's m1 must never become another source's m1.
import MetricRegistry from '@shared/metric-registry';
import { TS_FIELDS, DIM_FIELDS_SET, DIM_DECLARED_FIELDS_SET } from './widget-data.js';
import { NO_CM_JOIN } from './widget-formula.js';
import { catalogExtraMetrics, mappedExtraMetrics } from './dim-sources-norm.js';

const NO_LABELS = Object.freeze({});

/**
 * Which CM360 join a slot on this grain HAS (spec 2026-09-16 §2.5): a date, a mapping
 * dimension's tuple label, and — through the mapping's groups — a line item, over the window
 * or on one day (docs/2026-09-29-cm360-by-line.md). Whether a GIVEN line gets a number is the
 * data's answer at render time (a dash with its reason where it shares a day or has no
 * placement); the slot has the join either way.
 *
 * `agg` is the WINDOW total — a KPI, a guide, a column target, a brick — and `control` is a
 * dimension the viewer picks, so it joins by label like the dimension it resolves to.
 *
 * NULL-prototype: the type comes off stored config and `CM_JOIN_BY_GRAIN['constructor']`
 * would otherwise answer a function, which `validate` would read as «this slot has a join».
 */
const CM_JOIN_BY_GRAIN = Object.freeze({
  __proto__: null, agg: 'window', date: 'date', dim: 'label', control: 'label', li: 'line', dateLi: 'dateLine',
});

const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

export function formulaScopeFor(grain, env = {}) {
  const type = grain?.type || 'agg';
  const isDim = type === 'dim' || type === 'control';
  const contextKind = type === 'date' || type === 'dateLi' ? 'ts' : 'agg';
  // The slot's CM360 join, and the sentence it answers with when it has none. `env.cm` is
  // the one family whose join is not its grain's — a highlight (§2.8), whose `total` scope
  // reads the number the Totals cell prints and whose pie arm has no join at all. Read
  // through hasOwn so an explicit `cm: null` is an override rather than an absent key.
  const cm = hasOwn(env, 'cm') ? env.cm : CM_JOIN_BY_GRAIN[type] ?? null;
  const cmRefusal = hasOwn(env, 'cmRefusal') && env.cmRefusal ? env.cmRefusal : NO_CM_JOIN;
  // A dimension this pacing declares targets on carries a plan, so its formulas may name one
  // (2026-09-12). The caller answers that question — `dimPlanEligible` — for the same reason
  // the metric catalog takes it from the caller: this module knows nothing about a pacing.
  // Absent, the palette is what it has always been.
  const dimBase = isDim && env.dimPlanEligible ? DIM_DECLARED_FIELDS_SET : DIM_FIELDS_SET;
  // `grain` is the slot's grain type, read by the editor's chip strip (formula chips P0).
  const scope = { contextKind, isDim, grain: type, fieldSet: isDim ? dimBase : TS_FIELDS, fieldLabels: NO_LABELS, cm, cmRefusal };
  // A switch may span unrelated sources. Only their common delivery vocabulary is safe
  // without a source binding on each token. Configured names remain editable while an
  // aux file is loading or stale: file availability is the renderer's separate concern.
  if (type !== 'dim' || typeof grain.key !== 'string') return scope;
  const match = /^ds:([^:]+):([^:]+)$/.exec(grain.key);
  if (!match) return scope;
  const configs = env.dataConfig?.dim_sources;
  const source = Array.isArray(configs) ? configs.find((entry) => entry?.id === match[1]) : null;
  // Three doors into one list, and the same one `customMetricKeys` sums by: the source's own
  // m1..m4, the registry roles a hand-mapped sheet source maps that are not delivery fields
  // (`vi`), and a catalogued mart source's extra columns. Labels come from the registry, so
  // a formula names «Viewable impressions» and never the key.
  const declared = MetricRegistry.customMetricsOf(source?.origin?.columns || {})
    .concat(mappedExtraMetrics(source))
    .concat(catalogExtraMetrics(source));
  const custom = declared.filter((e, i) => declared.findIndex((x) => x.key === e.key) === i);
  if (!custom.length) return scope;
  return {
    ...scope,
    fieldSet: new Set([...dimBase, ...custom.map((entry) => entry.key)]),
    fieldLabels: Object.fromEntries(custom.map((entry) => [entry.key, entry.label])),
  };
}
