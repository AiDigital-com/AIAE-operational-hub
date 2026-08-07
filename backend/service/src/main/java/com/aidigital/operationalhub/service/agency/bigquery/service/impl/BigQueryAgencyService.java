package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.AgencyService;
import com.aidigital.operationalhub.service.agency.bigquery.model.AgencyClientKey;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqPage;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqSql;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.model.AgencyClientRefModel;
import com.aidigital.operationalhub.service.agency.model.AgencyModel;
import com.aidigital.operationalhub.service.agency.search.AgencyField;
import com.aidigital.operationalhub.service.common.search.FilterCriterion;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import com.aidigital.operationalhub.service.rbac.AgencyVisibilityService;
import com.aidigital.operationalhub.service.rbac.model.AgencyVisibility;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * BigQuery-backed implementation of {@link AgencyService}.
 *
 * <p>Agencies are distinct {@code agency_id} groups of the IO Lines table. Filtering, sorting, and
 * paging run in BigQuery: a {@link BqRequest} count query yields the total and the matching paged
 * query returns one page. The IO Lines source carries no agency email or lifecycle status, so
 * {@code email} is {@code null} and {@code status} is reported as {@code ACTIVE} for every row.
 */
@Service
@RequiredArgsConstructor
public class BigQueryAgencyService implements AgencyService {

	private static final String ACTIVE_STATUS = "ACTIVE";

	private static final String AGENCY_ID = BigQueryIoLinesColumns.AGENCY_ID;
	private static final String AGENCY = BigQueryIoLinesColumns.AGENCY;
	private static final String ADVERTISER_ID = BigQueryIoLinesColumns.ADVERTISER_ID;
	private static final String ADVERTISER = BigQueryIoLinesColumns.ADVERTISER;

	private static final String ALIAS_ID = "id";
	private static final String ALIAS_NAME = "name";
	private static final String ALIAS_CLIENTS_COUNT = "clients_count";
	private static final String ALIAS_AGENCY_ID = "agency_id";
	private static final String ALIAS_RANK = "rn";
	private static final String BEST_ADVERTISER_NAME = "ARRAY_AGG(NULLIF(TRIM("
			+ BqSql.col(ADVERTISER)
			+ "), '') IGNORE NULLS ORDER BY LOWER(NULLIF(TRIM("
			+ BqSql.col(ADVERTISER)
			+ "), '')) LIMIT 1)[SAFE_OFFSET(0)]";

	/**
	 * Maximum number of clients embedded per agency when {@code includeClients} is requested. Kept in
	 * sync with the clients page size (16) so the embedded list matches the first page of the agency's
	 * clients detail view and the frontend can seed that page from it without a follow-up request.
	 */
	private static final int EMBEDDED_CLIENTS_LIMIT = 16;

	private final BigQuerySearchGateway gateway;
	private final AgencyVisibilityService agencyVisibilityService;
	private final CampaignMartClientResolver clientResolver;

	@Override
	public Page<AgencyModel> searchAgencies(
			CurrentUserModel user,
			SearchCriteria<AgencyField> criteria,
			String search,
			boolean includeClients) {
		AgencyVisibility visibility = agencyVisibilityService.resolveForCurrentUser(user);
		if (visibility.seesNothing()) {
			return emptyPage(criteria);
		}
		BqRequest.Builder query = new BqRequest.Builder()
				.from(gateway.table())
				.select(AGENCY_ID, ALIAS_ID)
				.selectAnyValue(AGENCY, ALIAS_NAME)
				.selectCountDistinct(ADVERTISER_ID, ALIAS_CLIENTS_COUNT)
				.withTotalCount(AGENCY_ID)
				.countDistinct(AGENCY_ID)
				.whereNotNull(AGENCY_ID)
				.whereIn(AGENCY_ID, visibility.agencyIds())
				.groupBy(AGENCY_ID)
				.orderBy(sortExpression(criteria.sort()))
				.sortBy(criteria.sort())
				.page(criteria.pageNumber(), criteria.pageSize());
		applyFilters(query, criteria.filters());

		String normalizedSearch = search == null ? "" : search.trim();
		String searchMatchLower = null;
		if (!normalizedSearch.isEmpty()) {
			searchMatchLower = normalizedSearch.toLowerCase();
			BqRequest clientMatchSubquery = new BqRequest.Builder()
					.from(gateway.table())
					.distinct()
					.select(AGENCY_ID)
					.whereNotNull(ADVERTISER_ID)
					.whereIn(AGENCY_ID, visibility.agencyIds())
					.whereContainsSubstr(ADVERTISER, normalizedSearch)
					.build();
			query.whereContainsSubstrOrInSubquery(AGENCY, normalizedSearch, AGENCY_ID, clientMatchSubquery);
		}

		BqPage<AgencyModel> result =
				gateway.fetchPage(query.build(), query::buildCount, criteria.pageNumber(), this::toAgency);
		Page<AgencyModel> page = new PageImpl<>(
				result.content(), PageRequest.of(criteria.pageNumber() - 1, criteria.pageSize()), result.total());
		return includeClients ? attachClients(page, searchMatchLower) : page;
	}

