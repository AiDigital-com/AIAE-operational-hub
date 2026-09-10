/**
 * Presentation thresholds shared by every brick that colors itself off a pace/margin delta. Ported
 * verbatim (same bands, same words) from the retired SPA's `lib/dashboard/widget-status.js` - the
 * pacing figures must read the same status word here as they did there for the same delta.
 */

export type Tone = "g" | "w" | "b" | "n";

export function paceStatus(delta: number): Tone {
  return delta >= 0 ? "g" : delta >= -5 ? "w" : "b";
}

export function paceWord(delta: number): string {
  if (delta > 5) return "Ahead of pace";
  if (delta >= -2) return "On track";
  if (delta >= -5) return "Slightly behind";
  return "Shortfall";
}

export function marginStatus(delta: number): Tone {
  return delta >= 0 ? "g" : delta >= -5 ? "w" : "b";
}

export function marginWord(delta: number): string {
  if (delta >= 2) return "Above target";
  if (delta >= -2) return "On target";
  if (delta >= -5) return "Slightly below";
  return "Below target";
}

/** Fixed per-campaign meter scale: [target - 20, target + 10], clamped to 0..100. */
export function meterBounds(target: number): { min: number; max: number } {
  const rounded = Math.round(target || 0);
  const min = Math.max(0, rounded - 20);
  const max = Math.min(100, Math.max(min + 10, rounded + 10));
  return { min, max };
}

/** Tone → CSS color token, the Hub's own good/warn/bad/neutral vocabulary (see `margin-cell.css`,
 *  `pacing-overview/format.ts`), not the SPA's `--status-*` tokens which don't exist here. */
export const TONE_COLOR: Record<Tone, string> = {
  g: "var(--good)",
  w: "var(--attention-text)",
  b: "var(--bad)",
  n: "var(--muted)",
};
