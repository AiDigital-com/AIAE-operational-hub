// Metric inventories are shared by value pickers, report readings and Alert formulas.
// Keep this module below the data engine in the import graph.
import MetricRegistry from '@shared/metric-registry';
import { identifiersOf } from './widget-formula.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * The two sentences of spec 2026-09-08 §3.6. `inventory` is the blob's `availableMetrics`
 * (`{delivery: keys}`), null when the file predates the change, undefined when the caller has
 * nothing to say — then the rule is silent, the way every optional env rule is.
 */
export function metricAvailability(key, inventory, label) {
  if (!MetricRegistry.ADDED_DELIVERY_KEYS.includes(key)) return null;
  if (inventory === undefined) return null;
  const name = label || MetricRegistry.byKey(key).label;
  if (inventory === null) return `${name} is not in this pacing's data yet; the next refresh brings it`;
  const list = Array.isArray(inventory.delivery) ? inventory.delivery : [];
  return list.includes(key) ? null : `This pacing's delivery source does not carry ${name}`;
}

/**
 * The mart-metrics inventory (spec 2026-09-08 §3.6), read for ONE resolved value: a metric key
 * the six-new list judges, or a formula naming one. `sources.availableMetrics` is the blob's
 * inventory; a `ds:` grain reads its source's envelope list instead. Absent on the sources
 * (a fixture, an older caller) → null: this is the renderer's optional rule, like the picker's.
 *
 * Only a `bq_mart` dimension source is judged by an envelope. The BUILDER writes that list,
 * and it writes it for mart sources alone — the Google-Sheet workflow writes none — so on a
 * sheet source the absence would print «not in this pacing's data yet» forever, over rows
 * that may carry the number. A sheet source stays SILENT, which is what it has always done:
 * a key the sheet does not map reads 0 there, exactly as `pc` and `pv` do.
 */
export function unavailableMetric(resolved, sources, grainKey) {
  if (!resolved || !sources || !hasOwn(sources, 'availableMetrics')) return null;
  let inventory = sources.availableMetrics;
  const ds = typeof grainKey === 'string' && /^ds:([^:]+):/.exec(grainKey);
  if (ds) {
    // Scanned, not looked up by key — `dimAxisLabel`'s own rule: an id like `constructor`
    // must not answer for a real source.
    const configs = Array.isArray(sources.dimSourceConfigs) ? sources.dimSourceConfigs : [];
    const cfg = configs.find((c) => c && typeof c === 'object' && c.id === ds[1]);
    if (!cfg || cfg.loader !== 'bq_mart') return null;
    // Read as an own property: a source id may be a word like `constructor`, and the map is
    // a plain object off the blob (the store's own rule, dashboardStore.js).
    const src = sources.dimSources && hasOwn(sources.dimSources, ds[1]) ? sources.dimSources[ds[1]] : null;
    inventory = src && Array.isArray(src.metrics) ? { delivery: src.metrics } : null;
  }
  const keys = resolved.kind === 'metric' ? [resolved.metric]
    : resolved.kind === 'formula' ? identifiersOf(resolved.expr) : [];
  for (const k of keys) {
    const why = metricAvailability(k, inventory);
    if (why) return why;
  }
  return null;
}
