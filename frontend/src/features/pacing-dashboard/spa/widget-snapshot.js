import { getEffPlan } from './config.js';

// Store slices are replaced on change. Keep a few immutable readings of each
// facts snapshot across tiles, period round trips and restarted React mounts.
// The weak owner releases everything when its dashboard facts leave the store.
const snapshots = new WeakMap();
const plans = new WeakMap();
const LIMIT = 12;
const sameRefs = (a, b) => a.length === b.length && a.every((ref, i) => ref === b[i]);

export function memoWidgetSnapshot(facts, refs, key, build) {
  let entries = snapshots.get(facts);
  if (!entries) snapshots.set(facts, entries = []);
  const index = entries.findIndex((entry) => entry.key === key && sameRefs(entry.refs, refs));
  if (index >= 0) {
    const [entry] = entries.splice(index, 1);
    entries.push(entry);
    return entry.data;
  }
  const data = build();
  // Shallow freezing preserves the lazy liSplitDaily getter. It also marks the
  // immutable store contract for aggregate/model caches; ad-hoc mutable inputs
  // to the pure renderers remain uncached.
  Object.freeze(data.sources);
  Object.freeze(data.range);
  Object.freeze(data);
  entries.push({ refs, key, data });
  if (entries.length > LIMIT) entries.shift();
  return data;
}

export function widgetPlanMap(liPlan, dimPlans, periodMode, periodPlans) {
  if (!dimPlans && !periodMode) return liPlan;
  let entries = plans.get(liPlan);
  if (!entries) plans.set(liPlan, entries = []);
  const refs = [dimPlans, periodMode, periodPlans];
  const found = entries.find((entry) => sameRefs(entry.refs, refs));
  if (found) return found.value;
  const value = Object.fromEntries(Object.keys(liPlan).map((id) => [id,
    dimPlans?.[id] || getEffPlan(liPlan, id, periodMode, periodPlans) || liPlan[id],
  ]));
  Object.freeze(value);
  entries.push({ refs, value });
  if (entries.length > LIMIT) entries.shift();
  return value;
}
