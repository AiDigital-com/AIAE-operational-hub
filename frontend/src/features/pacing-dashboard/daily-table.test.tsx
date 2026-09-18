import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DailyTable } from "./daily-table";
import type { DailyMetricRow, PacingMetricsBag } from "./types-metrics";

/**
 * Two low-volume days and one big one, chosen so the two ways of totalling a rate
 * disagree loudly.
 *
 *   day 1      100 impressions,  $10   → CPM $100.00
 *   day 2      100 impressions,  $10   → CPM $100.00
 *   day 3  100,000 impressions,  $100  → CPM   $1.00
 *
 * Averaging the three daily CPMs gives $67.00. Total spend over total impressions
 * gives $1.20. US-120 requires the second, and this fixture is what tells them
 * apart — with three similar days, both methods would agree and the test would
 * pass while proving nothing.
 */
function row(date: string, im: number, sp: number): DailyMetricRow {
  return {
    date,
    liId: "1",
    rawId: "LI 1",
    channel: "CTV",
    vcrEligible: true,
    im,
    cl: 0,
    co: 0,
    sp,
    // Client-side cost, deliberately NOT equal to DSP spend: the gap between them
    // is the margin, and a fixture where they match cannot tell the two columns
    // apart.
    dc: sp * 4,
    ctr: 0,
    vcr: 0,
    cpm: im > 0 ? (sp / im) * 1000 : 0,
  };
}

const DAILY = [row("2026-03-01", 100, 10), row("2026-03-02", 100, 10), row("2026-03-03", 100000, 100)];

function bag(overrides: Partial<PacingMetricsBag> = {}): PacingMetricsBag {
  return {
    asOf: "2026-03-03",
    // What Pacing computed: 100,200 impressions for $120, so $1.198… per mille.
    campaign: { im: 100200, cl: 0, co: 0, sp: 120, dc: 480, cpm: 1.1976, ctr: 0, vcr: 0 },
    scalars: {},
    series: [],
    daily: DAILY,
    sources: {},
    readings: {},
    bound: {},
    ...overrides,
  };
}

function totalsRow(): HTMLElement {
  // The pinned first body row is the totals row.
  const rows = screen.getAllByRole("row");
  return rows.find((r) => within(r).queryByText("Total")) as HTMLElement;
}

describe("DailyTable", () => {
  it("should total a rate as sum over sum, not as the average of the daily rates (US-120)", () => {
    // Given: three days whose average CPM ($67.00) is nothing like their true one.
    render(<DailyTable metrics={bag()} />);

    // Then: the canonical figure, to the cent.
    const totals = totalsRow();
    expect(within(totals).getByText("$1.20")).toBeInTheDocument();
    expect(within(totals).queryByText("$67.00")).not.toBeInTheDocument();
  });

  it("should total the flow columns to the same figures Pacing reports", () => {
    // Given: the table must not disagree with the header above it.
    render(<DailyTable metrics={bag()} />);

    // Then:
    const totals = totalsRow();
    expect(within(totals).getByText("100,200")).toBeInTheDocument();
    expect(within(totals).getByText("$120.00")).toBeInTheDocument();
    expect(within(totals).getByText("$480.00")).toBeInTheDocument();
  });

  it("should show a dash rather than 0% for a line item with no completion goal", () => {
    // Given: a banner has no completion rate; dividing its completes by its
    // impressions would render one that looks like a failing 0%.
    const ineligible = { ...row("2026-03-01", 100, 10), vcrEligible: false };
    render(<DailyTable metrics={bag({ daily: [ineligible] })} />);

    // Then:
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("should narrow the rows on a column filter and say how many are left", async () => {
    // Given:
    render(<DailyTable metrics={bag()} />);
    expect(screen.getByText("3 rows")).toBeInTheDocument();

    // When:
    await userEvent.type(screen.getByLabelText("Date"), "2026-03-03");

    // Then:
    expect(screen.getByText("1 of 3 rows")).toBeInTheDocument();
    expect(screen.queryByText("2026-03-01")).not.toBeInTheDocument();
  });

  it("should say so plainly when the pacing has no delivery yet", () => {
    // Given: an empty table with a totals row of zeroes reads as "delivered
    // nothing", which is a different claim from "nothing has been built yet".
    render(<DailyTable metrics={bag({ daily: [] })} />);

    // Then:
    expect(screen.getByText(/no delivery has been recorded/i)).toBeInTheDocument();
  });
});
