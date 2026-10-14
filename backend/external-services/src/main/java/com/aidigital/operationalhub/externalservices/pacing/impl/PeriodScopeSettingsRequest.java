package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Shape of the period-scope-only {@code POST /api/dashboards/:slug/settings} request body - carries
 * {@code period_scope} and {@code period_scope_key} only, for the same reason
 * {@link ThirdPartySettingsRequest} carries only its own key.
 *
 * @param periodScope    true shows one period of the line items' containers, false the whole flight
 * @param periodScopeKey the period as {@code start|end}, or null; sent as null rather than left out,
 *                       so turning scope off clears the key saved with it
 */
record PeriodScopeSettingsRequest(
		@JsonProperty("period_scope") boolean periodScope,
		@JsonProperty("period_scope_key") String periodScopeKey) {
}
