/**
 * One closed presentation token -> one CSS paint, ported from the retired SPA's
 * `lib/dashboard/chart-paint.js` (`SEMANTIC_PAINT` + `chartPaint`) so a stored series' `color`/`fill`/
 * `border` token resolves to the SAME hue here as it did there. The `--c-*` variables these resolve to
 * live in `src/app/tokens.css`, values copied from the SPA's `index.css`.
 *
 * The numeric/`"auto"` fallback path (`palettePaint`) is the only place this file invents a color: a
 * series with no semantic token cycles the Hub's small existing chart palette, exactly as the SPA's
 * `chartPaint` cycles its own `--pal-*` set for the same case.
 */
const SEMANTIC_PAINT: Record<string, string> = {
  actual: "var(--c-actual)",
  actualFill: "var(--c-actual-fill)",
  expected: "var(--c-expected)",
  expectedFill: "var(--c-expected)",
  spend: "var(--c-spend)",
  spendFill: "var(--c-spend-fill)",
  bar: "var(--c-bar)",
  barFill: "var(--c-bar)",
  barBorder: "var(--c-bar-bd)",
  barBorderFill: "var(--c-bar-bd)",
  impressions: "var(--c-bar-im)",
  impressionsFill: "var(--c-bar-im)",
  impressionsBorder: "var(--c-bar-im-bd)",
  impressionsBorderFill: "var(--c-bar-im-bd)",
  ctr: "var(--c-ctr)",
  ctrFill: "var(--c-ctr-fill)",
  vcr: "var(--c-vcr)",
  vcrFill: "var(--c-vcr-fill)",
  cpm: "var(--c-cpm)",
  cpmFill: "var(--c-cpm)",
  cpc: "var(--c-cpc)",
  cpcFill: "var(--c-cpc)",
  cpv: "var(--c-vcr)",
  cpvFill: "var(--c-vcr-fill)",
};

/** The Hub's small chart palette (3 slots, unlike the SPA's 8 `--pal-*`) - kept as-is rather than
 *  growing to match, since nothing here authors a series with a numeric/auto color today; this is
 *  only the safety-net path for one that eventually does. */
const PALETTE = ["var(--primary)", "hsl(var(--chart-sky))", "hsl(var(--chart-grey))"];

export function palettePaint(index: number): string {
  const numeric = Number(index);
  const slot = Number.isFinite(numeric) ? ((numeric % PALETTE.length) + PALETTE.length) % PALETTE.length : 0;
  return PALETTE[slot];
}

/** Resolves a stored `color`/`fill`/`border` token to its CSS paint. `paint` is untyped input off the
 *  wire (§ widget-types.ts doc comment: never trust a `config_json` value as a closed type without an
 *  own-property check), so every branch below is a value check, not a cast. */
export function chartPaint(paint: unknown, autoIndex = 0): string {
  if (paint == null || paint === "auto") return palettePaint(autoIndex);
  if (typeof paint === "number") return palettePaint(paint);
  if (typeof paint === "string" && Object.prototype.hasOwnProperty.call(SEMANTIC_PAINT, paint)) {
    return SEMANTIC_PAINT[paint];
  }
  return palettePaint(autoIndex);
}
