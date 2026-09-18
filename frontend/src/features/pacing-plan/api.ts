import { ApiError } from "../../shared/api/api-error";
import { apiClient } from "../../shared/api/client";
import { formatError } from "../../shared/format/error";
import type {
  PacingAddableLineItemsV1,
  PacingDraftV1,
  PacingLineItemPlanUpdateV1,
  PacingLifecycleStatus,
  PacingPlanUpdateResultV1,
} from "./types";

/**
 * Saves a pacing's plan (§9 of the migration plan, US-125/126/127): editing a line item's plan,
 * adding one and removing one are all this one request - `lineItems` is the whole set the pacing
 * should have after the save (see the OpenAPI schema for what "add"/"remove" mean on this array).
 * A rejection (e.g. an out-of-range coefficient-cost margin) throws with Pacing's own message, naming
 * the line item and field - never pre-judged here.
 */
export async function savePacingPlan(
  slug: string,
  lineItems: PacingLineItemPlanUpdateV1[]
): Promise<PacingPlanUpdateResultV1> {
  const result = await apiClient.POST("/api/v1/pacing/dashboards/{slug}/plan", {
    params: { path: { slug } },
    body: { lineItems },
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}

/** Fetches this pacing's own campaign(s)' line items not already on it (§9, US-126). */
export async function getAddablePacingLineItems(slug: string): Promise<PacingAddableLineItemsV1> {
  const result = await apiClient.GET("/api/v1/pacing/dashboards/{slug}/addable-line-items", {
    params: { path: { slug } },
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}

/**
 * Looks up line items by id directly (§9, US-126's add-by-id path) - including a line item from a
 * different campaign than the pacing's own, returned and marked with its own campaign identity.
 */
export async function validatePacingLineItemsById(lineItemIds: string[]): Promise<PacingDraftV1> {
  const result = await apiClient.POST("/api/v1/pacing/line-items/validate", {
    body: { lineItemIds },
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}

/** Changes a pacing's administrative lifecycle status (§9, US-128). */
export async function updatePacingStatus(pacingId: string, status: PacingLifecycleStatus): Promise<void> {
  const result = await apiClient.PATCH("/api/v1/pacing/pacings/{pacingId}/status", {
    params: { path: { pacingId } },
    body: { status },
  });
  if (result.error || !result.response.ok) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
}
