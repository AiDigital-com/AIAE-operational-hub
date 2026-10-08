package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * Which half of a reference-data sync failed, and what Pacing said about it.
 *
 * @param part   {@code nsmapping} or {@code margin_kpi}
 * @param detail Pacing's own message, passed through rather than re-worded
 */
public record PacingReferenceSyncError(
		String part,
		String detail) {
}
