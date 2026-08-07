package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqSql;
import com.aidigital.operationalhub.service.agency.bigquery.model.CampaignDeliveryScope;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Builds the reusable BigQuery scope that ties NetSuite campaigns to delivery/conversion marts.
 */
@Component
@RequiredArgsConstructor
class CampaignDeliveryScopeResolver {

	static final String CAMPAIGN_ID_ALIAS = "campaign_id";
	static final String LINE_ITEM_ID_ALIAS = "line_item_id";
	static final String CONSTRUCTED_NAME_ALIAS = "constructed_name";

	private static final List<String> CLIENT_NAME_PLACEHOLDERS = List.of("-", "null", "client without name");

	private final BigQuerySearchGateway gateway;
	private final BigQueryProperties bigQueryProperties;

	/**
	 * Builds the delivery scope for one visible campaign.
	 *
	 * @param campaign the visible campaign
	 * @return the campaign delivery scope
	 */
	CampaignDeliveryScope forCampaign(CampaignModel campaign) {
		BqRequest lineItems = lineItemsForCampaign(campaign.id());
		return new CampaignDeliveryScope(
				campaign,
				lineItems,
				constructedNamesForLineItems(
						lineItems,
						bigQueryProperties.getAdjustmentsView(),
						BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME,
						BigQueryAdjustmentsViewColumns.CNB_UNIQUE_LINE_ITEM_ID));
	}

	/**
	 * Builds the conversions-mart scope for one visible campaign.
	 *
	 * <p>Conversions can exist at a different grain from delivery rows. Reading them through the delivery
	 * view would hide conversion-only constructed names, so the same line-item bridge is applied against
	 * the conversions view here.
	 *
	 * @param campaign the visible campaign
	 * @return the campaign conversions scope
	 */
	CampaignDeliveryScope forConversions(CampaignModel campaign) {
		BqRequest lineItems = lineItemsForCampaign(campaign.id());
		return new CampaignDeliveryScope(
				campaign,
				lineItems,
				constructedNamesForLineItems(
						lineItems,
						bigQueryProperties.getConversionsView(),
						BigQueryConversionsViewColumns.CONSTRUCTED_NAME,
						BigQueryConversionsViewColumns.CNB_UNIQUE_LINE_ITEM_ID));
	}

	/**
	 * Line items for one Hub campaign id.
	 *
	 * @param campaignId the NetSuite campaign id
	 * @return subquery selecting campaign id and line item id
	 */
	BqRequest lineItemsForCampaign(Long campaignId) {
		String predicate = campaignId == null ? "" : " AND " + BqSql.col(BigQueryIoLinesColumns.CAMPAIGN_ID)
				+ " = " + campaignId;
		return new BqRequest(lineItemsSql(predicate));
	}

	/**
	 * Line items for an optional agency/client scope.
	 *
	 * @param agencyIds agency ids, may be empty
	 * @param clientIds advertiser ids, may be empty
	 * @return subquery selecting campaign id and line item id
	 */
	BqRequest lineItemsForAgencyClients(List<Long> agencyIds, List<Long> clientIds) {
		StringBuilder predicate = new StringBuilder();
		if (agencyIds != null && !agencyIds.isEmpty()) {
			predicate.append(" AND ").append(BqSql.col(BigQueryIoLinesColumns.AGENCY_ID))
					.append(" IN (").append(numbers(agencyIds)).append(")");
		}
		if (clientIds != null && !clientIds.isEmpty()) {
			predicate.append(" AND ").append(BqSql.col(BigQueryIoLinesColumns.ADVERTISER_ID))
					.append(" IN (").append(numbers(clientIds)).append(")");
		}
		return new BqRequest(lineItemsSql(predicate.toString()));
	}

	/**
	 * Campaign ids whose line items map to exactly one real mart client equal to {@code clientName}.
	 *
	 * @param clientName the effective mart client name
	 * @param lineItems  line item scope
	 * @return subquery selecting campaign ids
	 */
	BqRequest campaignIdsForSingleRealClient(String clientName, BqRequest lineItems) {
		String cleaned = cleanClientName(clientName);
		if (cleaned == null) {
			return null;
		}
		return new BqRequest(singleRealClientCampaignsSql(lineItems,
				" AND MAX(" + realClientExpression() + ") = " + BqSql.literal(cleaned)));
	}

	/**
	 * Campaign ids whose line items map to exactly one real mart client.
	 *
	 * @param lineItems line item scope
	 * @return subquery selecting campaign ids
	 */
	BqRequest campaignIdsWithSingleRealClient(BqRequest lineItems) {
		return new BqRequest(singleRealClientCampaignsSql(lineItems, ""));
	}

