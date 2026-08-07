package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqPage;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqSql;
import com.aidigital.operationalhub.service.agency.bigquery.model.CampaignFlightSql;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.search.CampaignField;
import com.aidigital.operationalhub.service.common.search.FilterCriterion;
import com.aidigital.operationalhub.service.common.search.FilterOperation;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.AgencyVisibilityService;
import com.aidigital.operationalhub.service.rbac.model.AgencyVisibility;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Objects;

/**
 * BigQuery-backed implementation of {@link CampaignService}.
 *
 * <p>Campaigns are distinct {@code campaign_id} groups of the IO Lines table, aggregating the
 * line-item rows. Filtering, sorting, and paging run in BigQuery via a {@link BqRequest} count query
 * and the matching paged query.
 *
 * <p>The reported budget sums {@link BigQueryIoLinesColumns#TACTIC_BUDGET} (one value per line item),
 * never {@link BigQueryIoLinesColumns#ORDER_BUDGET} (the order-level total, repeated identically on
 * every line-item row of that order) - summing the latter across a group would over-count by the
 * order's own line-item count. Any future rollup of an order-level column over this table must apply
 * the same rule: aggregate the line-item-grained column, or dedup per {@code order_id} first.
 */
@Service
@RequiredArgsConstructor
public class BigQueryCampaignService implements CampaignService {

	private static final String CAMPAIGN_ID = BigQueryIoLinesColumns.CAMPAIGN_ID;
	private static final String CAMPAIGN = BigQueryIoLinesColumns.CAMPAIGN;
	private static final String ADVERTISER_ID = BigQueryIoLinesColumns.ADVERTISER_ID;
	private static final String ADVERTISER = BigQueryIoLinesColumns.ADVERTISER;
	private static final String AGENCY_ID = BigQueryIoLinesColumns.AGENCY_ID;
	private static final String AGENCY = BigQueryIoLinesColumns.AGENCY;
	private static final String ORDER_STATUS = BigQueryIoLinesColumns.ORDER_STATUS;

	/** The names a {@code SEARCH} term is matched against, in the order a reader would expect them. */
	private static final List<String> SEARCHABLE_NAMES = List.of(CAMPAIGN, ADVERTISER, AGENCY);

	private static final String ALIAS_ID = "id";
	private static final String ALIAS_NAME = "name";
	private static final String ALIAS_CLIENT_ID = "client_id";
	private static final String ALIAS_CLIENT_NAME = "client_name";
	private static final String ALIAS_AGENCY_ID = "agency_id";
	private static final String ALIAS_AGENCY_NAME = "agency_name";
	private static final String ALIAS_START_DATE = "start_date";
	private static final String ALIAS_END_DATE = "end_date";
	private static final String ALIAS_BUDGET = "budget";
	private static final String ALIAS_STATUS = "status";
	private static final String ALIAS_CHANNELS = "channels";
	private static final String ALIAS_INDUSTRY_VERTICAL = "industry_vertical";
	private static final String ALIAS_LINE_ITEM_COUNT = "line_item_count";

	private final BigQuerySearchGateway gateway;
	private final AgencyVisibilityService agencyVisibilityService;
	private final CampaignMartClientResolver clientResolver;
	private final CampaignDeliveryScopeResolver scopeResolver;

	@Override
	public Page<CampaignModel> searchCampaigns(
			CurrentUserModel user, SearchCriteria<CampaignField> criteria) {
		AgencyVisibility visibility = agencyVisibilityService.resolveForCurrentUser(user);
		if (visibility.seesNothing()) {
			return new PageImpl<>(List.of(), PageRequest.of(criteria.pageNumber() - 1, criteria.pageSize()), 0);
		}
		BqRequest.Builder query = new BqRequest.Builder()
				.from(gateway.table())
				.select(CAMPAIGN_ID, ALIAS_ID)
				.selectAnyValue(CAMPAIGN, ALIAS_NAME)
				.selectAnyValue(ADVERTISER_ID, ALIAS_CLIENT_ID)
				.selectAnyValue(ADVERTISER, ALIAS_CLIENT_NAME)
				.selectAnyValue(AGENCY_ID, ALIAS_AGENCY_ID)
				.selectAnyValue(AGENCY, ALIAS_AGENCY_NAME)
				.selectMin(BigQueryIoLinesColumns.ORDER_START_DATE, ALIAS_START_DATE)
				.selectMax(BigQueryIoLinesColumns.ORDER_END_DATE, ALIAS_END_DATE)
				.selectSum(BigQueryIoLinesColumns.TACTIC_BUDGET, ALIAS_BUDGET)
				.selectAnyValue(ORDER_STATUS, ALIAS_STATUS)
				.selectArrayAggDistinct(BigQueryIoLinesColumns.MEDIA_TACTIC, ALIAS_CHANNELS)
				.selectAnyValue(BigQueryIoLinesColumns.INDUSTRY_VERTICAL, ALIAS_INDUSTRY_VERTICAL)
				.selectCountDistinct(BigQueryIoLinesColumns.LINE_ITEM_ID, ALIAS_LINE_ITEM_COUNT)
				.withTotalCount(CAMPAIGN_ID)
				.countDistinct(CAMPAIGN_ID)
				.whereNotNull(CAMPAIGN_ID)
				.whereIn(AGENCY_ID, visibility.agencyIds())
				.groupBy(CAMPAIGN_ID)
				.orderBy(sortExpression(criteria.sort()))
				.sortBy(criteria.sort())
				.page(criteria.pageNumber(), criteria.pageSize());
		applyFilters(query, criteria.filters());

		BqPage<CampaignModel> result =
				gateway.fetchPage(query.build(), query::buildCount, criteria.pageNumber(), this::toCampaign);
		List<CampaignModel> content = resolveClientNames(result.content(), criteria.filters());
		return new PageImpl<>(
				content, PageRequest.of(criteria.pageNumber() - 1, criteria.pageSize()), result.total());
	}

