package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.List;
import java.util.Map;

/**
 * Shape of the {@code data} object inside a data-settings save, under the snake_case names
 * Pacing's {@code config.data} namespace stores.
 *
 * <p>NON_NULL, and load-bearing for the same reason {@link LineItemPlanUpdateRequest} carries it:
 * Pacing's merge gates each key on {@code hasOwnProperty}, so a key present with an explicit null
 * is an instruction to WRITE null, not an absent field. The Hub sends nulls for every setting its
 * caller did not touch, so they have to be omitted rather than serialized - otherwise saving the
 * BigQuery source alone would blank the pacing's fetch toggles and delete its dimension sources.
 *
 * @param source            the BigQuery table delivery is read from
 * @param fetch_creatives   whether DSP creative assets are fetched with it
 * @param fetch_conversions whether conversions are fetched with it
 * @param dim_sources       the whole dimension-source list, opaque - forwarded byte-for-byte
 */
@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
record DataNamespaceRequest(
		String source,
		Boolean fetch_creatives,
		Boolean fetch_conversions,
		List<Map<String, Object>> dim_sources) {
}
