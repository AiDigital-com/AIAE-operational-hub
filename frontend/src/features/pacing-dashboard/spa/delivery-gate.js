// Delivery tab ceiling — one place decides whether the switch may be ticked, so
// the checkbox and the sentence under it can never disagree.
//
// The number is cells (rows × columns), because that is the unit Google caps a
// spreadsheet in, and because rows vary in width by 6× across the fleet. The
// build enforces the same constant in shared/pacing-build.js.
//
// Spec: docs/superpowers/specs/2026-08-20-delivery-cap-sheet-mirror-design.md §4
export const DELIVERY_CELL_CAP = 3000000;

const fmt = (n) => Number(n).toLocaleString('en-US');

function measuredOn(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * @param {{rows?: number, cells?: number, measuredAt?: string}|null} stats
 *        What the last build measured, or null when the tab has never been built
 *        (the flag was never on, so there is nothing to measure yet).
 * @returns {{disabled: boolean, reason: string|null}}
 */
export function deliveryGate(stats) {
  const cells = stats && typeof stats.cells === 'number' ? stats.cells : null;
  if (cells === null || cells <= DELIVERY_CELL_CAP) return { disabled: false, reason: null };
  const when = measuredOn(stats.measuredAt);
  return {
    disabled: true,
    reason: `Too large for this pacing: ${fmt(cells)} cells against the ${fmt(DELIVERY_CELL_CAP)} limit`
      + (when ? ` (measured ${when}).` : '.'),
  };
}
