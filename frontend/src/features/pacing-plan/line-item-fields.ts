/**
 * Pure per-line-item plan editing helpers for the Pacing Settings plan editor (§9 of the migration
 * plan, US-125/126/127) - seeding editable form state from what Pacing already stored, and building
 * the save request back from it. No arithmetic on a delivery/pacing figure anywhere in this file:
 * every value here is either read verbatim off `PacingLineItemPlanV1` or typed in by the user.
 */
import { parseEditableNumber } from "../pacing-create/format";
import type { PacingContainer } from "./containers";
import type { PacingDraftLineItemV1, PacingLineItemPlanUpdateV1, PacingLineItemPlanV1 } from "./types";

export interface EditableLineItem {
  lineItemId: string;
  channel: string | null;
  rateType: string;
  targetImpressions: string;
  nativeBudget: string;
  marginTargetPct: string;
  targetCtr: string;
  targetVcr: string;
  flightStart: string;
  flightEnd: string;
  containers: PacingContainer[];
  /** True for a line item added in this editing session (US-126) - not yet on the pacing, so its
   *  identity fields have nothing stored to fall back to and must be carried explicitly on save. */
  isNew: boolean;
  campaignId: string | null;
  campaignName: string | null;
  orderNumber: string | null;
  description: string | null;
}

function numToStr(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

/**
 * Seeds one editable row from Pacing's own stored plan. `nativeBudget` falls back to `clientBudget`
 * for a USD line item (where Pacing stores no separate native figure - the two are numerically
 * identical, see `PacingLineItemPlanV1.nativeBudget`'s own doc) - a fallback READ, never a currency
 * conversion.
 */
export function seedFromPlan(plan: PacingLineItemPlanV1): EditableLineItem {
  return {
    lineItemId: plan.lineItemId,
    channel: plan.channel ?? null,
    rateType: plan.rateType || "CPM",
    targetImpressions: numToStr(plan.plannedImpressions),
    nativeBudget: numToStr(plan.nativeBudget ?? plan.clientBudget),
    marginTargetPct: numToStr(plan.marginTargetPct),
    targetCtr: numToStr(plan.ctrTargetPct),
    targetVcr: numToStr(plan.vcrTargetPct),
    flightStart: plan.flightStart ?? "",
    flightEnd: plan.flightEnd ?? "",
    containers: (plan.containers ?? []) as unknown as PacingContainer[],
    isNew: false,
    campaignId: null,
    campaignName: null,
    orderNumber: null,
    description: null,
  };
}

/** The margin a newly added line item starts on when NetSuite reports none, ported verbatim from the
 *  retired SPA's own add-LI seed (add-li-map.js:14, `mTgt: mrg.value != null ? Number(mrg.value) : 25`).
 *  Leaving it blank is NOT the same thing: a line item saved with no margin paces at 0%, which
 *  overstates what the campaign actually earns. Note the SPA did NOT default CTR/VCR here (they stay
 *  null) even though its CREATE screen did - the two seeds genuinely differ, so this one matches
 *  add-li-map.js, not the create form. */
const ADDED_LI_MARGIN_FALLBACK_PCT = "25";

/** Seeds a newly added line item (US-126) from an addable/by-id candidate - carries its identity
 *  fields forward since there is nothing stored yet to preserve them from. */
export function seedFromCandidate(candidate: PacingDraftLineItemV1): EditableLineItem {
  return {
    lineItemId: candidate.lineItemId,
    channel: candidate.channel ?? "Unknown",
    rateType: candidate.rateType || "CPM",
    targetImpressions: numToStr(candidate.targetImpressions ?? candidate.plannedUnits),
    nativeBudget: numToStr(candidate.nativeBudget ?? candidate.budgetTotal),
    marginTargetPct: numToStr(candidate.marginPercent) || ADDED_LI_MARGIN_FALLBACK_PCT,
    targetCtr: numToStr(candidate.targetCtr),
    targetVcr: numToStr(candidate.targetVcr),
    flightStart: candidate.flightStart ?? "",
    flightEnd: candidate.flightEnd ?? "",
    containers: [],
    isNew: true,
    campaignId: candidate.campaignId ?? null,
    campaignName: candidate.campaignName ?? null,
    orderNumber: candidate.orderNumber ?? null,
    description: candidate.description ?? null,
  };
}

/**
 * Builds the wire request for one line item. For an existing line item, identity fields
 * (channel/description/campaignId/campaignName) are left out entirely - Pacing preserves its own
 * stored value for an id it already has, and the Hub never edits those fields from this screen,
 * so there is nothing honest to send. For a newly added line item they ride along, since Pacing has
 * nothing stored yet to fall back to.
 */
export function toPlanUpdateLineItem(li: EditableLineItem): PacingLineItemPlanUpdateV1 {
  const base: PacingLineItemPlanUpdateV1 = {
    lineItemId: li.lineItemId,
    rateType: li.rateType,
    targetImpressions: parseEditableNumber(li.targetImpressions) ?? 0,
    nativeBudget: parseEditableNumber(li.nativeBudget) ?? 0,
    marginTargetPct: parseEditableNumber(li.marginTargetPct),
    targetCtr: parseEditableNumber(li.targetCtr),
    targetVcr: parseEditableNumber(li.targetVcr),
    flightStart: li.flightStart || undefined,
    flightEnd: li.flightEnd || undefined,
    containers: li.containers as unknown as Record<string, unknown>[],
  };
  if (!li.isNew) return base;
  return {
    ...base,
    channel: li.channel ?? "Unknown",
    description: li.description ?? undefined,
    campaignId: li.campaignId ?? undefined,
    campaignName: li.campaignName ?? undefined,
    orderNumber: li.orderNumber ?? undefined,
  };
}
