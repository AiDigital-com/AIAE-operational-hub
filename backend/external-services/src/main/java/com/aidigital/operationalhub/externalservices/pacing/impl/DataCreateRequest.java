package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Shape of the {@code data} object inside the {@code POST /api/pacings} request body - the
 * create-time twin of {@link DataNamespaceRequest} (which serves the settings save), carrying the
 * create screen's {@code coef_enabled} gate that the settings save does not send. Snake_case wire
 * keys, matching dash-gate's {@code safeDataSource}/{@code safeFetchCreatives}/
 * {@code safeFetchConversions}/{@code safeCoefEnabled} readers.
 *
 * <p>NON_NULL for {@link DataNamespaceRequest}'s reason: Pacing treats an absent key as "apply the
 * default", and that is what a null field here means.
 *
 * @param source            which BigQuery table delivery is read from
 * @param fetch_creatives   fetch DSP creative assets alongside delivery
 * @param fetch_conversions fetch conversions alongside delivery
 * @param coef_enabled      UI-visibility gate for the coefficient-cost feature
 * @param net_enabled       net cost mode's pacing-level switch (Pacing spec 2026-09-07)
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
record DataCreateRequest(
		String source,
		Boolean fetch_creatives,
		Boolean fetch_conversions,
		Boolean coef_enabled,
		Boolean net_enabled) {
}
