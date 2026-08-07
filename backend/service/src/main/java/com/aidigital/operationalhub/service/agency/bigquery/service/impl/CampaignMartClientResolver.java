package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.bigquery.model.AgencyClientKey;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqSql;
import com.aidigital.operationalhub.service.agency.bigquery.model.CampaignClient;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_CLIENT;

/**
 * Resolves effective client names from the delivery mart.
 *
 * <p>Campaign records come from IO-lines, where advertiser names can be missing or stale. Mart rows do
 * not reliably share the same campaign-name spelling as IO-lines, so every lookup here uses the same
 * bridge as reporting: IO-lines {@code line_item_id} to mart {@code CNB_unique_line_item_id}. A mart
 * client replaces the source value only when exactly one real client is found for that campaign; otherwise
 * the cleaned IO-lines value remains the fallback.
 */
@Component
@RequiredArgsConstructor
class CampaignMartClientResolver {

	private static final String CLIENT_WITHOUT_NAME = "Client without name";
	private static final List<String> CLIENT_NAME_PLACEHOLDERS = List.of("-", "null",
			CLIENT_WITHOUT_NAME.toLowerCase());

	private final BigQuerySearchGateway gateway;
	private final BigQueryProperties bigQueryProperties;

	/**
	 * Resolves a campaign identity for delivery/reporting mart reads.
	 *
	 * @param campaign the campaign resolved by visibility rules
	 * @return the campaign with the effective delivery mart client
	 */
	CampaignModel forAdjustmentsMart(CampaignModel campaign) {
		List<CampaignModel> resolved = forAdjustmentsMart(List.of(campaign));
		return resolved.isEmpty() ? campaign : resolved.getFirst();
	}

	/**
	 * Resolves campaign identities for delivery/reporting mart reads in one BigQuery lookup.
	 *
	 * @param campaigns the campaigns resolved by visibility rules
	 * @return the campaigns with effective delivery mart clients
	 */
	List<CampaignModel> forAdjustmentsMart(List<CampaignModel> campaigns) {
		return withPreferredMartClientsByLineItem(campaigns, bigQueryProperties.getAdjustmentsView());
	}

	/**
	 * Resolves missing embedded sidebar client names from the reporting mart in a batch.
	 *
	 * <p>The sidebar client tree is grouped by IO-lines {@code agency_id}/{@code advertiser_id}. Some
	 * advertisers are stored without a usable name there, while line items under the same pair map to
	 * usable mart {@code CNB_client} values. A name is returned only when every campaign under the key
	 * maps to the same non-placeholder mart client.
	 *
	 * @param keys the agency/client keys whose embedded names are missing
	 * @return agency/client key to unambiguous mart client name
	 */
	Map<AgencyClientKey, String> adjustmentsMartClientNamesForAgencyClients(List<AgencyClientKey> keys) {
		Map<AgencyClientKey, List<String>> names = adjustmentsMartClientNameSetsForAgencyClients(keys);
		Map<AgencyClientKey, String> result = new LinkedHashMap<>();
		for (Map.Entry<AgencyClientKey, List<String>> entry : names.entrySet()) {
			if (entry.getValue().size() == 1) {
				result.put(entry.getKey(), entry.getValue().get(0));
			}
		}
		return result;
	}

