package com.aidigital.operationalhub.service.agency.model;

/**
 * Aggregate metric totals across every {@link ReportRowModel} matching a report-rows query — always
 * computed over the full filtered dataset in BigQuery, never just the rows on the current page, so a
 * paginated table's totals row stays stable while more pages load.
 *
 * @param impressions           summed delivered impressions, or {@code null}
 * @param clicks                summed delivered clicks, or {@code null}
 * @param spend                 summed delivered spend, or {@code null}
 * @param starts                summed video starts, or {@code null}
 * @param firstQuartiles        summed video first-quartile completions, or {@code null}
 * @param midpoints              summed video midpoint completions, or {@code null}
 * @param thirdQuartiles        summed video third-quartile completions, or {@code null}
 * @param completes             summed video completions, or {@code null}
 * @param conversions           summed conversions, or {@code null}
 * @param postClickConversions  summed post-click conversions, or {@code null}
 * @param postViewConversions   summed post-view conversions, or {@code null}
 * @param dynamicCost           summed rate-card (dynamic) cost, or {@code null}
 * @param linkClicks            summed link clicks, or {@code null}
 * @param dynamicRate           the rate-card (dynamic) rate, summed cost over summed billable units, or {@code null}
 * @param avgDynamicRateByDateTactic always {@code null} - the view computes this column with a window
 *                              function, which BigQuery refuses to aggregate over, so there is no total
 *                              to state; kept in the record so the totals row and the columns above it
 *                              stay one-to-one
 * @param ivt                   summed modelled invalid impressions, or {@code null}
 * @param cpm                   derived {@code spend / impressions * 1000}, or {@code null} when impressions is zero
 * @param cpc                   derived {@code spend / clicks}, or {@code null} when clicks is zero
 * @param cpv                   derived {@code spend / starts} - a view is a start, per the source view's own
 *                              CPV rate - or {@code null} when starts is zero
 * @param ctr                   derived {@code clicks / impressions * 100}, or {@code null} when impressions is zero
 * @param avcr                  derived {@code completes / impressions * 100}, or {@code null} when impressions is zero
 */
public record ReportRowTotalsModel(
		Long impressions,
		Long clicks,
		Double spend,
		Long starts,
		Long firstQuartiles,
		Long midpoints,
		Long thirdQuartiles,
		Long completes,
		Double conversions,
		Double postClickConversions,
		Double postViewConversions,
		Double dynamicCost,
		Long linkClicks,
		Double dynamicRate,
		Double avgDynamicRateByDateTactic,
		Double ivt,
		Double cpm,
		Double cpc,
		Double cpv,
		Double ctr,
		Double avcr) {

}
