package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Shape of Pacing's {@code POST /api/admin/backfill-order-numbers} response body - the run's
 * summary, under the snake_case keys dash-gate answers with. {@code ok} is not read: a non-2xx
 * never reaches deserialization, and a 200 is always {@code ok: true} on that side.
 *
 * @param scanned          pacings examined
 * @param filled           pacings given an insertion_order_id by this run
 * @param alreadyHad       pacings that already had one (left untouched)
 * @param skippedNoNumbers pacings whose line items carry no order number to fill from
 */
record OrderNumberBackfillResponse(
		Integer scanned,
		Integer filled,
		@JsonProperty("already_had") Integer alreadyHad,
		@JsonProperty("skipped_no_numbers") Integer skippedNoNumbers) {
}
