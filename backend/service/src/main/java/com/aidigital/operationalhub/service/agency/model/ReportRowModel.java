package com.aidigital.operationalhub.service.agency.model;

/**
 * Immutable view of one per-day, per-line-item delivery/actuals row, sourced from the
 * {@code platform_mart_adjustments_view_op_hub} BigQuery view (which already merges the base
 * {@code platform_mart} data with manual op-hub adjustments server-side).
 *
 * @param date                       the delivery date (ISO format)
 * @param platform                   the DSP/ad-server platform, may be {@code null}
 * @param account                    the platform account name, may be {@code null}
 * @param accountId                  the platform account id, may be {@code null}
 * @param lineItemName               the line-item-level constructed name, may be {@code null}
 * @param lineItemId                 the line-item-level constructed id, may be {@code null}
 * @param insertionOrderName         the insertion-order-level constructed name, may be {@code null}
 * @param insertionOrderId           the insertion-order-level constructed id, may be {@code null}
 * @param campaignConstructedName    the campaign-level constructed name, may be {@code null}
 * @param campaignConstructedId      the campaign-level constructed id, may be {@code null}
 * @param agencyId                   the naming-convention agency id, may be {@code null}
 * @param client                     the naming-convention client name, may be {@code null}
 * @param industryCode               the naming-convention industry code, may be {@code null}
 * @param campaignName               the naming-convention campaign name, may be {@code null}
 * @param channel                    the naming-convention channel, may be {@code null}
 * @param tactic                     the naming-convention tactic, may be {@code null}
 * @param buyingModel                the naming-convention buying model, may be {@code null}
 * @param audience                   the naming-convention audience, may be {@code null}
 * @param uniqueLineItemId           the naming-convention unique line item id, may be {@code null}
 * @param other                      the naming-convention "other" free-form segment, may be {@code null}
 * @param geo                        the naming-convention geo, may be {@code null}
 * @param creativeTag                the naming-convention creative tag, may be {@code null}
 * @param message                    the naming-convention message, may be {@code null}
 * @param keywordGroup               the naming-convention keyword group, may be {@code null}
 * @param flightIdentifier           the naming-convention flight identifier, may be {@code null}
 * @param language                   the naming-convention language, may be {@code null}
 * @param impressions                delivered impressions, may be {@code null}
 * @param clicks                     delivered clicks, may be {@code null}
 * @param spend                      delivered spend, may be {@code null}
 * @param starts                     video starts, may be {@code null}
 * @param firstQuartiles             video first-quartile completions, may be {@code null}
 * @param midpoints                  video midpoint completions, may be {@code null}
 * @param thirdQuartiles             video third-quartile completions, may be {@code null}
 * @param completes                  video completions, may be {@code null}
 * @param conversions                conversions, may be {@code null}
 * @param postClickConversions       post-click conversions, may be {@code null}
 * @param postViewConversions        post-view conversions, may be {@code null}
 * @param dynamicCost                rate-card (dynamic) cost, may be {@code null}
 * @param linkClicks                 link clicks, may be {@code null}
 * @param adjustedMetrics            a marker of which metrics were manually adjusted, may be {@code null}
 * @param createdAt                  the row's creation timestamp, may be {@code null}
 * @param createdBy                  the row's creator, may be {@code null}
 * @param lastModifiedAt             the row's last-modified timestamp, may be {@code null}
 * @param lastModifiedBy             the row's last modifier, may be {@code null}
 * @param rateType                   the rate type (e.g. CPM), may be {@code null}
 * @param dynamicRate                the rate-card (dynamic) rate, may be {@code null}
 * @param avgDynamicRateByDateTactic the average dynamic rate by date and tactic, may be {@code null}
 * @param lineItemDescription        the free-form line item description, may be {@code null}
 * @param ivt                        modelled invalid impressions, {@code null} on an exempt channel
 * @param cpm                        client cost per thousand impressions, {@code null} where the row's
 *                                   channel does not price impressions
 * @param cpc                        client cost per click, {@code null} where clicks are not priced
 * @param cpv                        client cost per completed view, {@code null} off a viewable channel
 * @param ctr                        click-through rate as a percentage, {@code null} off a clickable channel
 * @param avcr                       completion rate as a percentage, {@code null} off a viewable channel
 */
public record ReportRowModel(
		String date,
		String platform,
		String account,
		String accountId,
		String lineItemName,
		String lineItemId,
		String insertionOrderName,
		String insertionOrderId,
		String campaignConstructedName,
		String campaignConstructedId,
		String agencyId,
		String client,
		String industryCode,
		String campaignName,
		String channel,
		String tactic,
		String buyingModel,
		String audience,
		String uniqueLineItemId,
		String other,
		String geo,
		String creativeTag,
		String message,
		String keywordGroup,
		String flightIdentifier,
		String language,
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
		String adjustedMetrics,
		String createdAt,
		String createdBy,
		String lastModifiedAt,
		String lastModifiedBy,
		String rateType,
		Double dynamicRate,
		Double avgDynamicRateByDateTactic,
		String lineItemDescription,
		Double ivt,
		Double cpm,
		Double cpc,
		Double cpv,
		Double ctr,
		Double avcr) {

}
