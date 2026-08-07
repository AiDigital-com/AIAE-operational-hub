package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqPage;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqSql;
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

import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CNB_CAMPAIGN_NAME;

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
		List<CampaignModel> content = clientResolver.forAdjustmentsMart(result.content());
		return new PageImpl<>(
				content, PageRequest.of(criteria.pageNumber() - 1, criteria.pageSize()), result.total());
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
	 * <p>Real client names include campaigns whose mart {@code CNB_client} matches that name. The UI
	 * fallback {@code Client without name} means the opposite: keep campaigns under the requested
	 * agency/client id that are not assigned to any real mart client.
	 *
	 * @param query      the query builder
	 * @param clientName the effective client name requested by the UI
	 * @param agencyIds  the already requested agency ids
	 * @param clientIds  the already requested client ids
	 */
	void applyClientNameFilter(
			BqRequest.Builder query, String clientName, List<Long> agencyIds, List<Long> clientIds) {
		BqRequest campaignNameScope = campaignNameScope(agencyIds, clientIds);
		if (clientResolver.isUnknownClientName(clientName)) {
			query.whereNotInSubquery(
					CAMPAIGN,
					CNB_CAMPAIGN_NAME,
					clientResolver.adjustmentsCampaignNamesWithRealClient(campaignNameScope));
			return;
		}
		query.whereInSubquery(
				CAMPAIGN,
				CNB_CAMPAIGN_NAME,
				clientResolver.adjustmentsCampaignNamesForClient(clientName, campaignNameScope));
	}

	/**
	 * Builds a campaign-name subquery for the already-selected agency/client scope.
	 *
	 * @param agencyIds agency ids from active filters
	 * @param clientIds client ids from active filters
	 * @return a subquery selecting campaign names, or {@code null} when there is no useful scope
	 */
	BqRequest campaignNameScope(List<Long> agencyIds, List<Long> clientIds) {
		boolean hasAgencyScope = agencyIds != null && !agencyIds.isEmpty();
		boolean hasClientScope = clientIds != null && !clientIds.isEmpty();
		if (!hasAgencyScope && !hasClientScope) {
			return null;
		}
		return new BqRequest.Builder()
				.from(gateway.table())
				.distinct()
				.select(CAMPAIGN)
				.whereIn(AGENCY_ID, agencyIds)
				.whereIn(ADVERTISER_ID, clientIds)
				.whereNotNull(CAMPAIGN)
				.build();
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
			return BqSql.lowerAnyValue(CAMPAIGN);
		}
		return switch (field) {
			case ID -> BqSql.col(CAMPAIGN_ID);
			case CLIENT_ID -> BqSql.anyValue(ADVERTISER_ID);
			case AGENCY_ID -> BqSql.anyValue(AGENCY_ID);
			case CLIENT_NAME -> BqSql.lowerAnyValue(ADVERTISER);
			case STATUS -> BqSql.lowerAnyValue(ORDER_STATUS);
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
}
