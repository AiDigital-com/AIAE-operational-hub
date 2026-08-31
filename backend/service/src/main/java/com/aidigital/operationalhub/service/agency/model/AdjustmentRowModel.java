package com.aidigital.operationalhub.service.agency.model;

/**
 * One adjustment row to append to the report-rows write table: an override of an existing report row
 * ({@code added=false}) or a manually-added row ({@code added=true}). Carries the base row's full
 * identity tuple plus the edited stored-metric values; the derived {@code cpm}/{@code ctr}/{@code avcr}
 * are intentionally absent (they are not stored anywhere - see {@link ReportRowTotalsModel}). {@code
 * rate_type}, {@code line_item_description}, {@code dynamic_rate} and {@code
 * avg_dynamic_rate_by_date_tactic} are absent for a different reason: they exist only on the read view
 * ({@code platform_mart_adjustments_view_op_hub}), not on the underlying write table, so a value for any
 * of them can never actually be persisted. The campaign identity is copied from the report row being
 * edited (or derived from a manually-added row's constructed name), while the created/last-modified stamps
 * are set by the service from the current user, never by the caller.
 *
 * @param added                   {@code true} for a manually-added row, {@code false} for an override of
 *                                an existing row
 * @param date                    the delivery date
 * @param platform                the DSP/ad-server platform
 * @param account                 the platform account name
 * @param accountId               the platform account id
 * @param lineItemName            the line-item-level constructed name
 * @param lineItemId              the line-item-level constructed id
 * @param insertionOrderName      the insertion-order-level constructed name
 * @param insertionOrderId        the insertion-order-level constructed id
 * @param campaignConstructedName the campaign-level constructed name
 * @param campaignConstructedId   the campaign-level constructed id
 * @param agencyId                the naming-convention agency id
 * @param client                  the naming-convention client name
 * @param industryCode            the naming-convention industry code
 * @param campaignName            the naming-convention campaign name
 * @param channel                 the naming-convention channel
 * @param tactic                  the naming-convention tactic
 * @param buyingModel             the naming-convention buying model
 * @param audience                the naming-convention audience
 * @param uniqueLineItemId        the naming-convention unique line item id
 * @param other                   the naming-convention "other" free-form segment
 * @param geo                     the naming-convention geo
 * @param creativeTag             the naming-convention creative tag
 * @param message                 the naming-convention message
 * @param keywordGroup            the naming-convention keyword group
 * @param flightIdentifier        the naming-convention flight identifier
 * @param language                the naming-convention language
 * @param impressions             delivered impressions, or {@code null} when not adjusted
 * @param clicks                  delivered clicks, or {@code null} when not adjusted
 * @param spend                   delivered spend, or {@code null} when not adjusted
 * @param starts                  video starts, or {@code null} when not adjusted
 * @param firstQuartiles          video first-quartile completions, or {@code null} when not adjusted
 * @param midpoints               video midpoint completions, or {@code null} when not adjusted
 * @param thirdQuartiles          video third-quartile completions, or {@code null} when not adjusted
 * @param completes               video completions, or {@code null} when not adjusted
 * @param dynamicCost             rate-card (dynamic) cost, or {@code null} when not adjusted
 * @param linkClicks              link clicks, or {@code null} when not adjusted
 */
public record AdjustmentRowModel(
		boolean added,
		String date, String platform, String account, String accountId,
		String lineItemName, String lineItemId,
		String insertionOrderName, String insertionOrderId,
		String campaignConstructedName, String campaignConstructedId,
		String agencyId, String client, String industryCode, String campaignName, String channel, String tactic,
		String buyingModel, String audience, String uniqueLineItemId, String other,
		String geo, String creativeTag, String message, String keywordGroup,
		String flightIdentifier, String language,
		Long impressions, Long clicks, Double spend, Long starts, Long firstQuartiles,
		Long midpoints, Long thirdQuartiles, Long completes, Double dynamicCost, Long linkClicks) {
}
