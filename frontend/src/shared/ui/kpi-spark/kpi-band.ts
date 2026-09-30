/**
 * CTR/VCR band colouring, ported verbatim from Pacing's `shared/kpi-band.js` — the single source of
 * this rule on the Pacing side, consumed there by both the dashboard and its Overview sparklines.
 *
 * Band model (ratio r = actual / target):
 * - `g` (good):    r >= 1 AND (high == null || r <= high)
 * - `w` (warn):    low != null AND low <= r < 1
 * - `b` (bad):     (low != null && r < low) || (high != null && r > high)
 * - `n` (neutral): target invalid / ratio not finite
 *
 * A null bound means "that side is disabled" (no flag on that side) — VCR, for instance, has no
 * upper band on the Pacing side: a high completion rate is good.
 */
export type KpiBand = "g" | "w" | "b" | "n";

/**
 * Bands a KPI ratio against its low/high bounds.
 *
 * @param ratio actual / target
 * @param low   lower bound as a ratio of target, or null when that side is disabled
 * @param high  upper bound as a ratio of target, or null when disabled
 */
export function kpiBandStatus(ratio: number | null | undefined, low: number | null, high: number | null): KpiBand {
  if (ratio == null || !isFinite(ratio)) return "n";
  if (ratio >= 1) {
    if (high != null && ratio > high) return "b";
    return "g";
  }
  // ratio < 1
  if (low == null) return "g"; // lower bound disabled -> not flagged
  if (ratio < low) return "b";
  return "w";
}
