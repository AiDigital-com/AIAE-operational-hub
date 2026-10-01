// workspace/src/lib/mapping/rows.js
//
// Shared row-shaping for Mapping v3 classification inputs. Extracted so the
// Settings → Mapping tab (MappingV3Tab) and the Dashboard "Delivery vs CM360"
// widget (ThirdPartyPanel) derive delivery rows and CM360 placement groups from
// the SAME keying. This guarantees the keys that come out of classifyAll's
// deliveryCells / cm360Cells line up byte-for-byte with the keys the widget
// feeds pivotCompare's daily series (dimValueFor looks a daily row's cell up by
// its `key`). If the two sides keyed rows differently, classified cells would
// silently miss and every daily row would fall into "Unmapped".

import MappingDims from '@shared/mapping-dims';
import { buildEffectiveMapping as buildEffectiveMappingCore } from './effective.js';
import { buildDeliverySubRows } from './delivery-rows.js';

// v3.1 shared classify surface — BOTH consumers (MappingV3Tab + ThirdPartyPanel)
// must classify over the same effective view; see effective.js for the core +
// the host-testability rationale behind the deriveAutoValues injection.
export { buildDeliveryCreativesMap, mergeAutoValues, expandDeliveryLiOverrides } from './effective.js';

// D4 (spec 2026-07-10): sub-row key helpers re-exported for components — the
// widget's daily series and the Row-tables clear path key rows through these.
export {
  SEP as DELIVERY_KEY_SEP, deliverySubKey, deliverySubKeyFromFactsRow, subRowLabel,
  creativesBySubRow,
} from './delivery-rows.js';

// D5 (spec 2026-07-10): creative↔creative comparison-level builders + daily key
// helpers re-exported for both consumers (MappingV3Tab editor + ThirdPartyPanel).
export {
  creativeRowKey, cm360CreativeKey, deliveryCreativeDailyKey, cm360CreativeDailyKey,
  buildDeliveryCreativeRows, buildCm360CreativeGroups, creativeCoverage,
  cm360PlacementKey, buildCm360Groups, latestSeen,
} from './delivery-rows.js';

/**
 * buildEffectiveMapping(mapping, deliveryRows) — the component-facing form: the
 * stored mapping with auto-dim values live-derived from delivery data and merged
 * with stored user aliases. Render/classify view ONLY — never persist it.
 */
export function buildEffectiveMapping(mapping, deliveryRows) {
  return buildEffectiveMappingCore(mapping, deliveryRows, MappingDims.deriveAutoValues);
}

/**
 * Delivery classify rows — D4 (spec 2026-07-10): one per LI × split-fields
 * tuple (see delivery-rows.js). key/liId/label/display/fields/impressions;
 * name '' (delivery classifies by structured-field equality, never by name).
 */
export function buildDeliveryRows(factsDaily, types, liPlan) {
  return buildDeliverySubRows(factsDaily || [], types || [], liPlan || {});
}
