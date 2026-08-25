package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.domain.entity.HubDashboard;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqSql;
import com.aidigital.operationalhub.service.agency.bigquery.model.CampaignDeliveryScope;
import com.aidigital.operationalhub.service.agency.bigquery.model.DashboardBasicSql;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQueryWriteGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.ReportQueryExecutor;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.dashboard.DashboardDataSourceService;
import com.aidigital.operationalhub.service.dashboard.model.DashboardColumnChoice;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetCriteria;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetFilter;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetPage;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetRow;
import com.aidigital.operationalhub.service.dashboard.model.DashboardPreview;
import com.aidigital.operationalhub.service.dashboard.model.DashboardSource;
import com.aidigital.operationalhub.service.entity.HubDashboardService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.usagelogging.LogUsage;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

/**
 * BigQuery-backed implementation of {@link DashboardDataSourceService}.
 *
 * <p>Holds the order of operations and the table's name, and delegates everything else: the query comes from
 * {@link DashboardBasicSql}, the write from {@link BigQueryWriteGateway}, and the record of it from
 * {@link HubDashboardService}.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BigQueryDashboardDataSourceService implements DashboardDataSourceService {

	/** Suffix the spreadsheet gives every Basic table, kept so the two are recognisable side by side. */
	private static final String TABLE_SUFFIX = "_report_basic";

	/** Segment separating the report dataset from the dashboard's own saved name. */
	private static final String DASHBOARD_SEGMENT = "_dash_";

	/** What a table name is left as when the campaign's name survives sanitising as nothing at all. */
	private static final String UNNAMED = "campaign";

	/** The largest preview page the API will return from BigQuery at once. */
	private static final int MAX_PAGE_SIZE = 100;

	/** How many values a single filter picker may list before search should narrow the report instead. */
	private static final int DISTINCT_VALUE_LIMIT = 500;
	/** The length the spreadsheet truncates a dashboard's table name to, kept so both tools name it alike. */
	private static final int MAX_TABLE_NAME_LENGTH = 180;
	private static final TypeReference<List<DashboardDatasetFilter>> FILTERS_TYPE = new TypeReference<>() {
	};

	private final CampaignService campaignService;
	private final HubDashboardService dashboardService;
	private final BigQuerySearchGateway searchGateway;
	private final BigQueryWriteGateway writeGateway;
	private final BigQueryProperties bigQueryProperties;
	private final ObjectMapper objectMapper;
	private final CampaignDeliveryScopeResolver scopeResolver;
	private final ReportQueryExecutor reportQueryExecutor;

	@Override
	public DashboardPreview preview(CurrentUserModel user, long campaignId, long dashboardId) {
		CampaignModel campaign = campaignService.getVisibleCampaignIdentity(user, campaignId);
		CampaignDeliveryScope scope = scopeResolver.forCampaign(campaign);
		HubDashboard dashboard = dashboardService.getByCampaignAndId(campaignId, dashboardId);
		DashboardColumnChoice columns = columnChoice(dashboard);
		DashboardDatasetCriteria stored = storedCriteria(dashboard, DashboardBasicSql.outputColumnNames(columns.cpa()));
		// The same question the preview's own paging asks, so it shares that answer rather than paying for a
		// second count of the same filtered dataset.
		long rowCount = searchGateway.countOfCachedUntilWrite(countOf(query(scope, columns, stored), stored));
		return new DashboardPreview(rowCount, columns, tableName(campaign, dashboard));
	}

	@Override
	public DashboardDatasetPage previewRows(
			CurrentUserModel user,
			long campaignId,
			long dashboardId,
			int pageNumber,
			int pageSize,
			DashboardDatasetCriteria criteria) {
		CampaignModel campaign = campaignService.getVisibleCampaignIdentity(user, campaignId);
		CampaignDeliveryScope scope = scopeResolver.forCampaign(campaign);
		HubDashboard dashboard = dashboardService.getByCampaignAndId(campaignId, dashboardId);
		DashboardColumnChoice choice = columnChoice(dashboard);
		List<String> columns = DashboardBasicSql.outputColumnNames(choice.cpa());
		DashboardDatasetCriteria activeCriteria = activeCriteria(criteria, columns);
		String sql = query(scope, choice, activeCriteria);
		int page = Math.max(pageNumber, 1);
		int size = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
		// Both cached, and both through the write-sensitive region: this query reads the adjustments view,
		// so an adjustment saved in Reporting can change what a preview page says. The count is the same
		// question for every page of one filter set, so paging asks it once rather than once per page.
		CompletableFuture<Long> totalFuture = reportQueryExecutor.submit(
				() -> searchGateway.countOfCachedUntilWrite(countOf(sql, activeCriteria)));
		try {
			List<DashboardDatasetRow> rows = searchGateway.fetchSqlCachedUntilWrite(
					pageOf(sql, activeCriteria, page, size),
					row -> toDatasetRow(row, columns));
			long total = reportQueryExecutor.await(totalFuture);
			int totalPages = total == 0L ? 0 : (int) Math.ceil((double) total / size);
			return new DashboardDatasetPage(page, size, total, totalPages, rows);
		} catch (RuntimeException exception) {
			totalFuture.cancel(true);
			throw exception;
		}
	}

	@Override
	public List<String> distinctValues(CurrentUserModel user, long campaignId, long dashboardId, String field) {
		CampaignModel campaign = campaignService.getVisibleCampaignIdentity(user, campaignId);
		CampaignDeliveryScope scope = scopeResolver.forCampaign(campaign);
		HubDashboard dashboard = dashboardService.getByCampaignAndId(campaignId, dashboardId);
		DashboardColumnChoice choice = columnChoice(dashboard);
		List<String> columns = DashboardBasicSql.outputColumnNames(choice.cpa());
		requireKnownField(field, columns);
		// Bounded by the dashboard's own window like every other read of it. A value that only occurs outside
		// the window would offer a filter that selects nothing, and listing it costs a scan of all history.
		return searchGateway.fetchSqlCachedUntilWrite(
				distinctValuesOf(query(scope, choice, storedCriteria(dashboard, columns)), field),
				row -> row.getString("value"));
	}

	@Override
	@LogUsage(action = "dashboard.source.create")
	public HubDashboard createDataSource(
			CurrentUserModel user, long campaignId, long dashboardId, String displayCampaignName) {
		CampaignModel campaign = campaignService.getVisibleCampaignIdentity(user, campaignId);
		CampaignDeliveryScope scope = scopeResolver.forCampaign(campaign);
		HubDashboard dashboard = dashboardService.getByCampaignAndId(campaignId, dashboardId);
		String table = tableName(campaign, dashboard);
		DashboardColumnChoice columns = columnChoice(dashboard);
		DashboardDatasetCriteria stored = storedCriteria(dashboard, DashboardBasicSql.outputColumnNames(columns.cpa()));
		writeGateway.replaceTable(table, filteredQuery(query(scope, columns, stored), stored));
		// Counted from the table rather than from the query: the row count shown next to a data source has to
		// describe the table someone is about to point ClicData at, and re-running the query would answer for
		// a second read that may already differ.
		long rowCount = searchGateway.countOf("SELECT COUNT(*) AS total FROM `" + table + "`");
		log.info("Wrote dashboard data source table={} rows={} dashboardId={}", table, rowCount, dashboardId);
		return dashboardService.attachSource(
				campaignId,
				dashboardId,
				new DashboardSource(table, rowCount, LocalDateTime.now()),
				displayCampaignName);
	}

	@Override
	public HubDashboard removeDataSource(CurrentUserModel user, long campaignId, long dashboardId) {
		campaignService.getVisibleCampaignIdentity(user, campaignId);
		return dashboardService.detachSource(campaignId, dashboardId);
	}

	/**
	 * Wraps the dataset query in a count of its rows.
	 *
	 * <p>The written query ends with the spreadsheet's own {@code ORDER BY}, which is dropped here. A table has
	 * no row order for it to establish, and sorting a result that is only being counted forces the whole thing
	 * through one worker for nothing.
	 *
	 * @param query the dataset query
	 * @return a query selecting a single {@code total} column
	 */
	String countOf(String query) {
		return countOf(query, DashboardDatasetCriteria.none());
	}

	/**
	 * Wraps the dataset query in a count of its filtered rows.
	 *
	 * @param query    the dataset query
	 * @param criteria additive output-column filters and date range
	 * @return a query selecting a single {@code total} column
	 */
	String countOf(String query, DashboardDatasetCriteria criteria) {
		return "SELECT COUNT(*) AS total FROM (\n" + filteredQuery(query, criteria) + "\n)";
	}

	/**
	 * Wraps the dataset query in pagination for the on-screen preview table.
	 *
	 * @param query      the dataset query
	 * @param criteria   additive output-column filters and date range
	 * @param pageNumber one-based page number
	 * @param pageSize   capped page size
	 * @return the paged SQL
	 */
	String pageOf(String query, DashboardDatasetCriteria criteria, int pageNumber, int pageSize) {
		int offset = (pageNumber - 1) * pageSize;
		return filteredQuery(query, criteria)
				+ "\nORDER BY " + BqSql.col("Date") + " ASC, " + BqSql.col(DashboardBasicSql.LEVEL_ONE_ALIAS)
				+ " ASC, " + BqSql.col(DashboardBasicSql.LEVEL_THREE_OUTPUT) + " ASC, "
				+ BqSql.col("Impressions") + " DESC\n"
				+ "LIMIT " + pageSize + " OFFSET " + offset;
	}

	/**
	 * Reads one column's distinct values from the dataset query.
	 *
	 * @param query the dataset query
	 * @param field the already-whitelisted output alias
	 * @return the distinct-value SQL
	 */
	String distinctValuesOf(String query, String field) {
		String value = "CAST(" + BqSql.col(field) + " AS STRING)";
		return "SELECT DISTINCT " + value + " AS value\n"
				+ "FROM (\n" + unordered(query) + "\n)\n"
				+ "WHERE " + BqSql.col(field) + " IS NOT NULL AND " + value + " != ''\n"
				+ "ORDER BY value ASC\n"
				+ "LIMIT " + DISTINCT_VALUE_LIMIT;
	}

	/**
	 * Wraps the dataset query in its active narrowing criteria.
	 *
	 * @param query    the dataset query
	 * @param criteria active filters and date range
	 * @return filtered dataset SQL
	 */
	String filteredQuery(String query, DashboardDatasetCriteria criteria) {
		if (!hasCriteria(criteria)) {
			return unordered(query);
		}
		return "SELECT * FROM (\n" + unordered(query) + "\n)\n" + where(criteria);
	}

	/**
	 * Checks whether a nested filter query is needed.
	 *
	 * @param criteria active filters and date range
	 * @return {@code true} when the output needs narrowing
	 */
	boolean hasCriteria(DashboardDatasetCriteria criteria) {
		return criteria != null && (!criteria.filters().isEmpty() || criteria.hasDateRange());
	}

	/**
	 * Removes the final output sort from the data-source query before it becomes a nested input.
	 *
	 * @param query the dataset query
	 * @return the query without its final {@code ORDER BY}
	 */
	String unordered(String query) {
		int orderBy = query.lastIndexOf("\nORDER BY ");
		return orderBy < 0 ? query : query.substring(0, orderBy);
	}

	/**
	 * Renders additive filter predicates for the dashboard output aliases.
	 *
	 * @param criteria active filters and date range
	 * @return a {@code WHERE} clause or the empty string
	 */
	String where(DashboardDatasetCriteria criteria) {
		if (criteria == null) {
			return "";
		}
		List<String> predicates = criteria.filters().stream()
				.filter(filter -> filter.values() != null && !filter.values().isEmpty())
				.map(filter -> {
					String values = filter.values().stream()
							.map(BqSql::literal)
							.collect(Collectors.joining(", "));
					return "CAST(" + BqSql.col(filter.field()) + " AS STRING) IN (" + values + ")";
				})
				.collect(Collectors.toCollection(ArrayList::new));
		if (criteria.dateFrom() != null) {
			predicates.add("CAST(" + BqSql.col("Date") + " AS DATE) >= DATE " + BqSql.literal(criteria.dateFrom()));
		}
		if (criteria.dateTo() != null) {
			predicates.add("CAST(" + BqSql.col("Date") + " AS DATE) <= DATE " + BqSql.literal(criteria.dateTo()));
		}
		return predicates.isEmpty() ? "" : "WHERE " + String.join(" AND ", predicates) + "\n";
	}

	/**
	 * Drops empty filters, validates every remaining field, and normalizes date bounds.
	 *
	 * @param criteria requested criteria
	 * @param columns  known output aliases
	 * @return active criteria with non-blank values
	 */
	DashboardDatasetCriteria activeCriteria(DashboardDatasetCriteria criteria, List<String> columns) {
		if (criteria == null) {
			return DashboardDatasetCriteria.none();
		}
		List<DashboardDatasetFilter> filters = criteria.filters().stream()
				.filter(filter -> filter != null && filter.values() != null && !filter.values().isEmpty())
				.map(filter -> new DashboardDatasetFilter(
						requireKnownField(filter.field(), columns),
						filter.values().stream()
								.filter(value -> value != null && !value.isBlank())
								.toList()))
				.filter(filter -> !filter.values().isEmpty())
				.toList();
		LocalDate from = parseDate(criteria.dateFrom());
		LocalDate to = parseDate(criteria.dateTo());
		if (from != null && to != null && from.isAfter(to)) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_041, criteria.dateFrom() + " - " + criteria.dateTo());
		}
		return new DashboardDatasetCriteria(
				filters, from == null ? null : from.toString(), to == null ? null : to.toString());
	}

	/**
	 * Reads persisted dashboard criteria.
	 *
	 * @param dashboard the dashboard
	 * @param columns   known output aliases
	 * @return validated criteria
	 */
	DashboardDatasetCriteria storedCriteria(HubDashboard dashboard, List<String> columns) {
		return activeCriteria(new DashboardDatasetCriteria(
				storedFilters(dashboard.getFilters()),
				dashboard.getDateFrom() == null ? null : dashboard.getDateFrom().toString(),
				dashboard.getDateTo() == null ? null : dashboard.getDateTo().toString()), columns);
	}

	/**
	 * Reads stored dashboard filters from JSON.
	 *
	 * @param filtersJson the JSON array column value
	 * @return service filters; empty when none are available/readable
	 */
	List<DashboardDatasetFilter> storedFilters(String filtersJson) {
		if (filtersJson == null || filtersJson.isBlank()) {
			return List.of();
		}
		try {
			return objectMapper.readValue(filtersJson, FILTERS_TYPE);
		} catch (JsonProcessingException e) {
			log.warn(
					"Failed to deserialize dashboard filters JSON; ignoring saved filters: {}",
					e.getOriginalMessage());
			return List.of();
		}
	}

	LocalDate parseDate(String date) {
		if (date == null || date.isBlank()) {
			return null;
		}
		try {
			return LocalDate.parse(date);
		} catch (DateTimeParseException e) {
			throw new BusinessException(OperationalHubErrorReason.OPH_041, date);
		}
	}

	/**
	 * Validates an output alias before it is used as a SQL identifier.
	 *
	 * @param field   the requested field
	 * @param columns known output aliases
	 * @return the same field
	 */
	String requireKnownField(String field, List<String> columns) {
		if (field == null || field.isBlank() || !columns.contains(field)) {
			throw new BusinessException(OperationalHubErrorReason.OPH_040, field);
		}
		return field;
	}

	/**
	 * Maps one BigQuery row into an ordered value map matching the dashboard template.
	 *
	 * @param row     the raw row
	 * @param columns output aliases in display order
	 * @return the dataset row
	 */
	DashboardDatasetRow toDatasetRow(BqRow row, List<String> columns) {
		Map<String, Object> values = new LinkedHashMap<>();
		columns.forEach(column -> values.put(column, row.values().get(column)));
		return new DashboardDatasetRow(values);
	}

	/**
	 * The query behind a dashboard's data source.
	 *
	 * @param scope    the resolved campaign delivery scope
	 * @param columns  which optional columns are kept
	 * @param criteria the criteria this query will be narrowed by, whose date window bounds the source reads
	 * @return the query text
	 */
	String query(CampaignDeliveryScope scope, DashboardColumnChoice columns, DashboardDatasetCriteria criteria) {
		return DashboardBasicSql.build(
				searchGateway.qualify(bigQueryProperties.getAdjustmentsView()),
				searchGateway.qualify(bigQueryProperties.getConversionsView()),
				searchGateway.qualify(bigQueryProperties.getPlansTable()),
				scope.constructedNames(),
				columns.creative(),
				columns.cpa(),
				criteria == null ? null : criteria.dateFrom(),
				criteria == null ? null : criteria.dateTo());
	}

	/**
	 * Reads the dashboard's stored selection as an answer per optional column.
	 *
	 * @param dashboard the dashboard
	 * @return which optional columns are kept
	 */
	DashboardColumnChoice columnChoice(HubDashboard dashboard) {
		Set<String> kept = storedColumns(dashboard.getOptionalColumns());
		return new DashboardColumnChoice(
				kept.contains(DashboardColumnChoice.CREATIVE), kept.contains(DashboardColumnChoice.CPA));
	}

	/**
	 * Splits the stored comma-joined selection.
	 *
	 * <p>Blank reads as none kept, not as all kept: the contract requires the field, so a blank value is a
	 * user who switched everything off, and guessing otherwise would put columns in a table nobody asked for.
	 *
	 * @param optionalColumns the stored value
	 * @return the kept column ids
	 */
	Set<String> storedColumns(String optionalColumns) {
		if (optionalColumns == null || optionalColumns.isBlank()) {
			return Set.of();
		}
		return Arrays.stream(optionalColumns.split(","))
				.map(String::trim)
				.filter(id -> !id.isEmpty())
				.collect(Collectors.toSet());
	}

	/**
	 * The table a dashboard's data source is written to.
	 *
	 * <p>Shaped after the spreadsheet's own name - campaign, report type, then the dashboard name - so the
	 * user can see which ClicData dashboard a table belongs to before anything is written.
	 *
	 * @param campaign  the resolved campaign
	 * @param dashboard the dashboard
	 * @return the fully-qualified table name
	 */
	String tableName(CampaignModel campaign, HubDashboard dashboard) {
		String qualified = bigQueryProperties.getDashboardDataset() + "."
				+ sanitize(campaign.name()) + TABLE_SUFFIX + DASHBOARD_SEGMENT + sanitize(dashboard.getName());
		return qualified.length() > MAX_TABLE_NAME_LENGTH ? qualified.substring(0, MAX_TABLE_NAME_LENGTH) : qualified;
	}

	/**
	 * Reduces a name to what BigQuery accepts in a table name, as the spreadsheet does: letters, digits and
	 * underscores, lower-cased.
	 *
	 * <p>A run of unusable characters collapses to one underscore rather than one per character, which is what
	 * the spreadsheet's own slug does - "Acme - Summer" is {@code acme_summer}, not {@code acme___summer}. The
	 * table a ClicData dashboard points at is named from this, so the two tools must agree character for
	 * character.
	 *
	 * @param name the campaign or dashboard name
	 * @return the sanitised name, or a placeholder when nothing usable is left
	 */
	String sanitize(String name) {
		if (name == null) {
			return UNNAMED;
		}
		String sanitized = name.trim().toLowerCase().replaceAll("[^a-z0-9]+", "_");
		String trimmed = sanitized.replaceAll("^_+|_+$", "");
		return trimmed.isEmpty() ? UNNAMED : trimmed;
	}
}
