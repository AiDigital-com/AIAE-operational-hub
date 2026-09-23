package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * One line item's set of changed fields (§13 of the migration plan, US-136) — the shared wrapper
 * shape of both the {@code field_diff} and {@code plan_diff} classes in {@link PacingNsDiffReport}:
 * identical on the wire, differing only in which array they populate ({@code field_diff} for
 * descriptive/flight fields, {@code plan_diff} for plan figures).
 *
 * @param lineItemId serialized as {@code line_item_id}
 * @param fields     the changed fields for this line item
 */
public record PacingNsDiffLineItemFields(
		@JsonProperty("line_item_id") String lineItemId, List<PacingNsDiffFieldChange> fields) {
}
