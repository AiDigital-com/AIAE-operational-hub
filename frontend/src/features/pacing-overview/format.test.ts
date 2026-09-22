import { describe, expect, it } from "vitest";
import { aPacingNsDiffSummaryV1 } from "@/test/factories";
import { netSuiteLeadMismatch, nsDiffBreakdownLines, totalNsDiffCount } from "./format";

/**
 * §11 (US-132). The whole point of this helper is what it does NOT do: it never tries to decide
 * whether two spellings mean the same person. There is no key shared between Pacing and NetSuite —
 * the match is a convention people maintain by typing the same name into both — so anything clever
 * here would hide the disagreement the feature exists to show.
 */
describe("netSuiteLeadMismatch", () => {
  it("says nothing when the two agree", () => {
    expect(netSuiteLeadMismatch("Daria Feofanova", [{ mpoTeamLead: "Daria Feofanova" }])).toBeNull();
  });

  it("names the NetSuite lead when they differ", () => {
    expect(netSuiteLeadMismatch("Azat Nabiev", [{ mpoTeamLead: "Daria Feofanova" }])).toBe("Daria Feofanova");
  });

  it("says nothing when NetSuite named nobody", () => {
    // Absent is not a disagreement: a pacing that has not revalidated since the field started
    // being stored carries null, and flagging it would light up the whole list on deploy day.
    expect(netSuiteLeadMismatch("Azat Nabiev", [{ mpoTeamLead: null }])).toBeNull();
    expect(netSuiteLeadMismatch("Azat Nabiev", [{}])).toBeNull();
    expect(netSuiteLeadMismatch("Azat Nabiev", [])).toBeNull();
    expect(netSuiteLeadMismatch("Azat Nabiev", null)).toBeNull();
  });

  it("flags a pacing with no owner at all, rather than treating it as agreement", () => {
    expect(netSuiteLeadMismatch(null, [{ mpoTeamLead: "Daria Feofanova" }])).toBe("Daria Feofanova");
  });

  it("does NOT fold case or strip diacritics — that would hide a real difference", () => {
    // `Mimic` is not how `Mimić` is written in NetSuite. Normalising here would report agreement
    // between two spellings that a person still has to reconcile somewhere.
    expect(netSuiteLeadMismatch("Nikola Mimic", [{ mpoTeamLead: "Nikola Mimić" }])).toBe("Nikola Mimić");
    expect(netSuiteLeadMismatch("daria feofanova", [{ mpoTeamLead: "Daria Feofanova" }])).toBe("Daria Feofanova");
  });

  it("does not trim — a trailing space in one system is a difference worth seeing", () => {
    expect(netSuiteLeadMismatch("Daria Feofanova ", [{ mpoTeamLead: "Daria Feofanova" }])).toBe("Daria Feofanova");
  });

  it("reports the FIRST campaign that disagrees on a multi-campaign pacing", () => {
    const lead = netSuiteLeadMismatch("Azat Nabiev", [
      { mpoTeamLead: "Azat Nabiev" },
      { mpoTeamLead: "Daria Feofanova" },
      { mpoTeamLead: "Someone Else" },
    ]);
    expect(lead).toBe("Daria Feofanova");
  });

  it("says nothing when every campaign agrees, however many there are", () => {
    expect(
      netSuiteLeadMismatch("Azat Nabiev", [{ mpoTeamLead: "Azat Nabiev" }, { mpoTeamLead: "Azat Nabiev" }])
    ).toBeNull();
  });
});

// §13 (US-136). All six classes count toward the total - none is filtered out, since a difference
// that looks routine to an engineer might not be routine to the person looking at it.
describe("totalNsDiffCount", () => {
  it("sums every class, not just some", () => {
    const summary = aPacingNsDiffSummaryV1({
      counts: {
        missingInNetsuite: 1,
        missingInPacing: 2,
        fieldDiff: 3,
        planDiff: 4,
        foreignCampaign: 5,
        ownerDiff: 6,
      },
    });
    expect(totalNsDiffCount(summary)).toBe(21);
  });

  it("is 0 for a pacing never checked", () => {
    expect(totalNsDiffCount(null)).toBe(0);
    expect(totalNsDiffCount(undefined)).toBe(0);
  });

  it("is 0 when every class is 0", () => {
    expect(totalNsDiffCount(aPacingNsDiffSummaryV1({ counts: aPacingNsDiffSummaryV1().counts }))).toBe(0);
  });
});

describe("nsDiffBreakdownLines", () => {
  it("lists only classes with a non-zero count, pluralized", () => {
    const summary = aPacingNsDiffSummaryV1({
      counts: {
        missingInNetsuite: 0,
        missingInPacing: 1,
        fieldDiff: 2,
        planDiff: 0,
        foreignCampaign: 0,
        ownerDiff: 1,
      },
    });
    expect(nsDiffBreakdownLines(summary)).toEqual([
      "1 missing in Pacing",
      "2 field differences",
      "1 owner mismatch",
    ]);
  });

  it("is empty for a pacing with nothing to report", () => {
    expect(nsDiffBreakdownLines(null)).toEqual([]);
    expect(
      nsDiffBreakdownLines(
        aPacingNsDiffSummaryV1({
          counts: {
            missingInNetsuite: 0,
            missingInPacing: 0,
            fieldDiff: 0,
            planDiff: 0,
            foreignCampaign: 0,
            ownerDiff: 0,
          },
        })
      )
    ).toEqual([]);
  });
});
