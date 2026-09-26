/**
 * Distinct-value extraction over `factsDaily` rows, for the tag palette's dsp/breakdown-dim sources.
 * Ported from the two functions of the retired SPA's `workspace/src/lib/dashboard/breakdown-filter.js`
 * the journal palette actually uses (`derivePlatforms`/`deriveDimValues`, plus the `formatPlatform`
 * label table) - not the whole file, which is a much larger widget-filtering module out of scope here.
 *
 * `factsDaily` rows are opaque, untyped objects on the wire (`additionalProperties: true` - see
 * `PacingDashboardV1.factsDaily` in `types.ts`), passed through byte-for-byte from Pacing, so these
 * read dimension columns (`platform`, `tactic`, `audience`, `geo`, …) with no compile-time guarantee
 * they exist on a given row - exactly the shape the reference itself assumes.
 */

export type FactRow = Record<string, unknown>;

/** Distinct non-empty `platform` values from `factsDaily`, sorted. */
export function derivePlatforms(factsDaily: readonly FactRow[] | null | undefined): string[] {
  if (!Array.isArray(factsDaily)) return [];
  const set = new Set<string>();
  for (const f of factsDaily) {
    const v = f && f.platform != null ? String(f.platform).trim() : "";
    if (v) set.add(v);
  }
  return Array.from(set).sort();
}

/** Distinct non-empty values of a breakdown dim from `factsDaily`, sorted. Generalizes
 *  `derivePlatforms` to any dim (tactic, geo, audience, …). `''` / `'-'` are skipped. */
export function deriveDimValues(factsDaily: readonly FactRow[] | null | undefined, dim: string): string[] {
  if (!Array.isArray(factsDaily) || !dim) return [];
  const set = new Set<string>();
  for (const f of factsDaily) {
    const raw = f && f[dim] != null ? String(f[dim]).trim() : "";
    if (raw && raw !== "-") set.add(raw);
  }
  return Array.from(set).sort();
}

// Raw `platform` values from BQ are tech slugs (dv_360_dlv, TTD, …). The display layer renders the
// prettified label; the raw value stays for tag matching. Unknown raw values pass through unchanged.
export const PLATFORM_LABELS: Record<string, string> = {
  dv_360_dlv: "DV360",
  TTD: "The Trade Desk",
  beeswax: "Beeswax",
  Beeswax: "Beeswax",
  facebook: "Facebook",
  Facebook: "Facebook",
  amazon: "Amazon DSP",
  Amazon: "Amazon DSP",
  google_ads: "Google Ads",
  "Google Ads": "Google Ads",
  linkedin: "LinkedIn",
  LinkedIn: "LinkedIn",
};

export function formatPlatform(raw: unknown): string {
  if (raw == null) return "";
  return PLATFORM_LABELS[String(raw)] ?? String(raw);
}