	/**
	 * Resolves embedded sidebar client names from the reporting mart, preserving every effective client
	 * found under an agency/client pair.
	 *
	 * <p>This is the split-aware counterpart of
	 * {@link #adjustmentsMartClientNamesForAgencyClients(List)}. It is used for rows such as
	 * {@code advertiser_id = 0}, where IO-lines stores one placeholder client id but the reporting mart
	 * contains several distinct {@code CNB_client} values behind different campaigns. Returning the full
	 * set lets the sidebar and agency client pages expose the same effective-client grain as the
	 * campaign/reporting pages.
	 *
	 * @param keys the agency/client keys whose embedded names are missing
	 * @return agency/client key to mart client names, in query order
	 */
	Map<AgencyClientKey, List<String>> adjustmentsMartClientNameSetsForAgencyClients(List<AgencyClientKey> keys) {
		Set<AgencyClientKey> requestedKeys = keys.stream()
				.filter(key -> key.agencyId() != null && key.clientId() != null)
				.collect(LinkedHashSet::new, Set::add, Set::addAll);
		if (requestedKeys.isEmpty()) {
			return Map.of();
		}
		Map<AgencyClientKey, Map<Long, Set<String>>> clientsByCampaign =
				adjustmentsMartClientNameSetsByAgencyClientCampaign(List.copyOf(requestedKeys));
		Map<AgencyClientKey, List<String>> result = new LinkedHashMap<>();
		for (Map.Entry<AgencyClientKey, Map<Long, Set<String>>> entry : clientsByCampaign.entrySet()) {
			Set<String> clientNames = new LinkedHashSet<>();
			boolean hasUnknownClient = false;
			for (Set<String> campaignClientNames : entry.getValue().values()) {
				if (campaignClientNames.size() == 1) {
					clientNames.add(campaignClientNames.iterator().next());
					continue;
				}
				hasUnknownClient = true;
			}
			if (hasUnknownClient) {
				clientNames.add(CLIENT_WITHOUT_NAME);
			}
			if (!clientNames.isEmpty()) {
				result.put(entry.getKey(), clientNames.stream().toList());
			}
		}
		return result;
	}

	/**
	 * Uses mart clients from one line-item lookup when each campaign has a unique mart client.
	 *
	 * @param campaigns the campaigns resolved by visibility rules
	 * @param viewName  the mart view to inspect
	 * @return the campaigns with effective clients
	 */
	List<CampaignModel> withPreferredMartClientsByLineItem(List<CampaignModel> campaigns, String viewName) {
		if (campaigns.isEmpty()) {
			return List.of();
		}
		Map<Long, Set<String>> clientsByCampaign = martClientNameSetsByCampaignId(
				campaigns.stream().map(CampaignModel::id).filter(Objects::nonNull).toList(), viewName);
		return campaigns.stream()
				.map(campaign -> withClientName(campaign, preferredClientName(campaign, clientsByCampaign)))
				.toList();
	}

	/**
	 * Chooses the one real mart client for a campaign, falling back to the cleaned source client when the
	 * mart has none or more than one.
	 *
	 * @param campaign          the campaign resolved by visibility rules
	 * @param clientsByCampaign campaign id to real mart clients
	 * @return the effective client name
	 */
	String preferredClientName(CampaignModel campaign, Map<Long, Set<String>> clientsByCampaign) {
		Set<String> clients = clientsByCampaign.get(campaign.id());
		if (clients != null && clients.size() == 1) {
			return clients.iterator().next();
		}
		return cleanClientName(campaign.clientName());
	}

	/**
	 * Finds real {@code CNB_client} values by campaign id with one line-item bridge query.
	 *
	 * @param campaignIds the campaign ids
	 * @param viewName    the BigQuery view to query
	 * @return campaign id to real mart client names
	 */
	Map<Long, Set<String>> martClientNameSetsByCampaignId(List<Long> campaignIds, String viewName) {
		List<Long> ids = campaignIds.stream().filter(Objects::nonNull).distinct().toList();
		if (ids.isEmpty()) {
			return Map.of();
		}
		BqRequest lineItems = lineItemsForCampaigns(ids);
		BqRequest request = martClientsByLineItemScope(viewName, lineItems);
		Map<Long, Set<String>> clientsByCampaign = new LinkedHashMap<>();
		for (CampaignClient row : gateway.fetchCached(request, this::toCampaignClient)) {
			Set<String> clients = clientsByCampaign.computeIfAbsent(
					row.campaignId(), ignored -> new LinkedHashSet<>());
			String client = cleanClientName(row.clientName());
			if (client != null) {
				clients.add(client);
			}
		}
		return clientsByCampaign;
	}

