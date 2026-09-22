import { describe, expect, it } from "vitest";
import { netSuiteLeadMismatch } from "./format";

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
