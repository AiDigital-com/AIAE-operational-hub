package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One proposed route from a sheet name to a line item.
 *
 * @param value      the name as it appears in the sheet
 * @param lineItemId the line item it is proposed to belong to
 */
public record PacingDimSourceBinding(
		String value,
		@JsonProperty("line_item_id") String lineItemId) {
}
