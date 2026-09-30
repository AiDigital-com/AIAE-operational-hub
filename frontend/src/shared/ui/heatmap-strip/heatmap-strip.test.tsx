import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { aPacingRecentDayV1 } from "@/test/factories";
import { fmtRate, heatmapDeliveryColor, heatmapRateColor, HeatmapStrip, unitLabel } from "./heatmap-strip";

describe("heatmapDeliveryColor", () => {
  it("should be neutral with no target, and band within ±5% green / below red / above amber", () => {
    // Then: the ported bands, verbatim from Pacing's own HeatmapStrip
    expect(heatmapDeliveryColor(500, 0)).toEqual({ color: "var(--muted)", opacity: 0.3 });
    expect(heatmapDeliveryColor(100, 100).color).toBe("var(--good)");
    expect(heatmapDeliveryColor(96, 100).color).toBe("var(--good)");
    expect(heatmapDeliveryColor(94, 100).color).toBe("var(--bad)");
    expect(heatmapDeliveryColor(106, 100).color).toBe("var(--attention)");
  });

  it("should scale opacity with the ratio, clamped to 0.4..0.9", () => {
    expect(heatmapDeliveryColor(10, 100).opacity).toBe(0.4);
    expect(heatmapDeliveryColor(70, 100).opacity).toBe(0.7);
    expect(heatmapDeliveryColor(500, 100).opacity).toBe(0.9);
  });
});

describe("heatmapRateColor", () => {
  it("should read cheaper-than-target as good, up to +15% as amber, beyond as red", () => {
    expect(heatmapRateColor(0, 10)).toEqual({ color: "var(--muted)", opacity: 0.3 });
    expect(heatmapRateColor(10, 0)).toEqual({ color: "var(--muted)", opacity: 0.3 });
    expect(heatmapRateColor(9, 10).color).toBe("var(--good)");
    expect(heatmapRateColor(11, 10).color).toBe("var(--attention)");
    expect(heatmapRateColor(13, 10).color).toBe("var(--bad)");
  });
});

describe("fmtRate / unitLabel", () => {
  it("should format CPM at 2 decimals and sub-dollar CPC/CPV at 4", () => {
    expect(fmtRate(0.48, "CPM")).toBe("$0.48");
    expect(fmtRate(0.0005, "CPC")).toBe("$0.0005");
    expect(fmtRate(2.5, "CPV")).toBe("$2.50");
    expect(fmtRate(null, "CPM")).toBe("—");
  });

  it("should label the native unit per rate type", () => {
    expect(unitLabel("CPC")).toBe("Clicks");
    expect(unitLabel("CPV")).toBe("Views");
    expect(unitLabel("CPM")).toBe("Impr");
    expect(unitLabel(undefined)).toBe("Impr");
  });
});

describe("HeatmapStrip", () => {
  it("should render a dash with fewer than 2 days", () => {
    // When:
    render(<HeatmapStrip recent={[aPacingRecentDayV1()]} rateType="CPM" />);

    // Then:
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("should render one cell group per day, capped at 7", () => {
    // Given: nine days - only the most recent seven get cells
    const recent = Array.from({ length: 9 }, (_, i) => aPacingRecentDayV1({ date: `2026-09-1${i}` }));

    // When:
    const { container } = render(<HeatmapStrip recent={recent} rateType="CPM" />);

    // Then: 3 rects per day (fill, rate bar, hover target)
    expect(container.querySelectorAll("g")).toHaveLength(7);
    expect(container.querySelectorAll("rect")).toHaveLength(21);
  });

  it("should raise a tooltip with the day's volume and rate on hover", () => {
    // Given:
    const recent = [
      aPacingRecentDayV1({ date: "2026-09-28", units: 1200, tgtUnitsReforecast: 1000, rate: 12.5, tgtRate: 10 }),
      aPacingRecentDayV1({ date: "2026-09-27" }),
    ];
    const { container } = render(<HeatmapStrip recent={recent} rateType="CPM" />);

    // When: hovering the newest (last) cell's hover target
    const hoverTargets = container.querySelectorAll("g rect:nth-child(3)");
    fireEvent.mouseEnter(hoverTargets[hoverTargets.length - 1]);

    // Then:
    expect(screen.getByRole("tooltip")).toHaveTextContent("2026-09-28");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Impr: 1,200 / 1,000");
    expect(screen.getByRole("tooltip")).toHaveTextContent("CPM: $12.50 / $10.00");
  });
});
