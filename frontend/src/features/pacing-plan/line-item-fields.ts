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
  /** Coefficient margin mode: this line item's client cost is `spend / (1 - margin)`, resolved per
   *  fact row (dim child -> date child -> container -> line item), instead of BigQuery's
   *  `dynamic_cost`. Seeded from the STORED flag whatever the pacing's switch says, so a line item
   *  already on coefficient cost keeps its flag through a save made while the switch is off. */
  costCoef: boolean;
  /** Net cost mode (Pacing spec 2026-09-07): the Net % cell as the user reads and types it - a
   *  PERCENT string ("85" for k = 0.85). Blank ≡ 100% ≡ invoiced at gross; the wire carries the
   *  ratio (see `toPlanUpdateLineItem`). Seeded from the STORED ratio, not the operative one, so a
   *  ratio stored while the pacing switch was off still shows and survives a save. */
  netPct: string;
  /** The ratio the wire actually carries - k = net/gross, or null for "invoiced at gross". This is
   *  the source of truth, NOT `netPct`: the cell displays the ratio rounded to 2 decimals, so
   *  re-parsing that string on save would silently round a stored full-precision ratio (NetSuite
   *  seeds net/gross at full precision on every revalidate) on ANY plan save - a budget edit alone
   *  would rewrite 0.800089 as 0.8001. Only a real keystroke in the cell moves this. */
  netRatio: number | null;
  /** Whether the ratio is locked against NetSuite refreshes. A manual Net % edit locks - including
   *  typing 100 or clearing the cell, which say "this line item is invoiced at gross" and must
   *  survive a revalidate; Reset-to-NS unlocks. */
  netLocked: boolean;
  /** NetSuite's own k = net/gross (the Reset-to-NS baseline); null when NetSuite reports none. */
  nsNetRatio: number | null;
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

/** Is this a real net ratio - i.e. a NET line item, not the identity? */
function realRatio(k: number | null | undefined): k is number {
  return typeof k === "number" && Number.isFinite(k) && k > 0 && k < 1;
}

/** Ratio -> the Net % cell. Only a real (0,1) ratio shows; 1 / null / junk read as blank. Two
 *  decimals, trailing zeros dropped - the retired SPA's own display rule (`ratioToPct`). */
export function netRatioToPct(k: number | null | undefined): string {
  return realRatio(k) ? String(parseFloat((k * 100).toFixed(2))) : "";
}

/** The Net % cell -> ratio. Null for anything that is not a real net percentage (blank, 100,
 *  junk) - which the wire expresses as 1, "invoiced at gross" (`toPlanUpdateLineItem`). */
export function netPctToRatio(value: string): number | null {
  const n = parseFloat(String(value ?? "").trim().replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 && n < 100 ? n / 100 : null;
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
    costCoef: plan.costCoef === true,
    netPct: netRatioToPct(plan.storedNetRatio),
    netRatio: realRatio(plan.storedNetRatio) ? plan.storedNetRatio : null,
    netLocked: plan.netRatioLocked === true,
    nsNetRatio: realRatio(plan.nsNetRatio) ? plan.nsNetRatio : null,
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
    // A newly added line item is NOT on coefficient cost: nothing about the candidate says it should
    // be, and the flag is one tick away on the card that just appeared.
    costCoef: false,
    // A newly added line item starts on NetSuite's own ratio, unlocked - the create form's seed
    // rule, verbatim: the seeded value IS the NetSuite reading, so revalidate may keep it fresh.
    netPct: netRatioToPct(candidate.nsNetRatio),
    netRatio: realRatio(candidate.nsNetRatio) ? (candidate.nsNetRatio as number) : null,
    netLocked: false,
    nsNetRatio: realRatio(candidate.nsNetRatio) ? (candidate.nsNetRatio as number) : null,
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
export function toPlanUpdateLineItem(li: EditableLineItem, netFeatureOn: boolean): PacingLineItemPlanUpdateV1 {
  const base: PacingLineItemPlanUpdateV1 = {
    lineItemId: li.lineItemId,
    // Coefficient margin mode rides UNCONDITIONALLY, unlike the net keys below - the retired SPA's
    // rule, verbatim (`SettingsDrawer.jsx`: `cost_coef: p.coef === true`, outside every gate).
    //
    // Gating it on the pacing switch, the way net is gated, looks symmetrical and is a trap. The
    // controls are visible whenever a line item already CARRIES the flag, switch or no switch
    // (see `coefFeatureOn` in `pacing-plan-sheet.tsx`), so a user can untick the last one - and a
    // gate reading "is anything still ticked" would go false on that very tick and drop the edit
    // on the floor. Sending it always costs nothing instead: `costCoef` is seeded from the STORED
    // flag, so for a line item nobody touched this is the stored value going back unchanged, and
    // `cost_coef` is not a NetSuite field, so no revalidate can be clobbered by the round-trip.
    costCoef: li.costCoef,
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
  // Net cost mode: while the pacing switch is OFF nothing is sent - stored ratios stay inert and a
  // save from a pacing that never used the feature is byte-identical to what it always sent. With
  // the switch on BOTH keys always ride, because Pacing preserves an omitted key from storage: a
  // blank/100 cell sends netRatio 1 (the explicit clear - Pacing's canon never persists 1), and an
  // unlock must be an explicit false or the stored true would silently come back.
  // The ratio comes off `netRatio`, never off the displayed percent: a line item nobody touched
  // must send back the EXACT stored ratio, not the 2-decimal rounding the cell shows.
  if (netFeatureOn) {
    base.netRatio = li.netRatio ?? 1;
    base.netRatioLocked = li.netLocked;
  }
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
