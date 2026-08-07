package com.aidigital.operationalhub.service.agency.model;

import java.util.List;

/**
 * Immutable view of a campaign sourced from BigQuery.
 *
 * @param id               the BigQuery campaign id
 * @param name             the campaign name
 * @param clientId         the advertiser/client id, may be {@code null}
 * @param clientName       the advertiser/client name, may be {@code null}
 * @param agencyId         the agency id, may be {@code null}
 * @param agencyName       the agency name, may be {@code null}
 * @param status           the campaign status (e.g. {@code LIVE}/{@code PAUSED})
 * @param startDate        the campaign flight start date (ISO format), may be {@code null}
 * @param endDate          the campaign flight end date (ISO format), may be {@code null}
 * @param budget           the total campaign budget (summed from each line item's own tactic budget),
 *                         may be {@code null}
 * @param channels         the distinct media tactics / channels, never {@code null}
 * @param industryVertical the client's industry / vertical, may be {@code null}
 * @param lineItemCount    the campaign's distinct line-item count, may be {@code null}
 * @since 1.0
 */
public record CampaignModel(
		Long id,
		String name,
		Long clientId,
		String clientName,
		Long agencyId,
		String agencyName,
		String status,
		String startDate,
		String endDate,
		Double budget,
		List<String> channels,
		String industryVertical,
		Long lineItemCount) {

}
