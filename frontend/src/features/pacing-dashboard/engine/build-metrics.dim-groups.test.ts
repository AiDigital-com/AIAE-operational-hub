/**
 * Value groups (Pacing spec 2026-10-02), the Hub's half of it.
 *
 * A line item can declare that several delivered values of one naming dimension read as one
 * named value, so a dim split on that name is an ordinary split with one shared target. Pacing
 * does NOT rewrite the rows in the files it builds - it ships the dictionary on each line's plan
 * (`dimGroups`, from `dash-gate/lib/merge.mjs`) and every reader rewrites the rows where it
 * FIRST reads them. dash-gate does it for the Overview and the Slack summary; this app does it
 * in `toEngineRaw`, before anything normalizes or sums a row.
 *
 * Two things can silently go wrong, and both are checked here:
 *   - the dictionary never reaching the engine (dropped by the contract, the mapper or
 *     `toEngineRaw`'s field allowlist), so a split on a group's name finds no delivery and reads
 *     a confident zero rather than an error;
 *   - the rewrite leaking onto a line that declares no group - groups are per line item, and the
 *     same raw value on another line must keep its own name.
 */
import { describe, expect, it } from "vitest";
import { toEngineRaw } from "./build-metrics";
import { toHubShape } from "./__fixtures__/to-hub-shape";
import type { PacingDashboardV1 } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** The fixture with line item 100's `sports_fans` declared to read as `Brand`. Line 200 delivers
 *  `auto_intenders` and declares nothing, so it is the control. */
function withGroupOnLine100(): PacingDashboardV1 {
  const data = toHubShape() as Any;
  data.planByLineItem["100"].dimGroups = [
    { dim_key: "audience", name: "Brand", values: ["sports_fans"] },
  ];
  return data as PacingDashboardV1;
}

const audiencesOf = (raw: Any, liId: string): string[] =>
  raw.factsDaily.filter((r: Any) => String(r.line_item_id) === liId).map((r: Any) => r.audience);

describe("toEngineRaw - value groups", () => {
  it("rewrites the declaring line's rows to the group's name", () => {
    const raw = toEngineRaw(withGroupOnLine100()) as Any;

    expect(audiencesOf(raw, "100")).toEqual(["Brand", "Brand", "Brand", "Brand", "Brand"]);
  });

  it("leaves a line that declares no group alone", () => {
    const raw = toEngineRaw(withGroupOnLine100()) as Any;

    expect(new Set(audiencesOf(raw, "200"))).toEqual(new Set(["auto_intenders"]));
  });

  it("carries the dictionary onto the engine's plan map, not just onto the rows", () => {
    // The rows above could be right while the plan lost the key - and the readers that cut by
    // dimension (an additional-data source answering with its own column) go by the plan.
    const raw = toEngineRaw(withGroupOnLine100()) as Any;

    expect(raw.planByLineItem["100"].dimGroups).toEqual([
      { dim_key: "audience", name: "Brand", values: ["sports_fans"] },
    ]);
    expect(raw.planByLineItem["200"].dimGroups).toBeUndefined();
  });

  it("changes nothing for a pacing that declares no groups", () => {
    // The whole feature has to cost a pacing that never used it exactly nothing: with no
    // dictionary anywhere the index is null and the payload comes back as it went in.
    const plain = toEngineRaw(toHubShape()) as Any;

    expect(audiencesOf(plain, "100")).toEqual(
      ["sports_fans", "sports_fans", "sports_fans", "sports_fans", "sports_fans"],
    );
    expect(audiencesOf(plain, "200")).toEqual(
      ["auto_intenders", "auto_intenders", "auto_intenders", "auto_intenders", "auto_intenders"],
    );
  });

  it("matches a member value regardless of case and padding", () => {
    // Membership is folded (trim + lowercase, `PacingCore.dimGroupFold`), because the marts spell
    // one value several ways and a dictionary written by hand will not match them byte for byte.
    const data = toHubShape() as Any;
    data.planByLineItem["100"].dimGroups = [
      { dim_key: "audience", name: "Brand", values: ["  SPORTS_Fans "] },
    ];
    const raw = toEngineRaw(data as PacingDashboardV1) as Any;

    expect(new Set(audiencesOf(raw, "100"))).toEqual(new Set(["Brand"]));
  });
});