	/**
	 * An empty page for a user whose RBAC scope grants access to no agency; no BigQuery query is run.
	 *
	 * @param criteria the search criteria carrying the requested paging
	 * @return an empty page with zero total
	 */
	Page<AgencyModel> emptyPage(SearchCriteria<AgencyField> criteria) {
		return new PageImpl<>(List.of(), PageRequest.of(criteria.pageNumber() - 1, criteria.pageSize()), 0);
	}

	/**
	 * Adds the agency filters as SQL predicates. Email, status, and client count are not filterable in
	 * the IO Lines source.
	 *
	 * @param query   the query builder
	 * @param filters the active filters, may be {@code null}
	 */
	void applyFilters(BqRequest.Builder query, List<FilterCriterion<AgencyField>> filters) {
		if (filters == null) {
			return;
		}
		for (FilterCriterion<AgencyField> filter : filters) {
			switch (filter.field()) {
				case NAME -> query.filter(AGENCY, false, filter);
				case ID -> query.filter(AGENCY_ID, true, filter);
				default -> { /* email, status, client count are not filterable in the IO Lines source */ }
			}
		}
	}

	/**
	 * Resolves the {@code ORDER BY} expression for the requested sort field, defaulting to name.
	 *
	 * @param sort the sort directive, may be {@code null}
	 * @return the order-by expression
	 */
	String sortExpression(SortCriterion<AgencyField> sort) {
		AgencyField field = sort == null ? null : sort.field();
		if (field == null) {
			return BqSql.lowerAnyValue(AGENCY);
		}
		return switch (field) {
			case ID -> BqSql.col(AGENCY_ID);
			case CLIENTS_COUNT -> BqSql.countDistinct(ADVERTISER_ID);
			case NAME, EMAIL, STATUS -> BqSql.lowerAnyValue(AGENCY);
		};
	}

	/**
	 * Maps a result row into an {@link AgencyModel}.
	 *
	 * @param row the result row
	 * @return the agency model
	 */
	AgencyModel toAgency(BqRow row) {
		return new AgencyModel(
				row.getLong(ALIAS_ID),
				row.getString(ALIAS_NAME),
				null,
				ACTIVE_STATUS,
				row.getLong(ALIAS_CLIENTS_COUNT),
				null);
	}

	/**
	 * Populates each agency on the page with its clients (id and name), loaded in a single query
	 * scoped to just the page's agency ids. The agencies keep their order and the page's total/paging
	 * metadata are preserved.
	 *
	 * <p>When {@code searchMatchLower} is non-null (a global search is active), agencies whose own
	 * name matches the term still receive their first page of clients, while agencies that only
	 * matched via a client receive only the clients whose names match the term (loaded in a separate
	 * query capped at {@link #EMBEDDED_CLIENTS_LIMIT} per agency).
	 *
	 * @param page             the page of agencies (without clients)
	 * @param searchMatchLower the lower-cased global search term, or {@code null} when search is off
	 * @return a page whose agencies carry their client lists
	 */
	Page<AgencyModel> attachClients(Page<AgencyModel> page, String searchMatchLower) {
		if (searchMatchLower == null) {
			return attachClients(page);
		}
		List<Long> nameMatchedAgencyIds = new ArrayList<>();
		List<Long> clientOnlyMatchedAgencyIds = new ArrayList<>();
		for (AgencyModel agency : page.getContent()) {
			if (agency.id() == null) {
				continue;
			}
			if (agency.name() != null && agency.name().toLowerCase().contains(searchMatchLower)) {
				nameMatchedAgencyIds.add(agency.id());
			} else {
				clientOnlyMatchedAgencyIds.add(agency.id());
			}
		}
		Map<Long, List<AgencyClientRefModel>> clientsByAgency = new LinkedHashMap<>();
		clientsByAgency.putAll(loadClientsByAgency(nameMatchedAgencyIds));
		clientsByAgency.putAll(loadMatchingClientsByAgency(clientOnlyMatchedAgencyIds, searchMatchLower));
		List<AgencyModel> withClients = page.getContent().stream()
				.map(agency -> new AgencyModel(
						agency.id(),
						agency.name(),
						agency.email(),
						agency.status(),
						agency.clientsCount(),
						clientsByAgency.getOrDefault(agency.id(), List.of())))
				.toList();
		return new PageImpl<>(withClients, page.getPageable(), page.getTotalElements());
	}

