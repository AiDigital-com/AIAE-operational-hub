package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.bigquery.model.AgencyClientCampaign;
import com.aidigital.operationalhub.service.agency.bigquery.model.AgencyClientKey;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqSql;
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

import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_CAMPAIGN_NAME;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_CLIENT;

/**
 * Resolves the effective client name from the mart that will be queried for campaign data.
 *
 * <p>Campaign records come from the IO-lines source, where the advertiser can be missing or stale. Report
 * reads and conversion adjustment reads are scoped against mart {@code CNB_*} fields, so the mart is the
 * source of truth for {@code CNB_client}: when exactly one client exists for the campaign name, that value
 * wins over the campaign source. If the mart is empty or ambiguous, the campaign source is used only after
 * placeholders are stripped.
 */
@Component
@RequiredArgsConstructor
class CampaignMartClientResolver {

	private static final int SINGLE_VALUE_LIMIT = 2;
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
		return withPreferredMartClient(campaign, bigQueryProperties.getAdjustmentsView());
	}

	/**
	 * Resolves campaign identities for delivery/reporting mart reads in one BigQuery lookup.
	 *
	 * @param campaigns the campaigns resolved by visibility rules
	 * @return the campaigns with effective delivery mart clients
	 */
	List<CampaignModel> forAdjustmentsMart(List<CampaignModel> campaigns) {
		return withPreferredMartClients(campaigns, bigQueryProperties.getAdjustmentsView());
	}

	/**
	 * Resolves missing embedded sidebar client names from the reporting mart in a batch.
	 *
	 * <p>The sidebar client tree is grouped by IO-lines {@code agency_id}/{@code advertiser_id}. Some
	 * advertisers are stored without a usable name there, while the campaign rows under that same pair
	 * carry a usable mart {@code CNB_client}. This method first finds campaign names for the requested
	 * agency/client keys, then reuses the mart client lookup. A name is returned only when every matched
	 * campaign for the key points to the same non-placeholder mart client.
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
	 * contains several distinct {@code CNB_client} values. Returning the full set lets the sidebar and
	 * agency client pages expose the same effective-client grain as the campaign/reporting pages.
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
		List<Long> agencyIds = requestedKeys.stream()
				.map(AgencyClientKey::agencyId)
				.distinct()
				.toList();
		List<Long> clientIds = requestedKeys.stream()
				.map(AgencyClientKey::clientId)
				.distinct()
				.toList();
		BqRequest request = new BqRequest.Builder()
				.from(gateway.table())
				.distinct()
				.select(BigQueryIoLinesColumns.AGENCY_ID)
				.select(BigQueryIoLinesColumns.ADVERTISER_ID)
				.select(BigQueryIoLinesColumns.CAMPAIGN)
				.whereIn(BigQueryIoLinesColumns.AGENCY_ID, agencyIds)
				.whereIn(BigQueryIoLinesColumns.ADVERTISER_ID, clientIds)
				.whereNotNull(BigQueryIoLinesColumns.CAMPAIGN)
				.build();
		Map<AgencyClientKey, Set<String>> campaignsByKey = new LinkedHashMap<>();
		for (AgencyClientCampaign row : gateway.fetchCached(request, this::toAgencyClientCampaign)) {
			if (requestedKeys.contains(row.key()) && !isBlank(row.campaignName())) {
				campaignsByKey.computeIfAbsent(row.key(), ignored -> new LinkedHashSet<>()).add(row.campaignName());
			}
		}
		Map<String, Set<String>> clientsByCampaign = martClientNameSetsByCampaign(
				campaignsByKey.values().stream().flatMap(Set::stream).toList(),
				bigQueryProperties.getAdjustmentsView());
		Map<AgencyClientKey, List<String>> result = new LinkedHashMap<>();
		for (Map.Entry<AgencyClientKey, Set<String>> entry : campaignsByKey.entrySet()) {
			Set<String> clientNames = new LinkedHashSet<>();
			boolean hasUnknownClient = false;
			for (String campaignName : entry.getValue()) {
				Set<String> campaignClientNames = clientsByCampaign.get(campaignName);
				if (campaignClientNames != null && campaignClientNames.size() == 1) {
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
	 * Resolves a campaign identity for conversions mart reads.
	 *
	 * @param campaign the campaign resolved by visibility rules
	 * @return the campaign with the effective conversions mart client
	 */
	CampaignModel forConversionsMart(CampaignModel campaign) {
		return withPreferredMartClient(campaign, bigQueryProperties.getConversionsView());
	}

	/**
	 * Uses the mart client when it is unique, otherwise falls back to the cleaned campaign client.
	 *
	 * @param campaign the campaign resolved by visibility rules
	 * @param viewName  the mart view to inspect
	 * @return the campaign with the effective client, or no client when none is safe to apply
	 */
	CampaignModel withPreferredMartClient(CampaignModel campaign, String viewName) {
		String martClient = singleMartClientName(campaign.name(), viewName);
		return withClientName(
				campaign,
				martClient == null ? cleanClientName(campaign.clientName()) : martClient);
	}

	/**
	 * Uses mart clients from one lookup when each campaign has a unique mart client.
	 *
	 * @param campaigns the campaigns resolved by visibility rules
	 * @param viewName  the mart view to inspect
	 * @return the campaigns with effective clients
	 */
	List<CampaignModel> withPreferredMartClients(List<CampaignModel> campaigns, String viewName) {
		if (campaigns.isEmpty()) {
			return List.of();
		}
		Map<String, String> martClients = singleMartClientNames(
				campaigns.stream().map(CampaignModel::name).toList(), viewName);
		return campaigns.stream()
				.map(campaign -> withClientName(
						campaign,
						martClients.getOrDefault(campaign.name(), cleanClientName(campaign.clientName()))))
				.toList();
	}

	/**
	 * Finds the single {@code CNB_client} the given mart has for this campaign name.
	 *
	 * @param campaignName the campaign name
	 * @param viewName     the BigQuery view to query
	 * @return the one client name, or {@code null} when absent or ambiguous
	 */
	String singleMartClientName(String campaignName, String viewName) {
		if (isBlank(campaignName)) {
			return null;
		}
		BqRequest request = new BqRequest.Builder()
				.from(gateway.qualify(viewName))
				.distinct()
				.select(CNB_CLIENT)
				.whereEquals(CNB_CAMPAIGN_NAME, campaignName)
				.whereNotNull(CNB_CLIENT)
				.orderBy(BqSql.col(CNB_CLIENT))
				.limitOffset(SINGLE_VALUE_LIMIT, 0)
				.build();
		List<String> clients = gateway.fetchCached(request, row -> cleanClientName(row.getString(CNB_CLIENT)))
				.stream()
				.filter(Objects::nonNull)
				.distinct()
				.toList();
		return clients.size() == 1 ? clients.get(0) : null;
	}

	/**
	 * Finds unambiguous {@code CNB_client} values for several campaign names with one BigQuery read.
	 *
	 * @param campaignNames the campaign names
	 * @param viewName      the BigQuery view to query
	 * @return campaign name to single client name, omitting absent or ambiguous campaigns
	 */
	Map<String, String> singleMartClientNames(List<String> campaignNames, String viewName) {
		Map<String, Set<String>> clientsByCampaign = martClientNameSetsByCampaign(campaignNames, viewName);
		Map<String, String> result = new LinkedHashMap<>();
		for (Map.Entry<String, Set<String>> entry : clientsByCampaign.entrySet()) {
			if (entry.getValue().size() == 1) {
				result.put(entry.getKey(), entry.getValue().iterator().next());
			}
		}
		return result;
	}

	/**
	 * Finds real {@code CNB_client} values for several campaign names with one BigQuery read.
	 *
	 * <p>A campaign with only placeholder mart clients is deliberately present in the returned map with
	 * an empty set, so callers can distinguish "mart says unknown" from "no mart row at all".
	 *
	 * @param campaignNames the campaign names
	 * @param viewName      the BigQuery view to query
	 * @return campaign name to real mart client names, empty set when only placeholders were found
	 */
	Map<String, Set<String>> martClientNameSetsByCampaign(List<String> campaignNames, String viewName) {
		List<String> names = campaignNames.stream()
				.filter(name -> !isBlank(name))
				.distinct()
				.toList();
		if (names.isEmpty()) {
			return Map.of();
		}
		BqRequest request = new BqRequest.Builder()
				.from(gateway.qualify(viewName))
				.select(CNB_CAMPAIGN_NAME)
				.select(CNB_CLIENT)
				.whereInStrings(CNB_CAMPAIGN_NAME, names)
				.whereNotNull(CNB_CLIENT)
				.groupBy(CNB_CAMPAIGN_NAME)
				.groupBy(CNB_CLIENT)
				.build();
		Map<String, Set<String>> clientsByCampaign = new LinkedHashMap<>();
		for (CampaignClient row : gateway.fetchCached(request, this::toCampaignClient)) {
			if (!isBlank(row.campaignName())) {
				Set<String> clients =
						clientsByCampaign.computeIfAbsent(row.campaignName(), ignored -> new LinkedHashSet<>());
				String client = cleanClientName(row.clientName());
				if (client != null) {
					clients.add(client);
				}
			}
		}
		return clientsByCampaign;
	}

	/**
	 * Builds a mart subquery returning campaign names that belong to the given effective client.
	 *
	 * @param clientName the effective {@code CNB_client} name to match
	 * @return a subquery selecting {@code CNB_campaign_name}, or {@code null} for a blank/placeholder name
	 */
	BqRequest adjustmentsCampaignNamesForClient(String clientName) {
		return adjustmentsCampaignNamesForClient(clientName, null);
	}

	/**
	 * Builds a mart subquery returning campaign names that belong to the given effective client.
	 *
	 * @param clientName        the effective {@code CNB_client} name to match
	 * @param campaignNameScope optional IO-lines subquery limiting candidate campaign names
	 * @return a subquery selecting {@code CNB_campaign_name}, or {@code null} for a blank/placeholder name
	 */
	BqRequest adjustmentsCampaignNamesForClient(String clientName, BqRequest campaignNameScope) {
		String cleaned = cleanClientName(clientName);
		if (cleaned == null) {
			return null;
		}
		String sql = "SELECT " + BqSql.col(CNB_CAMPAIGN_NAME) + " AS " + CNB_CAMPAIGN_NAME
				+ " FROM (" + singleRealClientCampaignsSql(campaignNameScope) + ")"
				+ " WHERE ARRAY_LENGTH(real_clients) = 1"
				+ " AND real_clients[OFFSET(0)] = " + BqSql.literal(cleaned);
		return new BqRequest(sql);
	}

	/**
	 * Builds a mart subquery returning campaigns with exactly one real, non-placeholder client.
	 *
	 * @return a subquery selecting {@code CNB_campaign_name}
	 */
	BqRequest adjustmentsCampaignNamesWithRealClient() {
		return adjustmentsCampaignNamesWithRealClient(null);
	}

	/**
	 * Builds a mart subquery returning campaigns with exactly one real, non-placeholder client.
	 *
	 * @param campaignNameScope optional IO-lines subquery limiting candidate campaign names
	 * @return a subquery selecting {@code CNB_campaign_name}
	 */
	BqRequest adjustmentsCampaignNamesWithRealClient(BqRequest campaignNameScope) {
		String sql = "SELECT " + BqSql.col(CNB_CAMPAIGN_NAME) + " AS " + CNB_CAMPAIGN_NAME
				+ " FROM (" + singleRealClientCampaignsSql(campaignNameScope) + ")"
				+ " WHERE ARRAY_LENGTH(real_clients) = 1";
		return new BqRequest(sql);
	}

	private String singleRealClientCampaignsSql(BqRequest campaignNameScope) {
		String client = BqSql.col(CNB_CLIENT);
		String realClientExpression = "IF("
				+ client + " IS NOT NULL"
				+ " AND TRIM(" + client + ") != ''"
				+ " AND " + BqSql.normalized(client)
				+ " NOT IN (" + quotedPlaceholders() + "), "
				+ "TRIM(" + client + "), NULL)";
		return "SELECT " + BqSql.col(CNB_CAMPAIGN_NAME) + " AS " + CNB_CAMPAIGN_NAME
				+ ", ARRAY_AGG(DISTINCT " + realClientExpression + " IGNORE NULLS ORDER BY "
				+ realClientExpression + ") AS real_clients"
				+ " FROM " + BqSql.col(gateway.qualify(bigQueryProperties.getAdjustmentsView()))
				+ " WHERE " + BqSql.col(CNB_CAMPAIGN_NAME) + " IS NOT NULL"
				+ campaignNameScopePredicate(campaignNameScope)
				+ " GROUP BY " + BqSql.col(CNB_CAMPAIGN_NAME);
	}

	private String campaignNameScopePredicate(BqRequest campaignNameScope) {
		if (campaignNameScope == null || campaignNameScope.sql() == null || campaignNameScope.sql().isBlank()) {
			return "";
		}
		return " AND " + BqSql.col(CNB_CAMPAIGN_NAME)
				+ " IN (SELECT " + BqSql.col(BigQueryIoLinesColumns.CAMPAIGN)
				+ " FROM (" + campaignNameScope.sql() + "))";
	}

	private String quotedPlaceholders() {
		return CLIENT_NAME_PLACEHOLDERS.stream()
				.map(BqSql::literal)
				.collect(java.util.stream.Collectors.joining(", "));
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
		return new CampaignClient(row.getString(CNB_CAMPAIGN_NAME), row.getString(CNB_CLIENT));
	}

	/**
	 * Maps one IO-lines campaign row used to bridge embedded agency/client rows to mart clients.
	 *
	 * @param row the BigQuery row
	 * @return the agency/client key with one campaign name
	 */
	AgencyClientCampaign toAgencyClientCampaign(BqRow row) {
		return new AgencyClientCampaign(
				new AgencyClientKey(
						row.getLong(BigQueryIoLinesColumns.AGENCY_ID),
						row.getLong(BigQueryIoLinesColumns.ADVERTISER_ID)),
				row.getString(BigQueryIoLinesColumns.CAMPAIGN));
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

	/**
	 * One campaign/client pair from a mart lookup.
	 *
	 * @param campaignName the campaign name
	 * @param clientName   the client name
	 */
	record CampaignClient(String campaignName, String clientName) {

	}
}
