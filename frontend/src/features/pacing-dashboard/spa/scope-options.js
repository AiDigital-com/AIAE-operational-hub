// workspace/src/lib/dashboard/scope-options.js
//
// What a widget SCOPE picker may offer, read off the pacing (spec §0.8; widget-builder v2
// §7.5). Three lists and nothing else — the channels this pacing runs on, its line items,
// and the values its facts carry for one dimension.
//
// It is the neutral source for the Builder's ScopePopover. Keeping the derivation outside
// the UI prevents multiple controls from offering different line-item lists for one pacing.
//
// Pure: the store slices arrive as arguments, so the same lists serve a host test. Nothing
// here reads a hook — that is the caller's seam.
//
// WHICH DIMENSIONS THE PICKER OFFERS, and why it is the catalog's list and not a shorter
// one. `metric-catalog.js:DIM_KEYS` is the ELEVEN keys `widgets-validate.mjs` accepts in a
// scope pin, `channel` included. The eleven are what the validator on both sides accepts,
// so they are what the picker
// offers — a picker shorter than the validator is a second, quieter rule. They are offered
// under `DIM_LABELS`, the one table this product names dimensions from, because the axis
// picker in the same window already does and `tactic` is called Funnel there.
//
// But a scope pin is a FILTER, and it runs against the facts' split map: `channel` is a
// property of the line item (normalize.js) and never a split, so a `channel` pin could only
// ever match nothing. That is a REASON, not a reason to hide the row (§1.1.3) — and the
// Channels list above it is where a channel is actually pinned. `dimKeyOptions` says both.
import { DIM_KEYS, DIM_LABELS } from './metric-catalog.js';

const obj = (o) => (o && typeof o === 'object' ? o : {});

/** The channels this pacing's line items run on, de-duplicated and sorted. */
export function channelOptions(liPlan) {
  const set = new Set(Object.values(obj(liPlan)).map((p) => p && p.ch).filter(Boolean));
  return [...set].sort().map((c) => ({ value: c, label: c }));
}

/** Every line item, named the way the dashboard names it — `display.liNames` when the
 *  pacing carries one, the bare id otherwise. */
export function liOptions(liPlan, liNames) {
  const names = obj(liNames);
  // Own-key: a line-item id is a string off the plan, and `names.constructor` answers the
  // Function constructor on a bare lookup — which would print as this LI's name.
  const nameOf = (id) => (Object.prototype.hasOwnProperty.call(names, id) ? names[id] : null);
  return Object.keys(obj(liPlan)).map((id) => ({
    value: id,
    label: nameOf(id) ? `${nameOf(id)} (${id})` : `LI ${id}`,
  }));
}

/**
 * makeDimValues(facts) → `(key) => [{value, label}]`, the values this pacing's facts carry
 * for one dimension key.
 *
 * Mined from the breakdown aggregate, whose keys are `dim:value`. Lazily and per key,
 * because a scope picker asks for exactly one dimension at a time and the map is large; the
 * returned function memoizes per key, so re-rendering the row costs one Map lookup.
 *
 * The key is an ARGUMENT and never closed over: a key-switch handler has to offer the NEW
 * key's values, and the round-6.1 bug was exactly a picker that handed the previous
 * dimension's first value to the new key.
 */
export function makeDimValues(facts) {
  const cache = new Map();
  return (key) => {
    if (!key || !facts) return [];
    if (cache.has(key)) return cache.get(key);
    const set = new Set();
    const lsd = obj(facts).liSplitDaily || {};
    for (const per of Object.values(lsd)) {
      for (const sk of Object.keys(obj(per))) {
        if (sk.startsWith(`${key}:`)) {
          const v = sk.slice(key.length + 1).trim();
          if (v && v !== '-') set.add(v);
        }
      }
    }
    const out = [...set].sort().map((v) => ({ value: v, label: v }));
    cache.set(key, out);
    return out;
  };
}

/** Why a channel cannot be pinned as a DIMENSION, and where it is pinned instead. */
export const CHANNEL_NOT_A_DIM = 'A channel is a property of the line item, so pin it with Channels above';
/** …and why any other key of the eleven may be missing from THIS pacing. Worded off the
 *  LABEL, never the storage key: `tactic` is called Funnel everywhere a reader has met it,
 *  and «no tactic values» is a sentence about a column name they have never seen. */
export const noValuesFor = (label) => `This pacing carries no ${label} values`;

/**
 * dimKeyOptions(dimValuesFor) → `[{key, label, reason}]` — the eleven keys the validator
 * accepts, each in the words this product prints for it, and each with why it cannot be
 * pinned on this pacing, or null.
 *
 * The LABEL rides along because the same builder window names these dimensions twice: the
 * Rows / X / Slice-by picker reads `DIM_LABELS` («Audience», «Funnel»), and this one printed
 * the bare key two rows above it. One window saying `tactic` in one place and Funnel in
 * another reads as two different settings, and somebody looking for Funnel never finds it.
 *
 * The list is never shortened (§1.1.3): a dimension that is absent here is absent for a
 * reason the reader can act on, and a picker that dropped it is what makes people believe
 * the dimension does not exist.
 */
export function dimKeyOptions(dimValuesFor) {
  const values = typeof dimValuesFor === 'function' ? dimValuesFor : () => [];
  return DIM_KEYS.map((key) => {
    const label = DIM_LABELS[key] || key;
    return {
      key,
      label,
      reason: key === 'channel'
        ? CHANNEL_NOT_A_DIM
        : (values(key).length ? null : noValuesFor(label)),
    };
  });
}
