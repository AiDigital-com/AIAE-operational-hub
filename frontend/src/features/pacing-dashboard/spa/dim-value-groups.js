// workspace/src/lib/dashboard/dim-value-groups.js
//
// Value groups of a line item (spec 2026-10-02, kept outside git): the workspace door.
//
// A line item's `dimGroups` say "on this line PMax_Brand and Search_Brand of Audience read
// as Brand". The store keeps the payload's row slices as fetched (`rawData`) and holds their
// GROUPED view everywhere else, so a dim split on Brand is an ordinary single-value split and
// no reader below the store has to know. This module builds that view, and keeps the member
// map the line card opens a group into.
//
// The rule itself is shared: the rewrite in @shared/pacing-core (dash-gate's Overview and the
// Slack summary run the same one), the save rules in @shared/dim-value-groups. Nothing in the
// workspace imports that second module except through here.
import PacingCore from './pacing-core.js';
import DimValueGroups from '@shared/dim-value-groups';

export const GROUP_DIM_KEYS = DimValueGroups.DIM_KEYS;
export const GROUP_DIM_LABELS = DimValueGroups.DIM_LABELS;
export const GROUP_LIMITS = DimValueGroups.LIMITS;
export const foldValue = DimValueGroups.fold;
export const canonGroups = DimValueGroups.canon;
export const validateGroupsLine = DimValueGroups.validateLine;
export const alignGroupSplits = DimValueGroups.alignSplits;
// Defined in coef-rebuild.js (that file takes no imports and is host-tested alone).
export { dimGroupsFingerprint } from './coef-rebuild.js';

/**
 * The rewrite index of a plan map: the store's normalised liPlan, or the blob's
 * planByLineItem (both carry `dimGroups`). null when no line has a group, and every helper
 * below then hands its input back untouched.
 */
export function groupIndexOf(planMap) {
  const pairs = [];
  for (const [id, p] of Object.entries(planMap || {})) {
    if (p && Array.isArray(p.dimGroups) && p.dimGroups.length) pairs.push({ id, groups: p.dimGroups });
  }
  return pairs.length ? PacingCore.buildDimGroupIndex(pairs) : null;
}

/**
 * availableSplits ({ [dim]: { [liId]: [values] } }) with a line's members replaced by their
 * group name, de-duplicated, first-seen order. The same object when nothing changes.
 */
export function groupedSplits(availableSplits, index) {
  if (!index || !availableSplits || typeof availableSplits !== 'object') return availableSplits;
  let out = availableSplits;
  for (const [liId, dims] of Object.entries(index)) {
    for (const dim of Object.keys(dims)) {
      const values = availableSplits[dim]?.[liId];
      if (!Array.isArray(values)) continue;
      const next = [];
      let changed = false;
      for (const v of values) {
        const name = PacingCore.dimGroupNameOf(index, liId, dim, v);
        const shown = name ?? v;
        if (name != null && name !== v) changed = true;
        if (next.includes(shown)) { changed = true; continue; }
        next.push(shown);
      }
      if (!changed) continue;
      if (out === availableSplits) out = { ...availableSplits };
      if (out[dim] === availableSplits[dim]) out[dim] = { ...availableSplits[dim] };
      out[dim][liId] = next;
    }
  }
  return out;
}

/**
 * The grouped view of the payload's row slices.
 *   raw = { factsDaily, creatives, conversions, dimSources, availableSplits }
 * (any of them may be absent). Returns `raw` ITSELF when index is null. Otherwise a new
 * object in which a slice is replaced only when one of its rows changed:
 *   - fact rows carry the dimensions as their own columns;
 *   - creative and conversion rows under filter_context.dims;
 *   - additional-data rows under `brk` (the seven name positions), inside
 *     dimSources[id].rows.
 */
export function groupedView(raw, index) {
  if (!index || !raw) return raw;
  const apply = PacingCore.applyDimGroups;
  const sources = raw.dimSources;
  let nextSources = sources;
  if (sources && typeof sources === 'object') {
    for (const [id, entry] of Object.entries(sources)) {
      const rows = entry && Array.isArray(entry.rows) ? apply(entry.rows, index, ['brk']) : null;
      if (rows && rows !== entry.rows) {
        if (nextSources === sources) nextSources = { ...sources };
        nextSources[id] = { ...entry, rows };
      }
    }
  }
  return {
    ...raw,
    factsDaily: apply(raw.factsDaily, index),
    creatives: apply(raw.creatives, index, ['filter_context', 'dims']),
    conversions: apply(raw.conversions, index, ['filter_context', 'dims']),
    dimSources: nextSources,
    availableSplits: groupedSplits(raw.availableSplits, index),
  };
}

// ── the member map ────────────────────────────────────────────────────────────────────
// buildLiSplitDaily sums a rewritten row into its group's bucket AND, here, into its member's
// own day map. The map rides on the aggregate object itself, the way primary-cv's split state
// does: a filtered facts object is assembled from a fixed key list, so a separate field would
// be missing under any filter or Period Scope.
const MEMBERS = new WeakMap();

/** members = { [liId]: { '<dim>:<name>': { [member]: { [date]: dayRow } } } } */
export function registerMembers(liSplitDaily, members) {
  if (liSplitDaily && members) MEMBERS.set(liSplitDaily, members);
}

/** null for an aggregate built from rows no group touched. */
export function memberDailyOf(liSplitDaily) {
  return (liSplitDaily && MEMBERS.get(liSplitDaily)) || null;
}