	/**
	 * Resolves the effective client names of one campaign page.
	 *
	 * <p>A {@code CLIENT_NAME} filter already proves every returned campaign belongs to that exact
	 * effective mart-client bucket: {@link #applyClientNameFilter} embeds the line-item-to-mart resolver in
	 * the page query. Running {@link CampaignMartClientResolver#forAdjustmentsMart(List)} afterward would
	 * repeat the same expensive adjustments-view scan in a second BigQuery job only to rediscover the
	 * requested name. Unfiltered lists still need that batched resolver.
	 *
	 * @param campaigns the campaign page returned by the main query
	 * @param filters   the active campaign filters, may be {@code null}
	 * @return campaigns carrying their effective client names
	 */
	List<CampaignModel> resolveClientNames(
			List<CampaignModel> campaigns, List<FilterCriterion<CampaignField>> filters) {
		String requestedClientName = requestedClientName(filters);
		if (requestedClientName == null) {
			return clientResolver.forAdjustmentsMart(campaigns);
		}
		return campaigns.stream()
				.map(campaign -> clientResolver.withClientName(campaign, requestedClientName))
				.toList();
	}

	/**
	 * Returns the one non-blank effective client name requested by a campaign search.
	 *
	 * <p>More than one different name is not treated as authoritative. Such a request is unusual, but
	 * falling back to the normal resolver keeps this optimization from changing its semantics.
	 *
	 * @param filters the active filters, may be {@code null}
	 * @return the requested client name, or {@code null} when there is not exactly one
	 */
	String requestedClientName(List<FilterCriterion<CampaignField>> filters) {
		if (filters == null) {
			return null;
		}
		List<String> names = filters.stream()
				.filter(filter -> filter.field() == CampaignField.CLIENT_NAME)
				.map(FilterCriterion::value)
				.filter(Objects::nonNull)
				.map(String::trim)
				.filter(value -> !value.isEmpty())
				.distinct()
				.toList();
		return names.size() == 1 ? names.getFirst() : null;
	}

	@Override
	public CampaignModel getVisibleCampaign(CurrentUserModel user, long campaignId) {
		FilterCriterion<CampaignField> idFilter =
				new FilterCriterion<>(CampaignField.ID, String.valueOf(campaignId), FilterOperation.EQUALS, false);
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(List.of(idFilter), null, 1, 1);
		Page<CampaignModel> page = searchCampaigns(user, criteria);
		return page.getContent().stream().findFirst()
				.orElseThrow(() -> new BusinessException(OperationalHubErrorReason.OPH_025, campaignId));
	}

