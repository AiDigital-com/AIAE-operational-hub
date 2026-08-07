package com.aidigital.operationalhub.service.agency.bigquery.service;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqPage;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * Executes {@link BqRequest}s against the IO Lines BigQuery table on behalf of the agency, client,
 * and campaign search services, centralising the qualified table name, the count-extraction logic,
 * the row mapping, and the {@link BigQueryExternalException} → {@link BusinessException} translation
 * that would otherwise be duplicated in every service.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class BigQuerySearchGateway {

	private final BigQueryClient bigQueryClient;
	private final BigQueryProperties bigQueryProperties;
	private final CachedBigQuerySearchExecutor cachedSearchExecutor;

	/**
	 * Returns the qualified IO Lines table name (see {@link #qualify(String)}).
	 *
	 * @return the qualified table name
	 */
	public String table() {
		return qualify(bigQueryProperties.getIoLinesTable());
	}

	/**
	 * Qualifies a configured table name to a form BigQuery can resolve. A name that already contains a
	 * {@code .} is treated as already qualified ({@code dataset.table} or {@code project.dataset.table})
	 * and returned verbatim; a bare table name is prefixed with the configured dataset when one is set.
	 * This lets the three table properties be configured in any of those forms uniformly.
	 *
	 * @param table the configured table name
	 * @return the qualified table name
	 */
	public String qualify(String table) {
		if (table == null || table.contains(".")) {
			return table;
		}
		String dataset = bigQueryProperties.getDataset();
		return dataset == null || dataset.isBlank() ? table : dataset + "." + table;
	}

	/**
	 * Runs a count request and returns the {@code total}.
	 *
	 * @param request the count request (built via {@link BqRequest.Builder#buildCount()})
	 * @return the total number of matching rows, or {@code 0} when the result is empty/null
	 * @throws BusinessException when the BigQuery read fails
	 */
	public long count(BqRequest request) {
		List<Map<String, Object>> rows = execute(request);
		if (rows.isEmpty()) {
			return 0L;
		}
		Long total = new BqRow(rows.getFirst()).getLong("total");
		return total == null ? 0L : total;
	}

	/**
	 * Runs a data request and maps each row with the given mapper.
	 *
	 * @param request the data request (built via {@link BqRequest.Builder#build()})
	 * @param mapper  the row mapper
	 * @param <T>     the mapped type
	 * @return the mapped rows
	 * @throws BusinessException when the BigQuery read fails
	 */
	public <T> List<T> fetch(BqRequest request, Function<BqRow, T> mapper) {
		return execute(request).stream()
				.map(BqRow::new)
				.map(mapper)
				.toList();
	}

	/**
	 * Runs a data request through the cached executor and maps each row with the given mapper - the
	 * cached counterpart of {@link #fetch(BqRequest, Function)}, for small, repeatedly-requested reads
	 * (a report page, a one-row aggregate) where an identical repeated request can reuse the previous
	 * result instead of re-running the BigQuery job. Not meant for large/full-dataset reads (an export,
	 * a bulk-upload baseline) - those would bloat the shared cache region for a result unlikely to repeat.
	 *
	 * @param request the data request (built via {@link BqRequest.Builder#build()})
	 * @param mapper  the row mapper
	 * @param <T>     the mapped type
	 * @return the mapped rows
	 * @throws BusinessException when the BigQuery read fails
	 */
	public <T> List<T> fetchCached(BqRequest request, Function<BqRow, T> mapper) {
		return executeCached(request).stream()
				.map(BqRow::new)
				.map(mapper)
				.toList();
	}

	/**
	 * Evicts every cached search result (see {@link CachedBigQuerySearchExecutor#evictAll()}). Called
	 * after a report-row write, since {@link #fetchCached(BqRequest, Function)} results for the
	 * adjustments view can otherwise go stale the moment a write lands.
	 */
	public void evictSearchCache() {
		cachedSearchExecutor.evictAll();
	}

	/**
	 * Runs a single paged data request whose select list carries its own total (see
	 * {@link BqRequest.Builder#withTotalCount(String)}), collapsing what used to be a separate count job
	 * into one BigQuery job on the common path. The rendered SQL is cached for a short TTL (see
	 * {@link CachedBigQuerySearchExecutor}), so identical repeated searches skip BigQuery entirely.
	 *
	 * <p>When the page comes back empty and {@code pageNumber} is greater than one, the true total isn't
	 * present in any row (the requested page is past the end of a result set that may have shrunk since
	 * the caller last knew the total), so it is read via the supplied count-request fallback; for page
	 * one, an empty page unambiguously means a total of zero.
	 *
	 * @param dataRequest   the paged data request, built with {@link BqRequest.Builder#withTotalCount}
	 * @param countFallback supplies the count request, evaluated only when the fallback is needed
	 * @param pageNumber    the one-based page number requested
	 * @param mapper        the row mapper
	 * @param <T>           the mapped type
	 * @return the page content and total
	 * @throws BusinessException when the BigQuery read fails
	 */
	public <T> BqPage<T> fetchPage(
			BqRequest dataRequest, Supplier<BqRequest> countFallback, int pageNumber, Function<BqRow, T> mapper) {
		List<Map<String, Object>> rows = executeCached(dataRequest);
		if (rows.isEmpty()) {
			long total = pageNumber > 1 ? count(countFallback.get()) : 0L;
			return new BqPage<>(List.of(), total);
		}
		List<T> content = rows.stream().map(BqRow::new).map(mapper).toList();
		Long total = new BqRow(rows.getFirst()).getLong(BqRequest.TOTAL_ALIAS);
		return new BqPage<>(content, total == null ? 0L : total);
	}

	/**
	 * The innermost message of a failure chain - BigQuery's own complaint, which the SDK wraps in a
	 * couple of layers of its own before our gateway wraps it again. The outermost message is always
	 * some variant of "query failed" and says nothing.
	 *
	 * @param ex the caught failure
	 * @return the deepest non-blank message, or the exception's class name when every layer is blank
	 */
	String rootMessage(Throwable ex) {
		Throwable deepest = ex;
		while (deepest.getCause() != null && deepest.getCause() != deepest) {
			deepest = deepest.getCause();
		}
		String message = deepest.getMessage();
		return message == null || message.isBlank() ? deepest.getClass().getSimpleName() : message;
	}

	/**
	 * Runs the request's rendered SQL directly against {@link BigQueryClient}, translating a BigQuery
	 * failure into a {@link BusinessException}.
	 *
	 * @param request the request whose rendered SQL is run
	 * @return the raw result rows
	 * @throws BusinessException when the BigQuery read fails
	 */
	List<Map<String, Object>> execute(BqRequest request) {
		try {
			return bigQueryClient.query(request.sql());
		} catch (BigQueryExternalException ex) {
			log.error("Failed to execute BigQuery query: {}", request.sql(), ex);
			// BigQuery's own reason travels with the error, not only into the log: "BigQuery data query
			// failed" alone forces whoever hits it to go and find the server log before they can say
			// anything about what broke.
			throw new BusinessException(OperationalHubErrorReason.OPH_018, ex, rootMessage(ex));
		}
	}

	/**
	 * Runs the request's rendered SQL through {@link CachedBigQuerySearchExecutor}, translating a
	 * BigQuery failure into a {@link BusinessException}.
	 *
	 * @param request the request whose rendered SQL is run
	 * @return the raw result rows
	 * @throws BusinessException when the BigQuery read fails
	 */
	List<Map<String, Object>> executeCached(BqRequest request) {
		try {
			return cachedSearchExecutor.query(request.sql());
		} catch (BigQueryExternalException ex) {
			log.error("Failed to execute BigQuery query: {}", request.sql(), ex);
			// BigQuery's own reason travels with the error, not only into the log: "BigQuery data query
			// failed" alone forces whoever hits it to go and find the server log before they can say
			// anything about what broke.
			throw new BusinessException(OperationalHubErrorReason.OPH_018, ex, rootMessage(ex));
		}
	}
}
