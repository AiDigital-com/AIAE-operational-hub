package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

/**
 * One line item's plan, as {@code GET /api/dashboards/:slug/data} returns it under
 * {@code planByLineItem} (§6 of the migration plan), keyed by line item id. Built server-side by
 * Pacing's own {@code buildPlanByLineItem} - already camelCase on the wire, so no {@code @JsonProperty}
 * translation is needed here.
 *
 * <p>Deliberately narrow: Pacing's real object also carries {@code bidCpm}; it is read nowhere in the
 * browser-side metric engine ({@code dashboard-metrics.js} has zero occurrences of it), so it stays
 * off this record. {@code native_budget} IS read (§9, US-125): it is the money truth for a converted
 * (non-USD) line item's budget - editing it needs no exchange rate and computes nothing, since the
 * value round-trips verbatim (Pacing re-derives its own USD cache server-side on save, exactly as it
 * does at create). {@code cost_coef}/{@code converted}/{@code currency} are ALSO read: {@code
 * cost_coef} is a MATH input (switches this line item into per-fact-row coefficient-cost margin
 * resolution in the browser-side engine, instead of its flat line-item margin); {@code converted}/
 * {@code currency} are display-only (feed the contract-total badge), carried through alongside it.
 *
 * <p>{@code containers} (date-based plan overrides, §9/§10) is kept opaque - the Hub's plan-vs-actual
 * charts prorate the whole-flight plan linearly and do not replicate Pacing's container-aware curve;
 * see {@code PacingContractMapper}/the OpenAPI schema description for the resulting, documented gap.
 *
 * @param lineItemId         the line item id
 * @param channel            delivery channel
 * @param dsp                DSP name
 * @param labels             free-text tags this line item carries (§9)
 * @param description        the line item's own description/name, if Pacing has one
 * @param rateType           billing rate type (CPM/CPC/CPV/flat)
 * @param clientBudget       planned client budget for the whole flight
 * @param plannedImpressions target impressions for the whole flight; 0 on a freshly created pacing
 *                           whose plan import lost this value between validate and build (a known
 *                           Pacing-side gap tracked for §8) - callers must treat 0 here as "no plan",
 *                           never as a real target
 * @param marginTargetPct    target margin percentage
 * @param ctrTargetPct       target CTR percentage, if this line item is CTR-gated
 * @param vcrTargetPct       target VCR percentage, if this line item is video
 * @param flightStart        flight start date (YYYY-MM-DD)
 * @param flightEnd          flight end date (YYYY-MM-DD)
 * @param pauseIntervals     manually recorded pause windows
 * @param containers         date-based plan overrides (§9/§10); opaque, see class javadoc
 * @param nativeBudget       serialized as {@code native_budget} (an existing wire inconsistency -
 *                           every other field on this object is camelCase); the line item's budget
 *                           in its own native currency, null for a USD line item (see
 *                           {@code clientBudget} instead there)
 * @param costCoef           serialized as {@code cost_coef} (same wire inconsistency as
 *                           {@code nativeBudget}); whether this line item runs the coefficient-cost
 *                           model, always present, never null (`li.cost_coef === true`)
 * @param converted          whether this line item's budget carries a real currency conversion,
 *                           always present, never null; display-only
 * @param currency           the campaign's currency code when {@code converted} is true, else null;
 *                           display-only
 */
public record PacingLineItemPlan(
		String lineItemId,
		String channel,
		String dsp,
		List<String> labels,
		String description,
		String rateType,
		Double clientBudget,
		Double plannedImpressions,
		Double marginTargetPct,
		Double ctrTargetPct,
		Double vcrTargetPct,
		String flightStart,
		String flightEnd,
		List<PacingPauseInterval> pauseIntervals,
		List<Map<String, Object>> containers,
		@JsonProperty("native_budget") Double nativeBudget,
		@JsonProperty("cost_coef") Boolean costCoef,
		Boolean converted,
		String currency) {
}
