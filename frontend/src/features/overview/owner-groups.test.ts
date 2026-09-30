import { describe, expect, it } from "vitest";
import { aCampaignRefV1, aPacingRowV1 } from "@/test/factories";
import {
  buildOwnerGroups,
  compareOverviewRows,
  matchesAgencyFilter,
  matchesOverviewSearch,
  rowLiCount,
  UNASSIGNED,
} from "./owner-groups";

describe("buildOwnerGroups", () => {
  it("should group rows by owner, sending ownerless rows to Unassigned", () => {
    // Given:
    const rows = [
      aPacingRowV1({ ownerName: "Boris Antipov" }),
      aPacingRowV1({ ownerName: undefined }),
      aPacingRowV1({ ownerName: "Boris Antipov" }),
    ];

    // When:
    const groups = buildOwnerGroups(rows);

    // Then:
    expect(groups.map((g) => g.owner)).toEqual(["Boris Antipov", UNASSIGNED]);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[1].rows).toHaveLength(1);
  });

  it("should order the signed-in user's group first, the rest alphabetically, Unassigned last", () => {
    // Given: alphabetical order alone would put Denis before Zara before the viewer
    const rows = [
      aPacingRowV1({ ownerName: "Zara Osman" }),
      aPacingRowV1({ ownerName: undefined }),
      aPacingRowV1({ ownerName: "Denis Volkov" }),
      aPacingRowV1({ ownerName: "Maya Lind" }),
    ];

    // When: the viewer's name matches case-insensitively
    const groups = buildOwnerGroups(rows, "  maya lind ");

    // Then:
    expect(groups.map((g) => g.owner)).toEqual(["Maya Lind", "Denis Volkov", "Zara Osman", UNASSIGNED]);
  });

  it("should sort rows inside a group by status priority: Live, Paused, Complete, Archive", () => {
    // Given:
    const rows = [
      aPacingRowV1({ ownerName: "A", status: "Archive", name: "arch" }),
      aPacingRowV1({ ownerName: "A", status: "Live", name: "live" }),
      aPacingRowV1({ ownerName: "A", status: "Complete", name: "done" }),
      aPacingRowV1({ ownerName: "A", status: "Paused", name: "hold" }),
    ];

    // When:
    const groups = buildOwnerGroups(rows);

    // Then:
    expect(groups[0].rows.map((r) => r.name)).toEqual(["live", "hold", "done", "arch"]);
  });

  it("should apply a caller-supplied comparator inside each group instead of status priority", () => {
    // Given:
    const rows = [
      aPacingRowV1({ ownerName: "A", budgetTotal: 100, name: "small" }),
      aPacingRowV1({ ownerName: "A", budgetTotal: 900, name: "big" }),
    ];

    // When:
    const groups = buildOwnerGroups(rows, undefined, (a, b) =>
      compareOverviewRows(a, b, { field: "BUDGET", direction: "DESC" })
    );

    // Then:
    expect(groups[0].rows.map((r) => r.name)).toEqual(["big", "small"]);
  });

  it("should aggregate the header strip's figures: LI total plus under/over counts", () => {
    // Given: liCount (health's own figure) wins over lineItemCount; a row with no health falls back
    const rows = [
      aPacingRowV1({ ownerName: "A", liCount: 4, lineItemCount: 9, paceStatus: "under" }),
      aPacingRowV1({ ownerName: "A", liCount: undefined, lineItemCount: 2, paceStatus: "over" }),
      aPacingRowV1({ ownerName: "A", liCount: 1, lineItemCount: 1, paceStatus: "on_pace" }),
    ];

    // When:
    const [group] = buildOwnerGroups(rows);

    // Then:
    expect(group.liTotal).toBe(7);
    expect(group.under).toBe(1);
    expect(group.over).toBe(1);
  });
});

describe("rowLiCount", () => {
  it("should prefer health's own count and fall back to the config count", () => {
    expect(rowLiCount(aPacingRowV1({ liCount: 5, lineItemCount: 9 }))).toBe(5);
    expect(rowLiCount(aPacingRowV1({ liCount: undefined, lineItemCount: 9 }))).toBe(9);
  });
});

describe("compareOverviewRows", () => {
  it("should sort null figures lowest ascending, like the /pacing table", () => {
    // Given:
    const noMargin = aPacingRowV1({ marginActualPct: undefined });
    const lowMargin = aPacingRowV1({ marginActualPct: 5 });

    // Then:
    expect(compareOverviewRows(noMargin, lowMargin, { field: "MARGIN", direction: "ASC" })).toBeLessThan(0);
    expect(compareOverviewRows(noMargin, lowMargin, { field: "MARGIN", direction: "DESC" })).toBeGreaterThan(0);
  });

  it("should order flights by start date", () => {
    const early = aPacingRowV1({ flightStart: "2026-01-01" });
    const late = aPacingRowV1({ flightStart: "2026-06-01" });
    expect(compareOverviewRows(early, late, { field: "FLIGHT", direction: "ASC" })).toBeLessThan(0);
  });
});

describe("matchesOverviewSearch", () => {
  it("should match the pacing's own name, owner, campaigns, agency and client", () => {
    // Given:
    const row = aPacingRowV1({
      name: "Nike SS26 Display",
      ownerName: "Maya Lind",
      agency: "Initiative",
      client: "Nike",
      campaigns: [aCampaignRefV1({ name: "Nike Summer", agencyName: "Initiative Media", clientName: "Nike Inc" })],
    });

    // Then: every field a person would plausibly search by
    expect(matchesOverviewSearch(row, "ss26")).toBe(true);
    expect(matchesOverviewSearch(row, "maya")).toBe(true);
    expect(matchesOverviewSearch(row, "summer")).toBe(true);
    expect(matchesOverviewSearch(row, "initiative")).toBe(true);
    expect(matchesOverviewSearch(row, "nike inc")).toBe(true);
    expect(matchesOverviewSearch(row, "adidas")).toBe(false);
    expect(matchesOverviewSearch(row, "")).toBe(true);
  });
});

describe("matchesAgencyFilter", () => {
  it("should match when ANY of the pacing's campaigns carries a selected agency id", () => {
    // Given: a pacing spanning two agencies - legitimate, and either one admits it
    const row = aPacingRowV1({
      campaigns: [aCampaignRefV1({ agencyId: 10 }), aCampaignRefV1({ agencyId: 20 })],
    });

    // Then:
    expect(matchesAgencyFilter(row, [20])).toBe(true);
    expect(matchesAgencyFilter(row, [30])).toBe(false);
    expect(matchesAgencyFilter(row, [])).toBe(true);
  });

  it("should drop a pacing with no resolvable agency when a filter is active, keep it when none is", () => {
    // Given: campaigns never resolved (null), and campaigns resolved but without Hub agency ids
    const unresolved = aPacingRowV1({ campaigns: undefined });
    const unenriched = aPacingRowV1({ campaigns: [aCampaignRefV1({ agencyId: undefined })] });

    // Then: shown unfiltered, honestly absent once an agency is picked
    expect(matchesAgencyFilter(unresolved, [])).toBe(true);
    expect(matchesAgencyFilter(unresolved, [10])).toBe(false);
    expect(matchesAgencyFilter(unenriched, [10])).toBe(false);
  });
});