	/**
	 * Finds real mart clients per agency/client/campaign using the line-item bridge.
	 *
	 * @param keys agency/client keys to inspect
	 * @return agency/client key to campaign id to real client names
	 */
	Map<AgencyClientKey, Map<Long, Set<String>>> adjustmentsMartClientNameSetsByAgencyClientCampaign(
			List<AgencyClientKey> keys) {
		if (keys.isEmpty()) {
			return Map.of();
		}
		BqRequest lineItems = lineItemsForAgencyClients(keys);
		BqRequest request = martClientsByLineItemScope(bigQueryProperties.getAdjustmentsView(), lineItems);
		Map<AgencyClientKey, Map<Long, Set<String>>> result = new LinkedHashMap<>();
		for (CampaignClient row : gateway.fetchCached(request, this::toCampaignClient)) {
			AgencyClientKey key = row.key();
			if (key == null || row.campaignId() == null) {
				continue;
			}
			Set<String> clients = result.computeIfAbsent(key, ignored -> new LinkedHashMap<>())
					.computeIfAbsent(row.campaignId(), ignored -> new LinkedHashSet<>());
			String client = cleanClientName(row.clientName());
			if (client != null) {
				clients.add(client);
			}
		}
		return result;
	}

	/**
	 * Finds agency ids whose reporting mart client name matches a search term.
	 *
	 * @param term      the raw search term
	 * @param agencyIds optional visible agency ids; empty means unrestricted
	 * @return subquery selecting matching agency ids, or {@code null} for a blank term
	 */
	BqRequest agencyIdsForMartClientSearch(String term, List<Long> agencyIds) {
		if (isBlank(term)) {
			return null;
		}
		String sql = "SELECT DISTINCT " + BqSql.col(BigQueryIoLinesColumns.AGENCY_ID)
				+ " FROM (" + agencyClientRowsForMartClientSearch(agencyIds, term).sql() + ")";
		return new BqRequest(sql);
	}

	/**
	 * Finds agency/client rows whose reporting mart client name matches a search term.
	 *
	 * <p>The selected aliases intentionally match the IO-lines columns so callers can UNION this with
	 * an IO-lines advertiser search and then apply the same ranking/paging logic.
	 *
	 * @param agencyIds optional visible agency ids; empty means unrestricted
	 * @param term      the raw search term
	 * @return subquery selecting agency id, advertiser id and effective client name
	 */
	BqRequest agencyClientRowsForMartClientSearch(List<Long> agencyIds, String term) {
		BqRequest lineItems = lineItemsForAgencies(agencyIds == null ? List.of() : agencyIds);
		String client = "mart." + BqSql.col(CNB_CLIENT);
		String sql = "SELECT DISTINCT scoped." + BqSql.col(BigQueryIoLinesColumns.AGENCY_ID)
				+ " AS " + BigQueryIoLinesColumns.AGENCY_ID
				+ ", scoped." + BqSql.col(BigQueryIoLinesColumns.ADVERTISER_ID)
				+ " AS " + BigQueryIoLinesColumns.ADVERTISER_ID
				+ ", TRIM(" + client + ") AS " + BigQueryIoLinesColumns.ADVERTISER
				+ " FROM (" + lineItems.sql() + ") scoped"
				+ " JOIN " + BqSql.col(gateway.qualify(bigQueryProperties.getAdjustmentsView())) + " mart"
				+ " ON CAST(mart." + BqSql.col(BigQueryAdjustmentsViewColumns.CNB_UNIQUE_LINE_ITEM_ID)
				+ " AS STRING) = scoped." + BqSql.col(CampaignDeliveryScopeResolver.LINE_ITEM_ID_ALIAS)
				+ " WHERE scoped." + BqSql.col(BigQueryIoLinesColumns.AGENCY_ID) + " IS NOT NULL"
				+ " AND scoped." + BqSql.col(BigQueryIoLinesColumns.ADVERTISER_ID) + " IS NOT NULL"
				+ " AND " + realMartClientPredicate(client)
				+ " AND CONTAINS_SUBSTR(" + client + ", " + BqSql.literal(term) + ")";
		return new BqRequest(sql);
	}

