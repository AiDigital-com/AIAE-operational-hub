package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * The campaign exchange-rate part of a plan save (Settings → Plan), sent beside the line items in
 * the SAME {@code POST /api/dashboards/:slug/settings} request: Pacing stores {@code rate} before it
 * merges the line items, so the new rate governs the USD figures that very save re-materializes.
 * Either field may be null, and null means "omit the key from the wire body" - Pacing keeps the
 * stored value - never "send null".
 *
 * @param rate       the new rate (USD per one unit of the campaign's currency), or null to leave it
 * @param rateLocked true after a manual rate edit, false after Reset to NS, or null to leave it
 */
public record PacingPlanRateUpdate(Double rate, Boolean rateLocked) {
}
