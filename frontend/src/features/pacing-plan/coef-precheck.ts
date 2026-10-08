/**
 * The plan editor's coefficient-cost precheck - a port of the retired SPA's
 * `workspace/src/lib/settings/coef-precheck.js`, and for its reason.
 *
 * Coefficient margin mode makes a line item's Margin % the INPUT to client cost
 * (`spend / (1 - margin)`, resolved per fact row), so Pacing refuses the whole settings save with
 * `bad_coef_config` when one of those margins is out of range, or when two overlapping periods both
 * set one. Without this, the only way to learn that is to press Save and read the rejection.
 *
 * The rule itself is NOT reimplemented here. `PacingCore.validateCoefLi` - the very function
 * dash-gate's `db.mjs` runs on save - is called through the vendored engine, so the warning and the
 * refusal can never disagree. What lives in this file is the two-field rename between the editor's
 * own row shape and the WIRE line item that function reads, nothing more.
 */
import type { PacingContainer } from "./containers";
import { getPacingCore } from "../pacing-dashboard/engine/engine-loader";

/** The slice of an editable line item the check needs: its coefficient flag and its own margin. */
export interface CoefPrecheckInput {
  costCoef: boolean;
  /** The Margin % cell exactly as it is held - a string, blank included. Blank reaches the validator
   *  as "inherit", which is a different statement from 0, so it is passed through untouched. */
  marginTargetPct: string;
  containers: PacingContainer[];
}

/**
 * Does this line item's coefficient configuration block a save?
 *
 * False for every line item not on coefficient cost - `validateCoefLi` returns early on those, so a
 * red-tinted margin on a flat-margin line item carries no warning here, exactly as in the reference.
 */
export function coefConfigBlocksSave(li: CoefPrecheckInput): boolean {
  return (
    getPacingCore().validateCoefLi({
      // Strictly boolean: the validator answers `coef_not_boolean` to anything else.
      cost_coef: li.costCoef === true,
      // Untouched. null / '' mean "inherit this line item's margin" to the validator, and coercing
      // them to 0 would change what the value says.
      margin_percent: li.marginTargetPct,
      containers: li.containers as unknown as Record<string, unknown>[],
    }).length > 0
  );
}

/**
 * The one sentence to show under a line item, or null when it has nothing to say.
 *
 * Both axes in one string rather than two stacked warnings, the way the retired SPA's `warnFor`
 * does it: the container-sum hint on its own used to be the whole of this row's English, and
 * leaving it there while a coefficient problem is ALSO live would name the lesser of the two
 * reasons the save is about to fail.
 *
 * @param overPlan whether the containers' combined target already exceeds the line item's own plan
 *                 (`containers.ts`'s `containerSumExceedsPlan`)
 * @param coefBlocked whether `coefConfigBlocksSave` found a coefficient problem
 */
export function planWarningSentence(overPlan: boolean, coefBlocked: boolean): string | null {
  if (overPlan && coefBlocked) return "Containers exceed the LI plan, and the coefficient margins block saving";
  if (coefBlocked) {
    return "Coefficient margins block saving - overlapping containers both set a margin, or a margin is out of range";
  }
  if (overPlan) {
    return "Containers' combined target exceeds this line item's own target impressions. Pacing may reject this on save.";
  }
  return null;
}
