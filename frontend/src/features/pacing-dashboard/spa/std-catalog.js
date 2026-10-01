// workspace/src/lib/dashboard/std-catalog.js
//
// The workspace's door onto @shared/std-entries. Standard entries are an exact,
// closed `std:v2:*` template catalog bundled with the client. Choosing one clones its
// definition into a private inline Widget; these keys are receipts/template ids, never
// runtime Library identity.
import StdEntries from '@shared/std-entries';

export const { CHART_ORDER, PRESET_ORDER, CARD_ORDER, isStdKey, STD_VERSION, SEED_ID_BY_KEY, seedKeyOf, seedSlotOf } = StdEntries;

/**
 * The rate-type auto-add rules (spec §1a.1) — the SAME function the cutover converter and
 * create-path seed run server-side. The store's load-time hook calls it with normalized plans, so
 * it accepts both field spellings on every input it reads.
 */
export const { autoAddKeys } = StdEntries;

/** Freeze the object, then everything under it. The isFrozen guard makes it cheap on a
 *  re-visit and safe on a cycle; a definition has neither, but a helper that only works
 *  on trees is a helper that breaks silently the day one appears. */
function deepFreeze(v) {
  if (!v || typeof v !== 'object' || Object.isFrozen(v)) return v;
  Object.freeze(v);
  for (const k of Object.keys(v)) deepFreeze(v[k]);
  return v;
}

/**
 * The Standard catalog the client hands out: a deep-frozen private COPY of each entry, minted
 * once at module load.
 *
 * Freezing protects previews and materializers from mutating a template before it is
 * cloned. It is a COPY because the UMD object is also consumed outside the workspace;
 * browser-side protection must not reach back into that shared module.
 *
 * 32 small objects, cloned once: the cost is a fraction of a millisecond at start-up.
 */
export const STD_ENTRIES = Object.freeze(StdEntries.STD_ENTRIES.map((e) => deepFreeze(structuredClone(e))));

/** key → entry, frozen at module load. The same object every time, so a memo can key on it. */
export const STD_ENTRY_MAP = Object.freeze(Object.fromEntries(STD_ENTRIES.map((e) => [e.key, e])));

/**
 * Own-key checked, so 'constructor' and friends can never answer for an entry — the
 * same contract as the UMD's `stdEntry`, over the door's frozen copies rather than the
 * shared originals. Two objects for one key, handed out by one module, is exactly the
 * inconsistency this file exists to prevent.
 */
export function stdEntry(key) {
  if (typeof key !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(STD_ENTRY_MAP, key) ? STD_ENTRY_MAP[key] : null;
}