	/**
	 * Backwards-compatible entry point (no active global search) — see
	 * {@link #attachClients(Page, String)}.
	 *
	 * @param page the page of agencies (without clients)
	 * @return a page whose agencies carry their client lists
	 */
	Page<AgencyModel> attachClients(Page<AgencyModel> page) {
		List<Long> agencyIds = page.getContent().stream()
				.map(AgencyModel::id)
				.filter(Objects::nonNull)
				.toList();
		Map<Long, List<AgencyClientRefModel>> clientsByAgency = loadClientsByAgency(agencyIds);
		List<AgencyModel> withClients = page.getContent().stream()
				.map(agency -> new AgencyModel(
						agency.id(),
						agency.name(),
						agency.email(),
						agency.status(),
						agency.clientsCount(),
						clientsByAgency.getOrDefault(agency.id(), List.of())))
				.toList();
		return new PageImpl<>(withClients, page.getPageable(), page.getTotalElements());
	}

	/**
	 * Loads the clients (advertisers) for the given agency ids whose name matches the search term
	 * (case-insensitive {@code CONTAINS}), grouped by agency id ordered by client name and capped at
	 * {@link #EMBEDDED_CLIENTS_LIMIT} per agency by BigQuery itself. Used when the global search term
	 * matched a client name under an agency whose own name did not match, so the sidebar only renders
	 * the matching client sub-rows.
	 *
	 * @param agencyIds        the agency ids to load matching clients for
	 * @param searchMatchLower the lower-cased search term
	 * @return matching clients grouped by agency id, never {@code null}
	 */
	Map<Long, List<AgencyClientRefModel>> loadMatchingClientsByAgency(
			List<Long> agencyIds, String searchMatchLower) {
		if (agencyIds.isEmpty()) {
			return Map.of();
		}
		BqRequest distinctRows = new BqRequest.Builder()
				.from(gateway.table())
				.select(AGENCY_ID)
				.select(ADVERTISER_ID)
				.selectExpression(BEST_ADVERTISER_NAME, ADVERTISER)
				.whereIn(AGENCY_ID, agencyIds)
				.whereNotNull(ADVERTISER_ID)
				.whereContainsSubstr(ADVERTISER, searchMatchLower)
				.groupBy(AGENCY_ID)
				.groupBy(ADVERTISER_ID)
				.build();
		BqRequest ranked = new BqRequest.Builder()
				.from(distinctRows)
				.select(AGENCY_ID, ALIAS_AGENCY_ID)
				.select(ADVERTISER_ID, ALIAS_ID)
				.select(ADVERTISER, ALIAS_NAME)
				.selectRowNumber(AGENCY_ID, BqSql.lower(ADVERTISER), ALIAS_RANK)
				.build();
		BqRequest request = new BqRequest.Builder()
				.from(ranked)
				.select(ALIAS_AGENCY_ID)
				.select(ALIAS_ID)
				.select(ALIAS_NAME)
				.whereLessThanOrEqual(ALIAS_RANK, EMBEDDED_CLIENTS_LIMIT)
				.orderBy(BqSql.lower(ALIAS_NAME))
				.sortBy(null)
				.build();
		Map<Long, List<AgencyClientRefModel>> result = new LinkedHashMap<>();
		for (AgencyClientRow row : enrichClientRows(gateway.fetch(request, this::toClientRow))) {
			if (row.agencyId() == null) {
				continue;
			}
			result.computeIfAbsent(row.agencyId(), key -> new ArrayList<>()).add(row.client());
		}
		return result;
	}

