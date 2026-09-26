package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Shape of Pacing's {@code POST /api/pacings} success (201) response body.
 *
 * @param pacingId serialized as {@code pacing_id}
 * @param dashSlug serialized as {@code dash_slug}
 */
record CreateResponse(
		@JsonProperty("pacing_id") String pacingId, @JsonProperty("dash_slug") String dashSlug) {
}
