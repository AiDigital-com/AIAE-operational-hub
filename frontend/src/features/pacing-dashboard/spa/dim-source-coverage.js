// Source-level connection proof for Settings -> Data.
// Mapping owns what values mean; this ratio only asks whether the imported file
// carries the pacing's own amount over the same line items and flights.

import { coverageMetricFor } from './sheet-source-norm.js';
import { valueTally, deliveredUnits } from './dim-group-rules.js';

export function dimSourceCoverage(source, entry, liDaily, lineItems) {
  const rows = entry && Array.isArray(entry.rows) ? entry.rows : [];
  const dim = source?.origin?.columns?.dims?.[0];
  const metric = coverageMetricFor(source);
  if (!rows.length || !dim || !metric || !liDaily) return null;
  const liPlan = Object.fromEntries((lineItems || []).map((li) => [String(li.id), {
    fs: li.fs || null, fe: li.fe || null,
  }]));
  // Connection coverage is pacing-wide. Restricting the denominator to line
  // items that happened to appear in the source makes an entirely missing LI
  // invisible and can turn a partial source into a reassuring 100%.
  const plannedIds = new Set((lineItems || []).map((li) => String(li?.id || '')).filter(Boolean));
  const ids = plannedIds.size ? plannedIds
    : new Set(rows.map((row) => String(row?.line_item_id || '')).filter(Boolean));
  const tally = valueTally(rows, dim.key, metric.key, { liPlan });
  const imported = tally.reduce((sum, value) => sum + (Number(value.weight) || 0), 0)
    + (Number(tally.blankWeight) || 0);
  const delivered = deliveredUnits(liDaily, liPlan, metric.key, ids);
  return delivered > 0 ? { ratio: imported / delivered, metric: metric.label } : null;
}
