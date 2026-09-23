import { describe, expect, it } from "vitest";
import { chartPaint, palettePaint } from "./chart-paint";

/**
 * `chartPaint` is the one place a stored series' `color`/`fill`/`border` token turns into a CSS
 * paint - the SPA's `SEMANTIC_PAINT` map, ported verbatim (see chart-paint.ts's doc comment). These
 * assertions are the actual mechanism, unlike the ResponsiveContainer-wrapped chart itself, which
 * jsdom lays out at 0×0 and renders nothing inside.
 */
describe("chartPaint", () => {
  it("resolves a known semantic token to its CSS variable", () => {
    expect(chartPaint("actual")).toBe("var(--c-actual)");
    expect(chartPaint("actualFill")).toBe("var(--c-actual-fill)");
    expect(chartPaint("spend")).toBe("var(--c-spend)");
    expect(chartPaint("spendFill")).toBe("var(--c-spend-fill)");
    expect(chartPaint("bar")).toBe("var(--c-bar)");
    expect(chartPaint("barBorder")).toBe("var(--c-bar-bd)");
    expect(chartPaint("impressions")).toBe("var(--c-bar-im)");
    expect(chartPaint("impressionsBorder")).toBe("var(--c-bar-im-bd)");
    expect(chartPaint("expected")).toBe("var(--c-expected)");
    expect(chartPaint("ctr")).toBe("var(--c-ctr)");
    expect(chartPaint("vcr")).toBe("var(--c-vcr)");
    expect(chartPaint("cpm")).toBe("var(--c-cpm)");
  });

  it("falls back to the palette for 'auto', a number, null/undefined, or an unknown token", () => {
    expect(chartPaint("auto", 1)).toBe(palettePaint(1));
    expect(chartPaint(2, 0)).toBe(palettePaint(2));
    expect(chartPaint(undefined, 0)).toBe(palettePaint(0));
    expect(chartPaint(null, 0)).toBe(palettePaint(0));
    // Not one of the closed SEMANTIC_PAINT keys - a wire value must never be trusted without an
    // own-property check (widget-types.ts's doc comment), so this degrades to the palette rather
    // than throwing or drawing "undefined".
    expect(chartPaint("not-a-real-token", 0)).toBe(palettePaint(0));
  });

  it("cycles the palette by index, wrapping for negative and out-of-range values", () => {
    expect(palettePaint(0)).toBe("var(--primary)");
    expect(palettePaint(3)).toBe(palettePaint(0));
    expect(palettePaint(-1)).toBe(palettePaint(2));
  });
});
