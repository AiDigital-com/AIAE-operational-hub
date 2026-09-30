package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * The subset of Pacing's per-row {@code health} object the Overview screen (§4 of the migration
 * plan) needs — computed server-side by {@code computeHealthBatch}, never recomputed here.
 *
 * <p>Pacing's health object also carries {@code spend_pct} and the
 * {@code li_on_pace}/{@code li_over}/{@code li_under} pace breakdown; left out because the Overview
 * row does not show them (its own under/over group badges count row-level {@code status}).
 *
 * @param status           pace category: {@code on_pace} | {@code under} | {@code over} |
 *                         {@code no_data} | {@code inactive}
 * @param pacingPp         percentage-point deviation from expected pace; serialized as
 *                         {@code pacing_pp}
 * @param marginActual     budget-weighted actual margin percentage; serialized as
 *                         {@code margin_actual}
 * @param marginTarget     budget-weighted target margin percentage; serialized as
 *                         {@code margin_target}
 * @param budgetTotal      total planned budget across the pacing's line items; serialized as
 *                         {@code budget_total}
 * @param liCount          line items with computed health figures; serialized as {@code li_count} —
 *                         can differ from the row's own {@code line_item_count} while data is still
 *                         arriving
 * @param daysRemaining    days until flight end, never negative; serialized as
 *                         {@code days_remaining}
 * @param periodScope      serialized as {@code period_scope} — whether the figures are scoped to a
 *                         reporting period rather than the whole flight; null/false when off
 * @param periodScopeState serialized as {@code period_scope_state} — {@code in_period} |
 *                         {@code ended} | {@code upcoming} | {@code no_period}; null when scope is
 *                         off
 * @param periodLabel      serialized as {@code period_label} — the scoped period's display label,
 *                         when one is configured
 * @param lineItems        serialized as {@code line_items} — the per-line-item breakdown the
 *                         Overview's expanded row renders
 * @param alerts           alert badges raised for this pacing (US-110)
 */
public record PacingHealth(
		String status,
		@JsonProperty("pacing_pp") Double pacingPp,
		@JsonProperty("margin_actual") Double marginActual,
		@JsonProperty("margin_target") Double marginTarget,
		@JsonProperty("budget_total") Double budgetTotal,
		@JsonProperty("li_count") Integer liCount,
		@JsonProperty("days_remaining") Integer daysRemaining,
		@JsonProperty("period_scope") Boolean periodScope,
		@JsonProperty("period_scope_state") String periodScopeState,
		@JsonProperty("period_label") String periodLabel,
		@JsonProperty("line_items") List<PacingLineItemHealth> lineItems,
		List<PacingAlert> alerts) {
}
