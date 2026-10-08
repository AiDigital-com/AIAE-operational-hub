package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.List;

/**
 * Shape of Pacing's {@code POST /api/admin/sync-reference-data} response body.
 *
 * <p>Unlike the other admin actions, {@code ok} IS read here: that endpoint answers 200 even when
 * one half failed, because the half that succeeded really did write and a blanket 500 would hide
 * it. So a 2xx is not by itself a success, and the body is what says which.
 *
 * @param ok        both halves succeeded
 * @param nsmapping counts from the NSMapping half, null when it failed
 * @param marginKpi counts from the Margin+KPI half, null when it failed
 * @param errors    one entry per failed half
 */
record ReferenceSyncResponse(
		Boolean ok,
		ReferenceSyncNsmappingCounts nsmapping,
		ReferenceSyncMarginKpiCounts marginKpi,
		List<ReferenceSyncErrorResponse> errors) {
}
