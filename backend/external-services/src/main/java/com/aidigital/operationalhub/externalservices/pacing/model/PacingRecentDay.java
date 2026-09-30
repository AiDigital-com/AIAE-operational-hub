package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * One recent delivery day of a line item, exactly as Pacing's {@code recentDailyMetrics}
 * ({@code shared/pacing-core.js}) computed it — newest first on the wire. The Overview renders these
 * as the 7-day delivery heatmap ({@code units} vs {@code tgtUnitsReforecast}, {@code rate} vs
 * {@code tgtRate}) and the KPI sparklines ({@code ctr}/{@code vcr} series); nothing is recomputed on
 * this side. Pacing's wire object also carries cumulative {@code margin} and {@code pacing} figures;
 * they are not read because no Hub screen shows them per day.
 *
 * <p>All keys are camelCase or single words on the wire already, so no renames are needed.
 *
 * @param date               the delivery day, {@code YYYY-MM-DD}
 * @param impr               impressions delivered that day
 * @param spend              spend that day
 * @param clicks             clicks that day
 * @param completes          video/audio completes that day
 * @param ctr                that day's CTR, as a percentage
 * @param vcr                that day's VCR (completes over impressions), as a percentage
 * @param cpm                that day's effective CPM
 * @param tgtCpm             the plan's target CPM
 * @param tgtImpr            expected impressions for that day per the static plan
 * @param rateType           the billing rate type ({@code CPM}/{@code CPC}/{@code CPV}) the native
 *                           units follow
 * @param units              delivered units in the rate type's native unit
 * @param tgtUnits           expected native units for that day per the static plan
 * @param tgtUnitsReforecast expected native units per the pace-to-goal reforecast — the heatmap's
 *                           preferred delivery target; 0 on a day the line item was paused
 * @param rate               that day's effective rate in the native rate type
 * @param tgtRate            the plan's target rate in the native rate type
 */
public record PacingRecentDay(
		String date,
		Double impr,
		Double spend,
		Double clicks,
		Double completes,
		Double ctr,
		Double vcr,
		Double cpm,
		Double tgtCpm,
		Double tgtImpr,
		String rateType,
		Double units,
		Double tgtUnits,
		Double tgtUnitsReforecast,
		Double rate,
		Double tgtRate) {
}
