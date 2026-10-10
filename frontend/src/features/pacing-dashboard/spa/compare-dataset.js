// workspace/src/lib/mapping/compare-dataset.js
//
// Seam 1 of the Delivery x CM360 adapter (spec 2026-08-18 §8.5): the numeric
// dataset, built ONCE per (facts, creatives, cm360, mapping) tuple. Everything
// here is derived from data alone — no viewer state, no clock, no React.
//
// It is a transcription of ThirdPartyPanel.jsx:200-332 + :427-433 + :493, which
// stays the frozen reference until P4's dual-run. Two rules exist NOWHERE else
// in the codebase and are the reason this file is a transcription and not a
// re-derivation:
//   1. the delivery daily series renames the facts column `completes` to
//      `completions` (the name every kernel and both metric switches use);
//   2. the CM360 daily series' `completions` is video_completions +
//      audio_completions (the export splits them across two BigQuery tables).
// The kernels themselves (buildDeliveryRows, buildCm360Groups, classifyAll, …)
// are NOT reimplemented here — they are called, exactly as the panel calls them.
//
// Entity SELECTION is deliberately outside: the caller picks which mapping
// entity drives the comparison (compare-state.js:resolveMappingChoice) and
// hands the chosen one in, so this seam has one input and one output.

import MappingDims from '@shared/mapping-dims';
import {
  buildDeliveryRows, buildCm360Groups, cm360PlacementKey,
  buildEffectiveMapping, buildDeliveryCreativesMap,
  deliverySubKeyFromFactsRow, creativesBySubRow,
  buildDeliveryCreativeRows, buildCm360CreativeGroups,
  deliveryCreativeDailyKey, cm360CreativeDailyKey, creativeCoverage,
} from './rows.js';

const { classifyAll } = MappingDims;

/** The comparison levels a dimensions mapping may declare (D5, spec 2026-07-10). */
export const COMPARISON_LEVELS = Object.freeze(['placement', 'creative', 'li_creative']);

/**
 * The entity's comparison level. Anything a mapping does not explicitly declare
 * is placement — including a null mapping (ThirdPartyPanel.jsx:209).
 */
export function comparisonLevelOf(mapping) {
  return (mapping && (mapping.level === 'creative' || mapping.level === 'li_creative'))
    ? mapping.level
    : 'placement';
}

/** A mapping entity is usable only when it actually carries a dimensions array (panel :206). */
export function usableMapping(entity) {
  return entity && Array.isArray(entity.dimensions) ? entity : null;
}

/**
 * Delivery daily series. Keys match classifyAll's deliveryCells, dates are ISO.
 * At creative level the rows come from the creatives aux; otherwise from facts,
 * where a row without a line_item_id has no key and is dropped.
 */
function buildDeliveryDaily(level, factsDaily, creatives) {
  const out = [];
  if (level === 'creative') {
    for (const r of (creatives || [])) {
      const key = deliveryCreativeDailyKey(r);
      const date = r && r.date != null ? String(r.date) : '';
      if (!key || !date) continue;
      out.push({
        key,
        date,
        impressions: Number(r.impressions) || 0,
        clicks: Number(r.clicks) || 0,
        completions: Number(r.completes) || 0,
      });
    }
    return out;
  }
  for (const f of (factsDaily || [])) {
    const key = f.line_item_id == null || f.line_item_id === '' ? '' : deliverySubKeyFromFactsRow(f);
    const date = f.date == null ? '' : String(f.date);
    if (!key || !date) continue;
    out.push({
      key,
      date,
      impressions: Number(f.impressions) || 0,
      clicks: Number(f.clicks) || 0,
      completions: Number(f.completes) || 0,
    });
  }
  return out;
}

/**
 * CM360 daily series. Placement level keys by placement, the two creative levels
 * key by (placement, creative). `completions` is the video + audio sum — the CM360
 * export carries the two in separate columns and no consumer wants them apart.
 */
