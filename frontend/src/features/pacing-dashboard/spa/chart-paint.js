// One closed presentation token -> one CSS paint. The Widget renderer and Builder
// both read this function, so a semantic built-in never shows a palette swatch that
// disagrees with the line or bar in Preview.

export const SEMANTIC_PAINT = Object.freeze({
  actual: 'var(--c-actual)',
  actualFill: 'var(--c-actual-fill)',
  expected: 'var(--c-expected)',
  expectedFill: 'var(--c-expected)',
  spend: 'var(--c-spend)',
  spendFill: 'var(--c-spend-fill)',
  bar: 'var(--c-bar)',
  barFill: 'var(--c-bar)',
  barBorder: 'var(--c-bar-bd)',
  barBorderFill: 'var(--c-bar-bd)',
  impressions: 'var(--c-bar-im)',
  impressionsFill: 'var(--c-bar-im)',
  impressionsBorder: 'var(--c-bar-im-bd)',
  impressionsBorderFill: 'var(--c-bar-im-bd)',
  ctr: 'var(--c-ctr)',
  ctrFill: 'var(--c-ctr-fill)',
  vcr: 'var(--c-vcr)',
  vcrFill: 'var(--c-vcr-fill)',
  cpm: 'var(--c-cpm)',
  cpmFill: 'var(--c-cpm)',
  cpc: 'var(--c-cpc)',
  cpcFill: 'var(--c-cpc)',
  cpv: 'var(--c-vcr)',
  cpvFill: 'var(--c-vcr-fill)',
});

export const palettePaint = (index) => {
  const numeric = Number(index);
  const slot = Number.isFinite(numeric) ? ((numeric % 8) + 8) % 8 : 0;
  return `var(--pal-${slot})`;
};

export function chartPaint(paint, autoIndex = 0) {
  if (paint == null || paint === 'auto') return palettePaint(autoIndex);
  if (typeof paint === 'number') return palettePaint(paint);
  return SEMANTIC_PAINT[paint] || palettePaint(autoIndex);
}