	/**
	 * Builds an IO-lines subquery for campaign ids.
	 *
	 * @param campaignIds campaign ids
	 * @return line-item scope
	 */
	BqRequest lineItemsForCampaigns(List<Long> campaignIds) {
		return new BqRequest.Builder()
				.from(gateway.table())
				.distinct()
				.select(BigQueryIoLinesColumns.AGENCY_ID)
				.select(BigQueryIoLinesColumns.ADVERTISER_ID)
				.select(BigQueryIoLinesColumns.CAMPAIGN_ID, CampaignDeliveryScopeResolver.CAMPAIGN_ID_ALIAS)
				.selectExpression(
						"CAST(" + BqSql.col(BigQueryIoLinesColumns.LINE_ITEM_ID) + " AS STRING)",
						CampaignDeliveryScopeResolver.LINE_ITEM_ID_ALIAS)
				.whereIn(BigQueryIoLinesColumns.CAMPAIGN_ID, campaignIds)
				.whereNotNull(BigQueryIoLinesColumns.LINE_ITEM_ID)
				.build();
	}

	/**
	 * Builds an IO-lines line-item scope for agencies.
	 *
	 * @param agencyIds agency ids to restrict to; empty means unrestricted
	 * @return line-item scope including campaign and owning key ids
	 */
	BqRequest lineItemsForAgencies(List<Long> agencyIds) {
		BqRequest.Builder query = new BqRequest.Builder()
				.from(gateway.table())
				.distinct()
				.select(BigQueryIoLinesColumns.AGENCY_ID)
				.select(BigQueryIoLinesColumns.ADVERTISER_ID)
				.select(BigQueryIoLinesColumns.CAMPAIGN_ID, CampaignDeliveryScopeResolver.CAMPAIGN_ID_ALIAS)
				.selectExpression(
						"CAST(" + BqSql.col(BigQueryIoLinesColumns.LINE_ITEM_ID) + " AS STRING)",
						CampaignDeliveryScopeResolver.LINE_ITEM_ID_ALIAS)
				.whereNotNull(BigQueryIoLinesColumns.CAMPAIGN_ID)
				.whereNotNull(BigQueryIoLinesColumns.LINE_ITEM_ID);
		query.whereIn(BigQueryIoLinesColumns.AGENCY_ID, agencyIds == null ? List.of() : agencyIds);
		return query.build();
	}

	/**
	 * Builds an IO-lines subquery for agency/client keys.
	 *
	 * @param keys agency/client keys
	 * @return line-item scope including campaign and owning key ids
	 */
	BqRequest lineItemsForAgencyClients(List<AgencyClientKey> keys) {
		List<Long> agencyIds = keys.stream().map(AgencyClientKey::agencyId).distinct().toList();
		List<Long> clientIds = keys.stream().map(AgencyClientKey::clientId).distinct().toList();
		return new BqRequest.Builder()
				.from(gateway.table())
				.distinct()
				.select(BigQueryIoLinesColumns.AGENCY_ID)
				.select(BigQueryIoLinesColumns.ADVERTISER_ID)
				.select(BigQueryIoLinesColumns.CAMPAIGN_ID, CampaignDeliveryScopeResolver.CAMPAIGN_ID_ALIAS)
				.selectExpression(
						"CAST(" + BqSql.col(BigQueryIoLinesColumns.LINE_ITEM_ID) + " AS STRING)",
						CampaignDeliveryScopeResolver.LINE_ITEM_ID_ALIAS)
				.whereIn(BigQueryIoLinesColumns.AGENCY_ID, agencyIds)
				.whereIn(BigQueryIoLinesColumns.ADVERTISER_ID, clientIds)
				.whereNotNull(BigQueryIoLinesColumns.CAMPAIGN_ID)
				.whereNotNull(BigQueryIoLinesColumns.LINE_ITEM_ID)
				.build();
	}

