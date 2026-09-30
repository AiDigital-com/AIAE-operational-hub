import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { aPacingKpiTargetV1, aPacingRecentDayV1 } from "@/test/factories";
import { kpiBandStatus } from "./kpi-band";
import { KpiSpark, sparkBand } from "./kpi-spark";

describe("kpiBandStatus", () => {
  it("should band a ratio exactly as Pacing's shared kpi-band does", () => {
    // Then: g at/above target within the high bound; w between low and 1; b outside; n unfinite
    expect(kpiBandStatus(1, 0.7, 2)).toBe("g");
    expect(kpiBandStatus(1.9, 0.7, 2)).toBe("g");
    expect(kpiBandStatus(2.1, 0.7, 2)).toBe("b");
    expect(kpiBandStatus(0.8, 0.7, 2)).toBe("w");
    expect(kpiBandStatus(0.6, 0.7, 2)).toBe("b");
    expect(kpiBandStatus(Number.NaN, 0.7, 2)).toBe("n");
    expect(kpiBandStatus(null, 0.7, 2)).toBe("n");
  });

  it("should treat a null bound as that side disabled", () => {
    // Then: no lower bound -> a below-target ratio is not flagged; no upper -> high is fine
    expect(kpiBandStatus(0.2, null, 2)).toBe("g");
    expect(kpiBandStatus(5, 0.7, null)).toBe("g");
  });
});

describe("sparkBand", () => {
  it("should be neutral without a positive target", () => {
    expect(sparkBand(1, null)).toBe("n");
    expect(sparkBand(1, 0)).toBe("n");
  });

  it("should default absent bounds to 0.7 / 1.3, keeping an explicit null disabled", () => {
    // Then: 0.5/1.0 = 0.5 ratio -> below the 0.7 default
    expect(sparkBand(0.5, 1)).toBe("b");
    // 1.4 ratio -> above the 1.3 default
    expect(sparkBand(1.4, 1)).toBe("b");
    // explicit null high = that side disabled (VCR has no upper band)
    expect(sparkBand(1.4, 1, undefined, null)).toBe("g");
  });
});

describe("KpiSpark", () => {
  it("should render a dash with no KPIs or fewer than 2 days", () => {
    const { rerender } = render(<KpiSpark recent={[aPacingRecentDayV1(), aPacingRecentDayV1()]} kpis={[]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    rerender(<KpiSpark recent={[aPacingRecentDayV1()]} kpis={[aPacingKpiTargetV1()]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("should print the last day's value beside a single KPI's sparkline", () => {
    // Given: newest first on the wire - the LAST day is the first entry
    const recent = [
      aPacingRecentDayV1({ date: "2026-09-28", ctr: 0.857 }),
      aPacingRecentDayV1({ date: "2026-09-27", ctr: 0.1 }),
    ];

    // When:
    render(<KpiSpark recent={recent} kpis={[aPacingKpiTargetV1({ type: "CTR", tgt: 0.5 })]} />);

    // Then: CTR prints 2 decimals, formatted for humans, never the raw float
    expect(screen.getByText("CTR")).toBeInTheDocument();
    expect(screen.getByText("0.86%")).toBeInTheDocument();
  });

  it("should render one sparkline per KPI and hide the printed value when there are two", () => {
    // Given:
    const recent = [aPacingRecentDayV1({ ctr: 0.8, vcr: 60 }), aPacingRecentDayV1({ ctr: 0.7, vcr: 55 })];

    // When:
    render(
      <KpiSpark
        recent={recent}
        kpis={[aPacingKpiTargetV1({ type: "CTR", tgt: 0.5 }), aPacingKpiTargetV1({ type: "VCR", tgt: 50, high: null })]}
      />
    );

    // Then: both labels, no printed percentage (the row is only so wide)
    expect(screen.getByText("CTR")).toBeInTheDocument();
    expect(screen.getByText("VCR")).toBeInTheDocument();
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });
});
