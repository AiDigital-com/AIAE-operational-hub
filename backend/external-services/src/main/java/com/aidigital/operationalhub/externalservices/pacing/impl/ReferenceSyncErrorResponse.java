package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * One failed half of a reference-data sync, as dash-gate reports it.
 *
 * @param part   {@code nsmapping} or {@code margin_kpi}
 * @param detail Pacing's own message
 */
record ReferenceSyncErrorResponse(
		String part,
		String detail) {
}
