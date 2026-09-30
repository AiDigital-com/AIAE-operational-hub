package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.List;

/**
 * One line item's health entry inside a pacing row's {@code health.line_items} array, as Pacing's
 * {@code computeHealthBatch} builds it ({@code dash-gate/lib/health.mjs}) — what the Overview's
 * expanded row shows. Pacing's wire object also carries {@code dsp}, {@code targetImpressions},
 * {@code actualImpressions}, {@code actualUnits}, {@code targetUnits}, {@code proratedBudget} and
 * {@code actualSpend}; they are not read because the Overview row does not show them.
 *
 * <p>All keys are camelCase on the wire already, so no renames are needed.
 *
 * @param lineItemId      NetSuite/Pacing line item id
 * @param channel         delivery channel / media tactic
 * @param rateType        billing rate type ({@code CPM}/{@code CPC}/{@code CPV})
 * @param flightStart     the line item's effective flight start, {@code YYYY-MM-DD}
 * @param flightEnd       the line item's effective flight end, {@code YYYY-MM-DD}
 * @param budget          the line item's planned budget
 * @param marginActualPct actual margin percentage; null before any delivery data
 * @param marginTargetPct target margin percentage
 * @param pacingIndex     percentage-point deviation from expected pace, same convention as the
 *                        row-level {@code pacing_pp}; null before any delivery data
 * @param isPaused        whether the line item is paused as of the data's latest date
 * @param costCoef        whether it runs on a cost coefficient instead of a margin target — its
 *                        margin then renders neutrally rather than against a target
 * @param recent          the most recent delivery days, newest first (up to 7)
 * @param kpis            the line item's KPI targets, for the sparklines
 */
public record PacingLineItemHealth(
		String lineItemId,
		String channel,
		String rateType,
		String flightStart,
		String flightEnd,
		Double budget,
		Double marginActualPct,
		Double marginTargetPct,
		Double pacingIndex,
		Boolean isPaused,
		Boolean costCoef,
		List<PacingRecentDay> recent,
		List<PacingKpiTarget> kpis) {
}
