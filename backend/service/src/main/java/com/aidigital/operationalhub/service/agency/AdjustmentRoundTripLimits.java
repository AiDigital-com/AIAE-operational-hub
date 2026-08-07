package com.aidigital.operationalhub.service.agency;

/**
 * The row ceiling shared by every download-edit-upload round trip.
 *
 * <p>One constant because the three places that used to hold their own copy are not independent choices -
 * they are the same number, and the round trip breaks the moment they disagree. A template that can hand
 * out more rows than the parser will accept produces a file that cannot be returned; a parser that accepts
 * more than the read can match produces rows that silently find no baseline. Both were previously prevented
 * by comments asking the next reader to keep three literals in step.
 *
 * <p>It lives in the service module rather than beside the workbook reader because the reads are here and
 * the application module depends on this one, not the other way round.
 *
 * <p>The number itself is a judgement about how large a single manual edit may get, not a limit of any
 * component: the whole result is materialized in memory before a byte is written, so the ceiling bounds
 * that list. It was chosen against real usage - the 99th percentile report was well under it.
 */
public final class AdjustmentRoundTripLimits {

	/**
	 * The most rows a template may carry, an export may emit, or an upload may be parsed into.
	 */
	public static final int MAX_ROWS = 100_000;

	private AdjustmentRoundTripLimits() {
	}
}
