package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.ClientService;
import com.aidigital.operationalhub.service.agency.bigquery.model.AgencyClientKey;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqPage;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqSql;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.model.ClientModel;
import com.aidigital.operationalhub.service.agency.search.ClientField;
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

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * BigQuery-backed implementation of {@link ClientService}.
 *
 * <p>Clients (advertisers) are distinct {@code advertiser_id} groups of the IO Lines table.
 * Filtering, sorting, and paging run in BigQuery via a {@link BqRequest} count query and the matching
 * paged query. The IO Lines source carries no client email or lifecycle status, so {@code email} is
 * {@code null} and {@code status} is reported as {@code ACTIVE} for every row.
 */
@Service
@RequiredArgsConstructor
public class BigQueryClientService implements ClientService {

	private static final String ACTIVE_STATUS = "ACTIVE";

	private static final String ADVERTISER_ID = BigQueryIoLinesColumns.ADVERTISER_ID;
	private static final String ADVERTISER = BigQueryIoLinesColumns.ADVERTISER;
	private static final String AGENCY_ID = BigQueryIoLinesColumns.AGENCY_ID;

	private static final String ALIAS_ID = "id";
	private static final String ALIAS_NAME = "name";
	private static final String ALIAS_AGENCY_ID = "agency_id";
	private static final String BEST_ADVERTISER_NAME = "ARRAY_AGG(NULLIF(TRIM("
			+ BqSql.col(ADVERTISER)
			+ "), '') IGNORE NULLS ORDER BY LOWER(NULLIF(TRIM("
			+ BqSql.col(ADVERTISER)
			+ "), '')) LIMIT 1)[SAFE_OFFSET(0)]";

	private final BigQuerySearchGateway gateway;
	private final AgencyVisibilityService agencyVisibilityService;
	private final CampaignMartClientResolver clientResolver;

	@Override
	public Page<ClientModel> searchClients(CurrentUserModel user, SearchCriteria<ClientField> criteria) {
		AgencyVisibility visibility = agencyVisibilityService.resolveForCurrentUser(user);
		if (visibility.seesNothing()) {
			return new PageImpl<>(List.of(), PageRequest.of(criteria.pageNumber() - 1, criteria.pageSize()), 0);
		}
		BqRequest.Builder query = new BqRequest.Builder()
				.from(gateway.table())
				.select(ADVERTISER_ID, ALIAS_ID)
				.selectExpression(BEST_ADVERTISER_NAME, ALIAS_NAME)
				.selectAnyValue(AGENCY_ID, ALIAS_AGENCY_ID)
				.withTotalCount(ADVERTISER_ID)
				.countDistinct(ADVERTISER_ID)
				.whereNotNull(ADVERTISER_ID)
				.whereIn(AGENCY_ID, visibility.agencyIds())
				.groupBy(ADVERTISER_ID)
				.orderBy(sortExpression(criteria.sort()))
				.sortBy(criteria.sort())
				.page(criteria.pageNumber(), criteria.pageSize());
		applyFilters(query, criteria.filters());

		BqPage<ClientModel> result =
				gateway.fetchPage(query.build(), query::buildCount, criteria.pageNumber(), this::toClient);
		List<ClientModel> content = enrichClients(result.content());
		return new PageImpl<>(
				content, PageRequest.of(criteria.pageNumber() - 1, criteria.pageSize()), result.total());
	}

	/**
	 * Adds the client filters as SQL predicates. Email and status are not filterable in the IO Lines
	 * source.
	 *
	 * @param query   the query builder
	 * @param filters the active filters, may be {@code null}
	 */
	void applyFilters(BqRequest.Builder query, List<FilterCriterion<ClientField>> filters) {
		if (filters == null) {
			return;
		}
		for (FilterCriterion<ClientField> filter : filters) {
			switch (filter.field()) {
				case NAME -> query.filter(ADVERTISER, false, filter);
				case ID -> query.filter(ADVERTISER_ID, true, filter);
				case AGENCY_ID -> query.filter(AGENCY_ID, true, filter);
				default -> { /* email and status are not filterable in the IO Lines source */ }
			}
		}
	}

	/**
	 * Resolves the {@code ORDER BY} expression for the requested sort field, defaulting to name.
	 *
	 * @param sort the sort directive, may be {@code null}
	 * @return the order-by expression
	 */
	String sortExpression(SortCriterion<ClientField> sort) {
		ClientField field = sort == null ? null : sort.field();
		if (field == null) {
			return BqSql.lowerAnyValue(ADVERTISER);
		}
		return switch (field) {
			case ID -> BqSql.col(ADVERTISER_ID);
			case AGENCY_ID -> BqSql.anyValue(AGENCY_ID);
			case NAME, EMAIL, STATUS -> BqSql.lowerAnyValue(ADVERTISER);
		};
	}

	/**
	 * Maps a result row into a {@link ClientModel}.
	 *
	 * @param row the result row
	 * @return the client model
	 */
	ClientModel toClient(BqRow row) {
		return new ClientModel(
				row.getLong(ALIAS_ID),
				row.getString(ALIAS_NAME),
				row.getLong(ALIAS_AGENCY_ID),
				null,
				ACTIVE_STATUS);
	}

	/**
	 * Replaces or splits missing client names with effective reporting mart names.
	 *
	 * @param clients the clients loaded from IO-lines
	 * @return clients on the same effective-client grain as campaign/reporting pages
	 */
	List<ClientModel> enrichClients(List<ClientModel> clients) {
		LinkedHashSet<AgencyClientKey> keys = clients.stream()
				.filter(this::needsClientName)
				.map(client -> new AgencyClientKey(client.agencyId(), client.id()))
				.collect(LinkedHashSet::new, LinkedHashSet::add, LinkedHashSet::addAll);
		if (keys.isEmpty()) {
			return clients;
		}
		Map<AgencyClientKey, List<String>> names =
				clientResolver.adjustmentsMartClientNameSetsForAgencyClients(List.copyOf(keys));
		if (names.isEmpty()) {
			return clients;
		}
		return clients.stream()
				.flatMap(client -> splitClient(client, names.get(new AgencyClientKey(client.agencyId(), client.id())))
						.stream())
				.toList();
	}

	/**
	 * Checks whether a client row needs mart-name enrichment.
	 *
	 * @param client the client row
	 * @return whether ids are present but the name is missing or placeholder
	 */
	boolean needsClientName(ClientModel client) {
		return client.agencyId() != null
				&& client.id() != null
				&& clientResolver.cleanClientName(client.name()) == null;
	}

	/**
	 * Splits one placeholder client row by effective mart client names.
	 *
	 * @param client      the source client
	 * @param clientNames the resolved mart client names
	 * @return one client per mart name, or the source client when none was resolved
	 */
	List<ClientModel> splitClient(ClientModel client, List<String> clientNames) {
		if (clientNames == null || clientNames.isEmpty()) {
			return List.of(client);
		}
		return clientNames.stream()
				.map(clientName -> withClientName(client, clientName))
				.toList();
	}

	/**
	 * Copies a client with a replacement name.
	 *
	 * @param client     the source client
	 * @param clientName the replacement name
	 * @return the copied client
	 */
	ClientModel withClientName(ClientModel client, String clientName) {
		return new ClientModel(client.id(), clientName, client.agencyId(), client.email(), client.status());
	}
}