	/**
	 * Constructed level-1 names corresponding to the supplied NetSuite line item ids.
	 *
	 * @param lineItems             subquery selecting line item ids
	 * @param viewName              mart view to inspect
	 * @param constructedNameColumn column holding the level-1 constructed name
	 * @param lineItemIdColumn      column holding the naming-convention line item id
	 * @return subquery selecting constructed names
	 */
	BqRequest constructedNamesForLineItems(
			BqRequest lineItems, String viewName, String constructedNameColumn, String lineItemIdColumn) {
		String constructedName = BqSql.col(constructedNameColumn);
		String sql = "SELECT DISTINCT " + constructedName
				+ " AS " + CONSTRUCTED_NAME_ALIAS
				+ " FROM " + BqSql.col(gateway.qualify(viewName))
				+ " WHERE " + BqSql.col(lineItemIdColumn)
				+ " IN (SELECT " + BqSql.col(LINE_ITEM_ID_ALIAS)
				+ " FROM (" + lineItems.sql() + "))"
				+ " AND " + constructedName + " IS NOT NULL"
				+ " AND TRIM(" + constructedName + ") != ''";
		return new BqRequest(sql);
	}

	String lineItemsSql(String extraPredicate) {
		return "SELECT DISTINCT "
				+ BqSql.col(BigQueryIoLinesColumns.CAMPAIGN_ID) + " AS " + CAMPAIGN_ID_ALIAS + ", "
				+ "CAST(" + BqSql.col(BigQueryIoLinesColumns.LINE_ITEM_ID) + " AS STRING) AS "
				+ LINE_ITEM_ID_ALIAS
				+ " FROM " + BqSql.col(gateway.table())
				+ " WHERE " + BqSql.col(BigQueryIoLinesColumns.CAMPAIGN_ID) + " IS NOT NULL"
				+ " AND " + BqSql.col(BigQueryIoLinesColumns.LINE_ITEM_ID) + " IS NOT NULL"
				+ extraPredicate;
	}

	/**
	 * Builds the campaign-id query for line-item scopes that map to exactly one real mart client.
	 *
	 * <p>{@code COUNT(DISTINCT)} expresses the required cardinality directly. {@code MAX} is safe once
	 * that count is one and avoids materializing and sorting an array for every campaign.
	 *
	 * @param lineItems        the scoped NetSuite line items
	 * @param additionalHaving an optional predicate on the sole client
	 * @return SQL selecting matching campaign ids
	 */
	String singleRealClientCampaignsSql(BqRequest lineItems, String additionalHaving) {
		String realClient = realClientExpression();
		return "SELECT scoped." + BqSql.col(CAMPAIGN_ID_ALIAS) + " AS " + CAMPAIGN_ID_ALIAS
				+ " FROM (" + lineItems.sql() + ") scoped"
				+ " LEFT JOIN " + BqSql.col(gateway.qualify(bigQueryProperties.getAdjustmentsView())) + " mart"
				+ " ON mart." + BqSql.col(BigQueryAdjustmentsViewColumns.CNB_UNIQUE_LINE_ITEM_ID)
				+ " = scoped." + BqSql.col(LINE_ITEM_ID_ALIAS)
				+ " GROUP BY scoped." + BqSql.col(CAMPAIGN_ID_ALIAS)
				+ " HAVING COUNT(DISTINCT " + realClient + ") = 1"
				+ additionalHaving;
	}

	/**
	 * Renders the normalized expression that turns blank and placeholder mart clients into {@code NULL}.
	 *
	 * @return the real-client SQL expression
	 */
	String realClientExpression() {
		String client = BqSql.col(BigQueryAdjustmentsViewColumns.CNB_CLIENT);
		return "IF("
				+ client + " IS NOT NULL"
				+ " AND TRIM(" + client + ") != ''"
				+ " AND " + BqSql.normalized(client) + " NOT IN (" + quotedPlaceholders() + "), "
				+ "TRIM(" + client + "), NULL)";
	}

	String quotedPlaceholders() {
		return CLIENT_NAME_PLACEHOLDERS.stream().map(BqSql::literal).collect(Collectors.joining(", "));
	}

	String numbers(List<Long> values) {
		return values.stream().map(String::valueOf).collect(Collectors.joining(", "));
	}

	String cleanClientName(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
		String normalized = value.trim().toLowerCase();
		return CLIENT_NAME_PLACEHOLDERS.contains(normalized) ? null : value.trim();
	}
}
