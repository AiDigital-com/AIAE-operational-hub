// workspace/src/lib/dashboard/tile-slots.js
//
// The page slot of a tile id (sections cutover 2026-09-07, spec §5): a functional block's
// FLOW_SLOTS entry, or the catalogue seedSlot behind a fixed Standard instance id, or null
// for everything the grid appends the way it always has (a hand-built widget, a KPI card, a
// Standard tile re-minted under a random id by a layout Apply).
import { FLOW_SLOTS } from './display-blocks.js';
import { seedSlotOf } from './std-catalog.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export function tileSlot(id) {
  if (typeof id !== 'string') return null;
  if (hasOwn(FLOW_SLOTS, id)) return FLOW_SLOTS[id];
  return seedSlotOf(id);
}
