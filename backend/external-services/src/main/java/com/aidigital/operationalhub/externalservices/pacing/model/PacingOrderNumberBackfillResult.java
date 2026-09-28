package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * Summary of an IO-number backfill run ({@code POST /api/admin/backfill-order-numbers} on the
 * Pacing side): a synchronous, purely-local pass that fills the missing campaign-level
 * {@code insertion_order_id} from the {@code order_number} values already stored on each pacing's
 * line items. Fill-only and idempotent - the four counters partition the scanned set, and a repeat
 * run reports zero filled.
 *
 * @param scanned          how many pacings were examined (all of them - the pass is a full scan)
 * @param filled           how many were given an {@code insertion_order_id} by this run
 * @param alreadyHad       how many already had one and were left untouched (fill-only)
 * @param skippedNoNumbers how many could not be filled because none of their line items carries an
 *                         order number
 */
public record PacingOrderNumberBackfillResult(
		int scanned,
		int filled,
		int alreadyHad,
		int skippedNoNumbers) {
}
