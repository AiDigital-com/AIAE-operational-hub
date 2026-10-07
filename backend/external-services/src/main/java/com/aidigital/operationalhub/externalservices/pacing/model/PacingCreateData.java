package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * The new pacing's {@code config.data} namespace at create ({@code POST /api/pacings} body.data):
 * which BigQuery table its delivery is read from and which optional extras ride along. Pacing
 * normalises every field through its own allowlist ({@code safeDataSource}/{@code safeFetchCreatives}/
 * {@code safeFetchConversions}/{@code safeCoefEnabled} in dash-gate/lib/data-config.mjs) and applies
 * defaults for anything absent, so every field here may be null.
 *
 * @param source           which BigQuery table delivery is read from ({@code platform_mart} or
 *                         {@code platform_mart_adjustments_view})
 * @param fetchCreatives   fetch DSP creative assets alongside delivery
 * @param fetchConversions fetch conversions alongside delivery
 * @param coefEnabled      UI-visibility gate for the coefficient-cost feature - mirrors the create
 *                         screen's master toggle; the maths stays driven by each line item's
 *                         {@code costCoef} flag regardless
 * @param netEnabled       net cost mode's pacing-level switch (Pacing spec 2026-09-07) - NOT a pure
 *                         UI flag: while on, client cost reads net = gross × each line item's ratio
 */
public record PacingCreateData(
		String source,
		Boolean fetchCreatives,
		Boolean fetchConversions,
		Boolean coefEnabled,
		Boolean netEnabled) {
}
