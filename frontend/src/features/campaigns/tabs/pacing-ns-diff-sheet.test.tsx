import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aPacingNsDiffCoveredByV1, aPacingNsDiffMissingInPacingV1, aPacingNsDiffReportV1, aPacingRowV1 } from "@/test/factories";
import { getPacingNsDiff } from "../../pacing-overview/api";
import type { PacingRowV1 } from "../../pacing-overview/types";
import { groupByFlight } from "./pacing-ns-diff-sheet-format";
import { PacingNsDiffSheet } from "./pacing-ns-diff-sheet";

vi.mock("../../pacing-overview/api", () => ({
  getPacingNsDiff: vi.fn(),
}));

function renderSheet(row: PacingRowV1 | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PacingNsDiffSheet row={row} onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Renders under a real `/campaigns/:campaignId/pacing` route so a click on the "covered by another
 *  pacing" link can be followed, and both the resolved campaign id and the navigation `state` it
 *  carried can be asserted — `href` alone cannot show `state`, since React Router does not put it in
 *  the DOM. Same stub-route approach `pacing-tab.test.tsx` uses for its own "also covers" links. */
function renderSheetWithRouting(row: PacingRowV1) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/sheet"]}>
        <Routes>
          <Route path="/sheet" element={<PacingNsDiffSheet row={row} onClose={vi.fn()} />} />
          <Route path="/campaigns/:campaignId/pacing" element={<CapturedRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function CapturedRoute() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const location = useLocation();
  return (
    <div>
      <div data-testid="captured-campaign">{campaignId}</div>
      <div data-testid="captured-state">{JSON.stringify(location.state)}</div>
    </div>
  );
}

describe("PacingNsDiffSheet", () => {
  beforeEach(() => {
    vi.mocked(getPacingNsDiff).mockReset();
  });

  it("fetches nothing while closed", () => {
    renderSheet(null);
    expect(getPacingNsDiff).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a loading state while the live check is in flight", () => {
    vi.mocked(getPacingNsDiff).mockReturnValue(new Promise(() => {})); // never resolves
    renderSheet(aPacingRowV1({ id: "p1", name: "Ourisman Ford Q1" }));

    expect(screen.getByRole("status", { name: /Checking against NetSuite/i })).toBeInTheDocument();
  });

  it("shows the error when the live check fails", async () => {
    vi.mocked(getPacingNsDiff).mockRejectedValue(new Error("Pacing is unreachable"));
    renderSheet(aPacingRowV1({ id: "p1", name: "Ourisman Ford Q1" }));

    expect(await screen.findByText("Pacing is unreachable")).toBeInTheDocument();
  });

  it("shows a single 'no differences' message rather than six empty headings", async () => {
    vi.mocked(getPacingNsDiff).mockResolvedValue(aPacingNsDiffReportV1({ inSync: true }));
    renderSheet(aPacingRowV1({ id: "p1", name: "Ourisman Ford Q1" }));

    expect(await screen.findByText(/No differences — this pacing matches NetSuite/)).toBeInTheDocument();
    expect(screen.queryByText("Field differences")).not.toBeInTheDocument();
    expect(screen.queryByText("Owner differs from NetSuite")).not.toBeInTheDocument();
  });

  it("renders a missing-in-NetSuite entry with humanized numbers", async () => {
    vi.mocked(getPacingNsDiff).mockResolvedValue(
      aPacingNsDiffReportV1({
        inSync: false,
        missingInNetsuite: [{ lineItemId: "599888", channel: "Native Display", targetSpend: 12345.6, targetImpressions: 500000 }],
      })
    );
    renderSheet(aPacingRowV1({ id: "p1", name: "Ourisman Ford Q1" }));

    expect(await screen.findByText("No longer in NetSuite")).toBeInTheDocument();
    expect(screen.getByText("599888")).toBeInTheDocument();
    expect(screen.getByText("Native Display")).toBeInTheDocument();
    // Humanized, never a raw float - fmtMoney rounds, fmtInt adds thousands separators.
    expect(screen.getByText("$12,346")).toBeInTheDocument();
    expect(screen.getByText("500,000")).toBeInTheDocument();
  });

  it("renders a missing-in-Pacing entry with the full NetSuite-side shape, once its flight group is expanded", async () => {
    vi.mocked(getPacingNsDiff).mockResolvedValue(
      aPacingNsDiffReportV1({
        inSync: false,
        missingInPacing: [
          {
            lineItemId: "700111",
            campaignName: "Southwest",
            orderNumber: "IO-4471",
            channel: "Display",
            rateType: "CPM",
            nativeBudget: 8000,
            plannedUnits: 200000,
            flightStart: "2026-10-01",
            flightEnd: "2026-10-31",
            description: "October flight",
          },
        ],
      })
    );
    renderSheet(aPacingRowV1({ id: "p1", name: "Ourisman Ford Q1" }));

    expect(await screen.findByText("Missing from this pacing")).toBeInTheDocument();
    // Grouped by flight and collapsed by default - nothing from the entry itself is visible yet.
    expect(screen.queryByText("IO-4471")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Oct 1, 2026 – Oct 31, 2026 · 1" }));

    expect(screen.getByText("IO-4471")).toBeInTheDocument();
    expect(screen.getByText("CPM")).toBeInTheDocument();
    expect(screen.getByText("October flight")).toBeInTheDocument();
  });

  it("shows both the USD and native-currency pair for a target_spend field difference", async () => {
    vi.mocked(getPacingNsDiff).mockResolvedValue(
      aPacingNsDiffReportV1({
        inSync: false,
        planDiff: [
          {
            lineItemId: "111",
            fields: [
              { field: "target_spend", pacing: 5000, netsuite: 5500, pacingNative: 4600, netsuiteNative: 5060 },
            ],
          },
        ],
      })
    );
    renderSheet(aPacingRowV1({ id: "p1", name: "Ourisman Ford Q1" }));

    expect(await screen.findByText("Plan differences")).toBeInTheDocument();
    expect(screen.getByText("target_spend")).toBeInTheDocument();
    expect(screen.getByText(/\$5,000/)).toBeInTheDocument();
    expect(screen.getByText(/\$5,500/)).toBeInTheDocument();
    // Native figures render without a $ - they are not necessarily USD.
    expect(screen.getByText(/4,600\.00/)).toBeInTheDocument();
    expect(screen.getByText(/5,060\.00/)).toBeInTheDocument();
  });

  it("labels an overridden flight date as moved on purpose, not as an error", async () => {
    vi.mocked(getPacingNsDiff).mockResolvedValue(
      aPacingNsDiffReportV1({
        inSync: false,
        fieldDiff: [
          {
            lineItemId: "111",
            fields: [{ field: "flight_end", pacing: "2026-10-31", netsuite: "2026-10-15", source: "override" }],
          },
        ],
      })
    );
    renderSheet(aPacingRowV1({ id: "p1", name: "Ourisman Ford Q1" }));

    expect(await screen.findByText("Field differences")).toBeInTheDocument();
    expect(screen.getByText("Moved on purpose")).toBeInTheDocument();
    // Dates go through the date formatter, not the number one.
    expect(screen.getByText(/Oct 31, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Oct 15, 2026/)).toBeInTheDocument();
  });

  it("renders a foreign-campaign entry naming both sides", async () => {
    vi.mocked(getPacingNsDiff).mockResolvedValue(
      aPacingNsDiffReportV1({
        inSync: false,
        foreignCampaign: [
          {
            lineItemId: "222",
            pacingCampaignId: "CAMP-A",
            netsuiteCampaignId: "CAMP-B",
            netsuiteCampaignName: "Toyota 2026",
            inPacingCampaignSet: false,
          },
        ],
      })
    );
    renderSheet(aPacingRowV1({ id: "p1", name: "Ourisman Ford Q1" }));

    expect(await screen.findByText("Moved to another campaign")).toBeInTheDocument();
    expect(screen.getByText(/Toyota 2026/)).toBeInTheDocument();
    expect(screen.getByText(/not one of this pacing's own/)).toBeInTheDocument();
  });

  it("renders an owner-diff entry with both names, neither presumed correct", async () => {
    vi.mocked(getPacingNsDiff).mockResolvedValue(
      aPacingNsDiffReportV1({
        inSync: false,
        ownerDiff: [{ campaignId: "c1", campaignName: "Southwest", ownerName: "Azat Nabiev", mpoTeamLead: "Daria Feofanova" }],
      })
    );
    renderSheet(aPacingRowV1({ id: "p1", name: "Ourisman Ford Q1" }));

    expect(await screen.findByText("Owner differs from NetSuite")).toBeInTheDocument();
    expect(screen.getByText(/Pacing: Azat Nabiev · NetSuite: Daria Feofanova/)).toBeInTheDocument();
  });

  it("notes line items that could not be checked, with a plain explanation", async () => {
    vi.mocked(getPacingNsDiff).mockResolvedValue(
      aPacingNsDiffReportV1({ inSync: false, missingInPacing: [{ lineItemId: "999" }], notCheckedLineItems: ["manual-1"] })
    );
    renderSheet(aPacingRowV1({ id: "p1", name: "Ourisman Ford Q1" }));

    expect(await screen.findByText(/Not checked: manual-1/)).toBeInTheDocument();
  });

  it("keeps the section's total count at uncovered + covered, never just one part", async () => {
    const coveredBy = aPacingNsDiffCoveredByV1({ pacingId: "p2", pacingName: "Other Pacing" });
    vi.mocked(getPacingNsDiff).mockResolvedValue(
      aPacingNsDiffReportV1({
        inSync: false,
        missingInPacing: [
          aPacingNsDiffMissingInPacingV1({ lineItemId: "u1", coveredBy: undefined }),
          aPacingNsDiffMissingInPacingV1({ lineItemId: "u2", coveredBy: undefined }),
          aPacingNsDiffMissingInPacingV1({ lineItemId: "c1", coveredBy }),
        ],
      })
    );
    renderSheet(aPacingRowV1({ id: "p1", name: "Ourisman Ford Q1" }));

    const heading = (await screen.findByText("Missing from this pacing")).closest("h4");
    expect(heading).not.toBeNull();
    expect(within(heading as HTMLElement).getByText("3")).toBeInTheDocument();
  });

  it("collapses covered-by-another-pacing entries by default, and expands them on click", async () => {
    const coveredBy = aPacingNsDiffCoveredByV1({ pacingId: "p2", pacingName: "Other Pacing", status: "Live" });
    vi.mocked(getPacingNsDiff).mockResolvedValue(
      aPacingNsDiffReportV1({
        inSync: false,
        missingInPacing: [
          aPacingNsDiffMissingInPacingV1({ lineItemId: "u1", flightStart: "2026-04-01", flightEnd: "2026-04-05", coveredBy: undefined }),
          aPacingNsDiffMissingInPacingV1({ lineItemId: "c1", flightStart: "2026-04-01", flightEnd: "2026-04-05", coveredBy }),
        ],
      })
    );
    renderSheet(aPacingRowV1({ id: "p1", name: "Ourisman Ford Q1" }));

    const coveredToggle = await screen.findByRole("button", { name: "Covered by another pacing (1)" });
    expect(screen.queryByText("Other Pacing")).not.toBeInTheDocument();

    await userEvent.click(coveredToggle);
    expect(screen.getByText("Other Pacing")).toBeInTheDocument();
  });

  it("links the covering pacing to /campaigns/{campaignId}/pacing with the right openPacingId", async () => {
    const coveredBy = aPacingNsDiffCoveredByV1({ pacingId: "p2", pacingName: "Other Pacing", status: "Live" });
    vi.mocked(getPacingNsDiff).mockResolvedValue(
      aPacingNsDiffReportV1({
        inSync: false,
        missingInPacing: [aPacingNsDiffMissingInPacingV1({ lineItemId: "c1", campaignId: "40539", coveredBy })],
      })
    );
    renderSheetWithRouting(aPacingRowV1({ id: "p1", name: "Ourisman Ford Q1" }));

    await userEvent.click(await screen.findByRole("button", { name: "Covered by another pacing (1)" }));
    await userEvent.click(screen.getByRole("link", { name: "Other Pacing" }));

    expect(await screen.findByTestId("captured-campaign")).toHaveTextContent("40539");
    expect(screen.getByTestId("captured-state")).toHaveTextContent('"openPacingId":"p2"');
  });
});

describe("groupByFlight", () => {
  it("returns no groups for an empty list", () => {
    expect(groupByFlight([])).toEqual([]);
  });

  it("puts every entry sharing the same flight dates into one group", () => {
    const entries = [
      aPacingNsDiffMissingInPacingV1({ lineItemId: "1", flightStart: "2026-04-01", flightEnd: "2026-04-05" }),
      aPacingNsDiffMissingInPacingV1({ lineItemId: "2", flightStart: "2026-04-01", flightEnd: "2026-04-05" }),
    ];

    const groups = groupByFlight(entries);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((entry) => entry.lineItemId)).toEqual(["1", "2"]);
  });

  it("splits entries with different flight dates into separate groups, sorted by flightStart ascending", () => {
    const entries = [
      aPacingNsDiffMissingInPacingV1({ lineItemId: "1", flightStart: "2026-05-01", flightEnd: "2026-05-31" }),
      aPacingNsDiffMissingInPacingV1({ lineItemId: "2", flightStart: "2026-04-01", flightEnd: "2026-04-05" }),
      aPacingNsDiffMissingInPacingV1({ lineItemId: "3", flightStart: "2026-04-01", flightEnd: "2026-04-06" }),
    ];

    const groups = groupByFlight(entries);

    expect(groups.map((group) => [group.flightStart, group.flightEnd])).toEqual([
      ["2026-04-01", "2026-04-05"],
      ["2026-04-01", "2026-04-06"],
      ["2026-05-01", "2026-05-31"],
    ]);
  });

  it("groups entries with no flight dates together, sorted after every dated group", () => {
    const entries = [
      aPacingNsDiffMissingInPacingV1({ lineItemId: "1", flightStart: undefined, flightEnd: undefined }),
      aPacingNsDiffMissingInPacingV1({ lineItemId: "2", flightStart: "2026-04-01", flightEnd: "2026-04-05" }),
      aPacingNsDiffMissingInPacingV1({ lineItemId: "3", flightStart: undefined, flightEnd: undefined }),
    ];

    const groups = groupByFlight(entries);

    expect(groups).toHaveLength(2);
    expect(groups[0].flightStart).toBe("2026-04-01");
    expect(groups[1].flightStart).toBeNull();
    expect(groups[1].entries.map((entry) => entry.lineItemId)).toEqual(["1", "3"]);
  });
});