function buildCm360Daily(level, cm360Raw) {
  const out = [];
  for (const r of cm360Raw) {
    const key = level === 'placement' ? cm360PlacementKey(r) : cm360CreativeDailyKey(r);
    const date = r && r.date != null ? String(r.date) : '';
    if (!key || !date) continue;
    out.push({
      key,
      date,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      completions: (Number(r.video_completions) || 0) + (Number(r.audio_completions) || 0),
    });
  }
  return out;
}

/**
 * buildCm360ComparisonDataset({factsDaily, types, liPlan, creatives, cm360Raw, mapping})
 *   → { level, mapping, effectiveMapping, dims,
 *       deliveryRows, cm360Rows, activeDeliveryRows, activeCm360Rows,
 *       deliveryDaily, cm360Daily, classified, anyBridge, creativeCoverage }
 *
 * `mapping` is ONE dimensions-kind entity (or null). `deliveryRows` / `cm360Rows`
 * are the placement-level row sets: the effective mapping ALWAYS derives from the
 * LI sub-rows (so auto Channel/Tactic values survive a creative-level mapping),
 * and `cm360Rows.length === 0` is the "no CM360 to compare" signal every state
 * ladder reads — which is why both stay on the result next to the active pair.
 */
export function buildCm360ComparisonDataset({
  factsDaily = null, types = null, liPlan = null,
  creatives = null, cm360Raw = null, mapping = null,
  // Display names (spec docs/2026-09-24-display-names.md): raw creative → shown name, for the
  // comparison's delivery member lines only. Classification never reads it.
  creativeLabel = null,
  // Value groups (spec 2026-10-02): the lines' dictionaries as an index (the dashboard door's
  // `groupIndexOf`), carried for the widget join only. Classification never reads it: the
  // mapping works on the values as delivered.
  dimGroupIndex = null,
} = {}) {
  const entity = usableMapping(mapping);
  const level = comparisonLevelOf(entity);
  const cm360 = Array.isArray(cm360Raw) ? cm360Raw : [];

  const deliveryRows = buildDeliveryRows(factsDaily, types, liPlan);
  const cm360Rows = buildCm360Groups(cm360);
  const activeDeliveryRows = level === 'creative'
    ? buildDeliveryCreativeRows(creatives, factsDaily, types, creativeLabel)
    : deliveryRows;
  const activeCm360Rows = level === 'placement' ? cm360Rows : buildCm360CreativeGroups(cm360);

  // The effective mapping merges live-derived auto-dim values with stored user
  // aliases, and derives from deliveryRows — NOT activeDeliveryRows (panel :247).
  const effectiveMapping = buildEffectiveMapping(entity, deliveryRows);
  const dims = effectiveMapping ? effectiveMapping.dimensions : [];
  const deliveryCreativesByRow = creativesBySubRow(buildDeliveryCreativesMap(creatives), deliveryRows);

  const classified = classifyAll({
    deliveryRows: activeDeliveryRows,
    cm360Rows: activeCm360Rows,
    mapping: effectiveMapping || { dimensions: [] },
    // At creative level the creative names ARE the rows, so extending the LI
    // token surface with them would match a row against itself (panel :281).
    deliveryCreatives: level === 'creative' ? null : deliveryCreativesByRow,
  });

  return {
    level,
    mapping: entity,
    effectiveMapping,
    dims,
    deliveryRows,
    cm360Rows,
    activeDeliveryRows,
    activeCm360Rows,
    deliveryDaily: buildDeliveryDaily(level, factsDaily, creatives),
    cm360Daily: buildCm360Daily(level, cm360),
    classified,
    // Any dimension classifying BOTH sides bridges them — including an auto dim
    // whose aliases reach CM360 (spec §10.2). One bridge is enough to compare.
    anyBridge: classified.perDim.some((pd) => pd.dCount > 0 && pd.cCount > 0),
    // Creative rows can only thin the delivery side, so coverage is a
    // creative-level concern; at placement level there is nothing to under-cover.
    creativeCoverage: level === 'creative' ? creativeCoverage(creatives, factsDaily) : null,
    // Sparse: a comparison built without groups carries no such key.
    ...(dimGroupIndex ? { dimGroupIndex } : null),
  };
}
