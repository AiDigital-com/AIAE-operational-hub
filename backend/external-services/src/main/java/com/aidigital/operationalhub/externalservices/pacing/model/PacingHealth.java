package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * The subset of Pacing's per-row {@code health} object the Overview screen (§4 of the migration
 * plan) needs — computed server-side by {@code computeHealthBatch}, never recomputed here.
 *
 * <p>Pacing's health object also carries {@code spend_pct}, {@code days_remaining} and the
 * {@code li_on_pace}/{@code li_over}/{@code li_under}/{@code li_count} line-item breakdown; left out
 * because the Overview row does not show them.
 *
 * @param status      pace category: {@code on_pace} | {@code under} | {@code over} | {@code no_data}
 *                    | {@code inactive}
 * @param pacingPp    percentage-point deviation from expected pace; serialized as {@code pacing_pp}
 * @param marginActual budget-weighted actual margin percentage; serialized as {@code margin_actual}
 * @param marginTarget budget-weighted target margin percentage; serialized as {@code margin_target}
 * @param budgetTotal  total planned budget across the pacing's line items; serialized as
 *                     {@code budget_total}
 * @param alerts       alert badges raised for this pacing (US-110)
 */
public record PacingHealth(
		String status,
		@JsonProperty("pacing_pp") Double pacingPp,
		@JsonProperty("margin_actual") Double marginActual,
		@JsonProperty("margin_target") Double marginTarget,
		@JsonProperty("budget_total") Double budgetTotal,
		List<PacingAlert> alerts) {
}