	/**
	 * Builds a mart client lookup for an IO-lines line-item scope.
	 *
	 * @param viewName  the BigQuery view to query
	 * @param lineItems scope exposing campaign id and line item id
	 * @return client lookup query
	 */
	BqRequest martClientsByLineItemScope(String viewName, BqRequest lineItems) {
		String sql = "SELECT scoped." + BqSql.col(CampaignDeliveryScopeResolver.CAMPAIGN_ID_ALIAS)
				+ " AS " + CampaignDeliveryScopeResolver.CAMPAIGN_ID_ALIAS
				+ ", scoped." + BqSql.col(BigQueryIoLinesColumns.AGENCY_ID)
				+ " AS " + BigQueryIoLinesColumns.AGENCY_ID
				+ ", scoped." + BqSql.col(BigQueryIoLinesColumns.ADVERTISER_ID)
				+ " AS " + BigQueryIoLinesColumns.ADVERTISER_ID
				+ ", mart." + BqSql.col(CNB_CLIENT) + " AS " + CNB_CLIENT
				+ " FROM (" + lineItems.sql() + ") scoped"
				+ " LEFT JOIN " + BqSql.col(gateway.qualify(viewName)) + " mart"
				+ " ON CAST(mart." + BqSql.col(BigQueryAdjustmentsViewColumns.CNB_UNIQUE_LINE_ITEM_ID)
				+ " AS STRING) = scoped." + BqSql.col(CampaignDeliveryScopeResolver.LINE_ITEM_ID_ALIAS)
				+ " GROUP BY scoped." + BqSql.col(CampaignDeliveryScopeResolver.CAMPAIGN_ID_ALIAS)
				+ ", scoped." + BqSql.col(BigQueryIoLinesColumns.AGENCY_ID)
				+ ", scoped." + BqSql.col(BigQueryIoLinesColumns.ADVERTISER_ID)
				+ ", mart." + BqSql.col(CNB_CLIENT);
		return new BqRequest(sql);
	}

	/**
	 * Renders the predicate that excludes blank and placeholder mart client names.
	 *
	 * @param clientExpression the already-qualified mart client expression
	 * @return a SQL predicate for usable client names
	 */
	String realMartClientPredicate(String clientExpression) {
		String placeholders = CLIENT_NAME_PLACEHOLDERS.stream()
				.map(BqSql::literal)
				.collect(Collectors.joining(", "));
		return clientExpression + " IS NOT NULL"
				+ " AND TRIM(" + clientExpression + ") != ''"
				+ " AND " + BqSql.normalized(clientExpression) + " NOT IN (" + placeholders + ")";
	}

	/**
	 * Checks whether the requested client name means the fallback bucket for campaigns with no real mart
	 * client.
	 *
	 * @param clientName the requested client name
	 * @return whether the name is the UI fallback bucket
	 */
	boolean isUnknownClientName(String clientName) {
		return clientName != null && CLIENT_WITHOUT_NAME.equalsIgnoreCase(clientName.trim());
	}

	/**
	 * Maps one mart client lookup row.
	 *
	 * @param row the BigQuery row
	 * @return the campaign/client pair
	 */
	CampaignClient toCampaignClient(BqRow row) {
		return new CampaignClient(
				row.getLong(CampaignDeliveryScopeResolver.CAMPAIGN_ID_ALIAS),
				row.getLong(BigQueryIoLinesColumns.AGENCY_ID),
				row.getLong(BigQueryIoLinesColumns.ADVERTISER_ID),
				row.getString(CNB_CLIENT));
	}

	/**
	 * Normalizes client names that are missing or UI placeholders to {@code null}.
	 *
	 * @param value the raw client name
	 * @return a usable client name, or {@code null}
	 */
	String cleanClientName(String value) {
		if (isBlank(value)) {
			return null;
		}
		String trimmed = value.trim();
		if ("-".equals(trimmed) || "null".equalsIgnoreCase(trimmed) || CLIENT_WITHOUT_NAME.equalsIgnoreCase(trimmed)) {
			return null;
		}
		return trimmed;
	}

	/**
	 * Copies a campaign with a different client name while preserving its resolved identity.
	 *
	 * @param campaign   the source campaign
	 * @param clientName the effective client name, may be {@code null}
	 * @return the copied campaign
	 */
	CampaignModel withClientName(CampaignModel campaign, String clientName) {
		return new CampaignModel(
				campaign.id(), campaign.name(), campaign.clientId(), clientName,
				campaign.agencyId(), campaign.agencyName(), campaign.status(), campaign.startDate(),
				campaign.endDate(), campaign.budget(), campaign.channels(), campaign.industryVertical(),
				campaign.lineItemCount());
	}

	/**
	 * Checks whether a string cannot safely contribute to BigQuery scoping.
	 *
	 * @param value the value to inspect
	 * @return whether the value is null or blank
	 */
	boolean isBlank(String value) {
		return value == null || value.isBlank();
	}

}
