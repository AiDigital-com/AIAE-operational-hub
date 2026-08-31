package com.aidigital.operationalhub.service.agency;

/**
 * The most level-1 campaign names a single "Roll back adjustments" request may name.
 *
 * <p>Deliberately not {@link AdjustmentRoundTripLimits#MAX_ROWS}: that number bounds the rows a
 * bulk-adjustment template round trip may carry, which is a question about a spreadsheet's row count,
 * not about how many distinct level-1 campaigns one campaign's report can plausibly contain. Reusing it
 * here would let a request name up to 100,000 constructed names, a ceiling with no relationship to the
 * thing it would be bounding.
 *
 * <p>The real ceiling already exists elsewhere: {@code BigQueryReportRowService.DISTINCT_VALUES_LIMIT}
 * caps every dimension's own value picker - including {@code line_item_name}, the level-1 dimension a
 * rollback scopes by - at 500 distinct values. The report's own UI can therefore never offer more than
 * 500 level-1 names to select from in the first place, so a request naming more than that could only be
 * hand-crafted, never produced by picking values the report actually shows.
 */
public final class AdjustmentRollbackLimits {

	/**
	 * The most level-1 campaign names one rollback (or preview) request may name.
	 */
	public static final int MAX_CAMPAIGN_NAMES = 500;

	private AdjustmentRollbackLimits() {
	}
}