	@Override
	public CampaignModel getVisibleCampaignIdentity(CurrentUserModel user, long campaignId) {
		AgencyVisibility visibility = agencyVisibilityService.resolveForCurrentUser(user);
		if (visibility.seesNothing()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_025, campaignId);
		}
		FilterCriterion<CampaignField> idFilter =
				new FilterCriterion<>(CampaignField.ID, String.valueOf(campaignId), FilterOperation.EQUALS, false);
		// Six ANY_VALUEs over one campaign's line items, and nothing else. No budget sum, no flight window, no
		// tactic array, no line-item count, no ordering, no total-count window, and no second query asking the
		// delivery mart what it calls this client - none of which a caller resolving a campaign in order to
		// read its rows was ever going to look at.
		BqRequest.Builder query = new BqRequest.Builder()
				.from(gateway.table())
				.select(CAMPAIGN_ID, ALIAS_ID)
				.selectAnyValue(CAMPAIGN, ALIAS_NAME)
				.selectAnyValue(ADVERTISER_ID, ALIAS_CLIENT_ID)
				.selectAnyValue(ADVERTISER, ALIAS_CLIENT_NAME)
				.selectAnyValue(AGENCY_ID, ALIAS_AGENCY_ID)
				.selectAnyValue(AGENCY, ALIAS_AGENCY_NAME)
				.whereNotNull(CAMPAIGN_ID)
				.whereIn(AGENCY_ID, visibility.agencyIds())
				.groupBy(CAMPAIGN_ID)
				.limitOffset(1, 0);
		query.filter(CAMPAIGN_ID, true, idFilter);
		// Cached with the rest of the snapshot reads: the answer changes once a night, and every report and
		// dashboard interaction on a campaign asks it again.
		return gateway.fetchCached(query.build(), this::toCampaignIdentity).stream().findFirst()
				.orElseThrow(() -> new BusinessException(OperationalHubErrorReason.OPH_025, campaignId));
	}

	/**
	 * Adds the campaign filters as SQL predicates.
	 *
	 * <p>Several {@code AGENCY_ID} filters combine into one {@code IN (...)} predicate rather than a
	 * predicate each: repeated equality on the same id column can only sensibly mean OR, since ANDing
	 * them would match nothing. That is what lets the caller filter by a set of agencies at once. It
	 * cannot widen visibility - the resulting predicate ANDs with the visibility {@code IN} added by
	 * {@link #searchCampaigns}, so the effective set is the intersection of the two.
	 *
	 * <p>{@code SEARCH} is the one filter that is not a field: it matches the campaign, client or
	 * agency name, ORed, because a user searching from one box knows one of those three names and no
	 * way to say which. It ignores the criterion's operation and case flag - a name search is a
	 * case-insensitive substring or it is useless.
	 *
	 * @param query   the query builder
	 * @param filters the active filters, may be {@code null}
	 */
	void applyFilters(BqRequest.Builder query, List<FilterCriterion<CampaignField>> filters) {
		if (filters == null) {
			return;
		}
		List<Long> agencyIds = requestedAgencyIds(filters);
		List<Long> clientIds = requestedClientIds(filters);
		for (FilterCriterion<CampaignField> filter : filters) {
			switch (filter.field()) {
				case NAME -> query.filter(CAMPAIGN, false, filter);
				case SEARCH -> query.whereContainsSubstrAnyOf(SEARCHABLE_NAMES, filter.value());
				case STATUS -> query.filter(ORDER_STATUS, false, filter);
				case ID -> query.filter(CAMPAIGN_ID, true, filter);
				case CLIENT_ID -> query.filter(ADVERTISER_ID, true, filter);
				case CLIENT_NAME -> applyClientNameFilter(query, filter.value(), agencyIds, clientIds);
				default -> { /* AGENCY_ID is collected below; no other campaign filter field exists */ }
			}
		}
		query.whereIn(AGENCY_ID, agencyIds);
	}

	/**
	 * Applies an effective mart-client scope to an IO-lines campaign query.
	 *
	 * <p>Real client names include campaigns whose NetSuite line item ids map to exactly one mart
	 * {@code CNB_client} with that name. The UI fallback {@code Client without name} means the opposite:
	 * keep campaigns under the requested agency/client id that are not assigned to exactly one real mart
	 * client. This deliberately uses line item ids, not campaign names, because NetSuite and the marts do
	 * not format campaign names identically.
	 *
	 * @param query      the query builder
	 * @param clientName the effective client name requested by the UI
	 * @param agencyIds  the already requested agency ids
	 * @param clientIds  the already requested client ids
	 */
	void applyClientNameFilter(
			BqRequest.Builder query, String clientName, List<Long> agencyIds, List<Long> clientIds) {
		BqRequest lineItemScope = scopeResolver.lineItemsForAgencyClients(agencyIds, clientIds);
		if (clientResolver.isUnknownClientName(clientName)) {
			query.whereNotInSubquery(
					CAMPAIGN_ID,
					CampaignDeliveryScopeResolver.CAMPAIGN_ID_ALIAS,
					scopeResolver.campaignIdsWithSingleRealClient(lineItemScope));
			return;
		}
		query.whereInSubquery(
				CAMPAIGN_ID,
				CampaignDeliveryScopeResolver.CAMPAIGN_ID_ALIAS,
				scopeResolver.campaignIdsForSingleRealClient(clientName, lineItemScope));
	}

	/**
	 * Collects the numeric agency ids the filters ask for, ignoring any value that is not a number.
	 *
	 * @param filters the active filters
	 * @return the requested agency ids, empty when none were requested
	 */
	List<Long> requestedAgencyIds(List<FilterCriterion<CampaignField>> filters) {
		return filters.stream()
				.filter(filter -> filter.field() == CampaignField.AGENCY_ID)
				.map(FilterCriterion::value)
				.map(this::parseAgencyId)
				.filter(Objects::nonNull)
				.toList();
	}

	/**
	 * Collects the numeric client ids the filters ask for, ignoring invalid values.
	 *
	 * @param filters the active filters
	 * @return the requested client ids, empty when none were requested
	 */
	List<Long> requestedClientIds(List<FilterCriterion<CampaignField>> filters) {
		return filters.stream()
				.filter(filter -> filter.field() == CampaignField.CLIENT_ID)
				.map(FilterCriterion::value)
				.map(this::parseAgencyId)
				.filter(Objects::nonNull)
				.toList();
	}

	/**
	 * Parses one agency id filter value.
	 *
	 * @param value the raw filter value, may be {@code null}
	 * @return the parsed id, or {@code null} when the value is absent or not a number
	 */
	Long parseAgencyId(String value) {
		if (value == null) {
			return null;
		}
		try {
			return Long.parseLong(value.trim());
		} catch (NumberFormatException e) {
			return null;
		}
	}

	/**
	 * Resolves the {@code ORDER BY} expression for the requested sort field, defaulting to name.
	 *
	 * @param sort the sort directive, may be {@code null}
	 * @return the order-by expression
	 */
	String sortExpression(SortCriterion<CampaignField> sort) {
		CampaignField field = sort == null ? null : sort.field();
		if (field == null) {
			// Not alphabetical. A list of campaigns is read to see what needs doing, and a name says nothing
			// about that - so the default order is what is happening to each one: live, then upcoming, then
			// finished, each by how close it is to now. See CampaignFlightSql#phaseOrder.
			return CampaignFlightSql.phaseOrder(
					BigQueryIoLinesColumns.ORDER_START_DATE, BigQueryIoLinesColumns.ORDER_END_DATE);
		}
		return switch (field) {
			case ID -> BqSql.col(CAMPAIGN_ID);
			case CLIENT_ID -> BqSql.anyValue(ADVERTISER_ID);
			case AGENCY_ID -> BqSql.anyValue(AGENCY_ID);
			case CLIENT_NAME -> BqSql.lowerAnyValue(ADVERTISER);
			case STATUS -> BqSql.lowerAnyValue(ORDER_STATUS);
			case START_DATE -> CampaignFlightSql.startDate(BigQueryIoLinesColumns.ORDER_START_DATE);
			case END_DATE -> CampaignFlightSql.endDate(BigQueryIoLinesColumns.ORDER_END_DATE);
			// SEARCH stands for three columns and is filter-only; the sort contract does not offer it,
			// so this arm is only reachable by a hand-rolled request, and the campaign name is the
			// least surprising thing to order such a request by.
			case NAME, SEARCH -> BqSql.lowerAnyValue(CAMPAIGN);
		};
	}

	/**
	 * Maps a result row into a {@link CampaignModel}.
	 *
	 * @param row the result row
	 * @return the campaign model
	 */
	CampaignModel toCampaign(BqRow row) {
		return new CampaignModel(
				row.getLong(ALIAS_ID),
				row.getString(ALIAS_NAME),
				row.getLong(ALIAS_CLIENT_ID),
				row.getString(ALIAS_CLIENT_NAME),
				row.getLong(ALIAS_AGENCY_ID),
				row.getString(ALIAS_AGENCY_NAME),
				row.getString(ALIAS_STATUS),
				row.getString(ALIAS_START_DATE),
				row.getString(ALIAS_END_DATE),
				row.getDouble(ALIAS_BUDGET),
				row.getStringList(ALIAS_CHANNELS),
				row.getString(ALIAS_INDUSTRY_VERTICAL),
				row.getLong(ALIAS_LINE_ITEM_COUNT));
	}

	/**
	 * Maps one identity row into a campaign whose unread fields are null.
	 *
	 * <p>Null rather than zero, deliberately: a budget of {@code null} is a field nobody asked for, while a
	 * budget of {@code 0.0} is a claim about the campaign.
	 *
	 * @param row the identity row
	 * @return the campaign's identity
	 */
	CampaignModel toCampaignIdentity(BqRow row) {
		return new CampaignModel(
				row.getLong(ALIAS_ID),
				row.getString(ALIAS_NAME),
				row.getLong(ALIAS_CLIENT_ID),
				row.getString(ALIAS_CLIENT_NAME),
				row.getLong(ALIAS_AGENCY_ID),
				row.getString(ALIAS_AGENCY_NAME),
				null, null, null, null, null, null, null);
	}
}