	/**
	 * Loads the clients (advertisers) for the given agency ids, grouped by agency id, each list already
	 * ordered by name ascending and capped at {@link #EMBEDDED_CLIENTS_LIMIT} by BigQuery itself, rather
	 * than transferred in full and truncated in Java.
	 *
	 * @param agencyIds the agency ids to load clients for
	 * @return clients grouped by agency id, never {@code null}
	 */
	Map<Long, List<AgencyClientRefModel>> loadClientsByAgency(List<Long> agencyIds) {
		if (agencyIds.isEmpty()) {
			return Map.of();
		}
		BqRequest distinctRows = new BqRequest.Builder()
				.from(gateway.table())
				.select(AGENCY_ID)
				.select(ADVERTISER_ID)
				.selectExpression(BEST_ADVERTISER_NAME, ADVERTISER)
				.whereIn(AGENCY_ID, agencyIds)
				.whereNotNull(ADVERTISER_ID)
				.groupBy(AGENCY_ID)
				.groupBy(ADVERTISER_ID)
				.build();
		BqRequest ranked = new BqRequest.Builder()
				.from(distinctRows)
				.select(AGENCY_ID, ALIAS_AGENCY_ID)
				.select(ADVERTISER_ID, ALIAS_ID)
				.select(ADVERTISER, ALIAS_NAME)
				.selectRowNumber(AGENCY_ID, BqSql.lower(ADVERTISER), ALIAS_RANK)
				.build();
		BqRequest request = new BqRequest.Builder()
				.from(ranked)
				.select(ALIAS_AGENCY_ID)
				.select(ALIAS_ID)
				.select(ALIAS_NAME)
				.whereLessThanOrEqual(ALIAS_RANK, EMBEDDED_CLIENTS_LIMIT)
				.build();
		Map<Long, List<AgencyClientRefModel>> result = new LinkedHashMap<>();
		for (AgencyClientRow row : enrichClientRows(gateway.fetch(request, this::toClientRow))) {
			if (row.agencyId() == null) {
				continue;
			}
			result.computeIfAbsent(row.agencyId(), key -> new ArrayList<>()).add(row.client());
		}
		return result;
	}

	/**
	 * Replaces or splits missing embedded client names with mart client names.
	 *
	 * <p>The sidebar client rows are still keyed by IO-lines advertiser id, but blank or placeholder
	 * advertiser names make the UI show {@code Client without name}. For those rows, the resolver looks
	 * through campaigns under the same agency/client pair and returns the reporting mart's
	 * {@code CNB_client} values. One mart client replaces the row; several mart clients split the row so
	 * navigation uses the same effective-client grain as the campaign/reporting pages.
	 *
	 * @param rows the embedded client rows loaded from IO-lines
	 * @return rows with missing client names enriched or split where possible
	 */
	List<AgencyClientRow> enrichClientRows(List<AgencyClientRow> rows) {
		LinkedHashSet<AgencyClientKey> keys = rows.stream()
				.filter(this::needsClientName)
				.map(row -> new AgencyClientKey(row.agencyId(), row.client().id()))
				.collect(LinkedHashSet::new, LinkedHashSet::add, LinkedHashSet::addAll);
		if (keys.isEmpty()) {
			return rows;
		}
		Map<AgencyClientKey, List<String>> names =
				clientResolver.adjustmentsMartClientNameSetsForAgencyClients(List.copyOf(keys));
		if (names.isEmpty()) {
			return rows;
		}
		return rows.stream()
				.flatMap(row -> splitClientRow(row, names.get(new AgencyClientKey(row.agencyId(), row.client().id())))
						.stream())
				.toList();
	}

	/**
	 * Splits one placeholder client row by effective mart client names.
	 *
	 * @param row         the source client row
	 * @param clientNames the resolved mart client names for the row's agency/client pair
	 * @return one row per mart client, or the source row when no mart client was resolved
	 */
	List<AgencyClientRow> splitClientRow(AgencyClientRow row, List<String> clientNames) {
		if (clientNames == null || clientNames.isEmpty()) {
			return List.of(row);
		}
		return clientNames.stream()
				.map(clientName -> withClientName(row, clientName))
				.toList();
	}

	/**
	 * Checks whether an embedded client row needs mart-name enrichment.
	 *
	 * @param row the embedded client row
	 * @return whether the row has ids but no usable client name
	 */
	boolean needsClientName(AgencyClientRow row) {
		return row.agencyId() != null
				&& row.client() != null
				&& row.client().id() != null
				&& clientResolver.cleanClientName(row.client().name()) == null;
	}

	/**
	 * Copies a client row with a replacement name when one was resolved.
	 *
	 * @param row        the source row
	 * @param clientName the resolved client name, or {@code null} to keep the source unchanged
	 * @return the source row or a row with the resolved client name
	 */
	AgencyClientRow withClientName(AgencyClientRow row, String clientName) {
		if (clientName == null) {
			return row;
		}
		return new AgencyClientRow(
				row.agencyId(),
				new AgencyClientRefModel(row.client().id(), clientName));
	}

	/**
	 * Maps a result row into an agency-scoped client reference.
	 *
	 * @param row the result row
	 * @return the agency id paired with the client reference
	 */
	AgencyClientRow toClientRow(BqRow row) {
		return new AgencyClientRow(
				row.getLong(ALIAS_AGENCY_ID),
				new AgencyClientRefModel(row.getLong(ALIAS_ID), row.getString(ALIAS_NAME)));
	}

	/**
	 * A client reference together with the id of the agency it belongs to.
	 *
	 * @param agencyId the owning agency id
	 * @param client   the client reference
	 */
	record AgencyClientRow(Long agencyId, AgencyClientRefModel client) {

	}
}
