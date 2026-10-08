package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.List;

/**
 * What a manual reference-data sync wrote ({@code POST /api/admin/sync-reference-data} on the
 * Pacing side): the two syncs Pacing otherwise runs on a schedule, pulled now.
 *
 * <p>The counts are rows actually stored, and they are the point. A workbook that answered empty,
 * or one the service can read but that holds nothing, finishes without an error and leaves every
 * new pacing falling back to the create screen's 25% margin - a bare "ok" would call that success.
 *
 * <p>Either half may fail on its own: they are independent tables feeding independent screens, so
 * a malformed Namebuilder tab must not stop the margin targets being refreshed. {@code ok} is true
 * only when both succeeded; {@code errors} names the ones that did not.
 *
 * @param ok        whether both halves succeeded
 * @param nsmapping rows written to the four Namebuilder tables, or null when that half failed
 * @param marginKpi rows written to the two pre-fill tables, or null when that half failed
 * @param errors    one entry per failed half; empty when {@code ok}
 */
public record PacingReferenceSyncResult(
		boolean ok,
		PacingReferenceSyncNsmapping nsmapping,
		PacingReferenceSyncMarginKpi marginKpi,
		List<PacingReferenceSyncError> errors) {
}
