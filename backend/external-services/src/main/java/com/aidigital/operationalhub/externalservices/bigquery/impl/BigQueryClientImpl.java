package com.aidigital.operationalhub.externalservices.bigquery.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.BigQueryOperationContext;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.RetryOption;
import com.google.cloud.bigquery.BigQuery;
import com.google.cloud.bigquery.BigQueryOptions;
import com.google.cloud.bigquery.Field;
import com.google.cloud.bigquery.FieldValue;
import com.google.cloud.bigquery.FieldValueList;
import com.google.cloud.bigquery.Job;
import com.google.cloud.bigquery.JobInfo;
import com.google.cloud.bigquery.JobStatistics;
import com.google.cloud.bigquery.QueryJobConfiguration;
import com.google.cloud.bigquery.TableResult;
import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.threeten.bp.Duration;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Production implementation of {@link BigQueryClient} backed by the
 * {@code com.google.cloud:google-cloud-bigquery} SDK.
 *
 * <p>A service-account JSON key is loaded once at construction from the inline JSON in
 * {@link BigQueryProperties#getCredentialsJson()}. The credential contents are never logged.
 *
 * <p>Queries are executed with the full BigQuery OAuth scope (not {@code bigquery.readonly}): the
 * readonly scope does not cover the {@code jobs.insert} call every query makes under the hood (a query
 * job still has to be created even for a pure SELECT), which surfaces as
 * {@code ACCESS_TOKEN_SCOPE_INSUFFICIENT} - a token-level rejection that happens before IAM is even
 * checked. Actual read/write access is still bounded by the service account's own IAM roles, not by
 * this scope; this class only ever issues SELECT statements.
 */
@Slf4j
@RequiredArgsConstructor
public class BigQueryClientImpl implements BigQueryClient {

	/**
	 * OAuth scopes the read token carries.
	 *
	 * <p>The Drive scope is not decoration. Some of the views this client reads are built over external
	 * tables backed by Google Sheets, and BigQuery fetches those through the caller's own token: a token
	 * without a Drive scope fails with {@code Permission denied while getting Drive credentials} no matter
	 * what the service account's BigQuery IAM says. The sheet must additionally be shared with the service
	 * account - the scope is the token's half of the requirement, the share is Drive's half.
	 */
	private static final List<String> SCOPES = List.of(
			"https://www.googleapis.com/auth/bigquery",
			"https://www.googleapis.com/auth/drive.readonly");

	private static final String METRIC_QUERY = "bigquery.query";
	private static final String METRIC_BYTES_PROCESSED = "bigquery.query.bytes.processed";
	private static final String METRIC_BYTES_BILLED = "bigquery.query.bytes.billed";
	private static final String METRIC_SLOT_MS = "bigquery.query.slot.ms";
	private static final String METRIC_ROWS = "bigquery.query.rows";
	private static final String METRIC_CACHE_HITS = "bigquery.query.cache";
	private static final String TAG_TABLE = "table";
	private static final String TAG_OPERATION = "operation";
	private static final String LABEL_OPERATION = "oph_operation";
	private static final String TAG_OUTCOME = "outcome";
	private static final String TAG_CACHE_HIT = "cacheHit";
	private static final String OUTCOME_SUCCESS = "success";
	private static final String OUTCOME_ERROR = "error";

	private final BigQueryProperties properties;
	private final BigQuery bigQuery;
	private final MeterRegistry meterRegistry;
	private final BigQueryOperationContext operationContext;

	/**
	 * Constructs the client and authenticates using the configured service-account JSON string.
	 *
	 * @param properties       BigQuery configuration (project ID, dataset, credentials JSON)
	 * @param meterRegistry    registry the per-query {@code bigquery.query} timer is recorded against
	 * @param operationContext names the operation each job belongs to
	 * @throws BigQueryExternalException when credentials cannot be loaded
	 */
	public BigQueryClientImpl(BigQueryProperties properties, MeterRegistry meterRegistry,
							  BigQueryOperationContext operationContext) {
		this.properties = properties;
		this.meterRegistry = meterRegistry;
		this.operationContext = operationContext;
		log.info("Initialising BigQuery client: project={}, dataset={}",
				properties.getProjectId(), properties.getDataset());
		String credentialsJson = properties.getCredentialsJson();

		try (var inputStream = new ByteArrayInputStream(credentialsJson.getBytes(StandardCharsets.UTF_8))) {
			GoogleCredentials credentials = GoogleCredentials
					.fromStream(inputStream)
					.createScoped(SCOPES);
			this.bigQuery = BigQueryOptions.newBuilder()
					.setProjectId(properties.getProjectId())
					.setCredentials(credentials)
					.build()
					.getService();
		} catch (IOException ex) {
			throw new BigQueryExternalException(
					"Failed to load BigQuery credentials — check app.external.bigquery.credentials-json", ex);
		}
	}

	/**
	 * {@inheritDoc}
	 *
	 * <p>Executes the query and maps each row into a {@link LinkedHashMap} preserving column order.
	 * Bounded by {@link BigQueryProperties#getJobTimeoutMs()} both as the job's own deadline and as the
	 * SDK client's retry-total-timeout budget, so a hung job cannot pin the calling thread indefinitely.
	 *
	 * <p>Run as an explicitly created job rather than through {@code BigQuery#query}, which costs one extra
	 * HTTP round trip and buys two things worth more than it: the completed job carries its own statistics,
	 * so bytes, slot time and cache hits are recorded without a second call, and the job id exists even when
	 * the query fails - which is what makes a failure findable in BigQuery's own history.
	 *
	 * @throws BigQueryExternalException on query failure or SDK error
	 */
	@Override
	public List<Map<String, Object>> query(String sql) {
		log.debug("Running BigQuery query:\nproject = {},\ndataset = {},\nquery = {}",
				properties.getProjectId(), properties.getDataset(), sql);
		Timer.Sample sample = Timer.start(meterRegistry);
		String operation = operationContext.current();
		String outcome = OUTCOME_SUCCESS;
		Job submitted = null;
		Job finished = null;
		int rowCount = 0;
		try {
			submitted = bigQuery.create(JobInfo.of(queryConfig(sql, operation)));
			finished = awaitCompletion(submitted);
			requireSucceeded(finished);
			List<Map<String, Object>> rows = toRows(finished.getQueryResults());
			rowCount = rows.size();
			return rows;
		} catch (BigQueryExternalException ex) {
			outcome = OUTCOME_ERROR;
			throw ex;
		} catch (InterruptedException ex) {
			outcome = OUTCOME_ERROR;
			// Restored because this thread is serving a request that is now being abandoned, and whoever
			// interrupted it is entitled to see that its interruption took effect.
			Thread.currentThread().interrupt();
			throw new BigQueryExternalException("BigQuery query interrupted" + BigQueryJobs.suffix(submitted), ex);
		} catch (Exception ex) {
			outcome = OUTCOME_ERROR;
			throw new BigQueryExternalException("BigQuery query failed" + BigQueryJobs.suffix(submitted), ex);
		} finally {
			// Recorded here, not on the way out of the happy path: a query that hit a resource limit or a
			// runtime error spent bytes and slots getting there, and leaving those out of the distributions
			// would make every operation look cheaper than it is. A job that never came back has no
			// statistics to record, which is why this is conditional rather than best-effort.
			if (finished != null) {
				recordStatistics(finished, sql, operation, outcome, rowCount);
			}
			sample.stop(Timer.builder(METRIC_QUERY)
					.description("BigQuery read latency, by the operation that asked and the table it read")
					.tag(TAG_TABLE, classifyTable(sql))
					.tag(TAG_OPERATION, operation)
					.tag(TAG_OUTCOME, outcome)
					.register(meterRegistry));
		}
	}

	/**
	 * Builds the job configuration for one read.
	 *
	 * <p>The operation travels to BigQuery as a job label, which is what lets a cost query in
	 * {@code INFORMATION_SCHEMA.JOBS} group by what the Hub was doing rather than by table.
	 *
	 * @param sql       the standard SQL statement to run
	 * @param operation the operation this read belongs to
	 * @return the configured query job
	 */
	QueryJobConfiguration queryConfig(String sql, String operation) {
		QueryJobConfiguration.Builder config = QueryJobConfiguration.newBuilder(sql)
				.setUseLegacySql(false)
				.setLabels(Map.of(LABEL_OPERATION, operation))
				.setJobTimeoutMs(properties.getJobTimeoutMs());
		if (properties.getMaxBytesBilled() > 0) {
			config.setMaximumBytesBilled(properties.getMaxBytesBilled());
		}
		return config.build();
	}

	/**
	 * Waits for a submitted job to finish, within the configured timeout.
	 *
	 * <p>Deliberately does not judge the outcome: a job that finished badly still carries what it spent, and
	 * the caller has to be able to record that before throwing. See {@link #requireSucceeded}.
	 *
	 * @param job the submitted query job
	 * @return the same job, completed and carrying its statistics
	 * @throws InterruptedException       if the calling thread is interrupted while waiting
	 * @throws BigQueryExternalException  if the job no longer exists
	 */
	Job awaitCompletion(Job job) throws InterruptedException {
		Job finished = job.waitFor(RetryOption.totalTimeout(Duration.ofMillis(properties.getJobTimeoutMs())));
		if (finished == null) {
			// The SDK returns null when the job no longer exists, which is not the same as a failed job:
			// there is no error to report and no statistics to keep, only an id that leads nowhere.
			throw new BigQueryExternalException("BigQuery job no longer exists" + BigQueryJobs.suffix(job));
		}
		return finished;
	}

	/**
	 * Fails when a completed job completed with an error.
	 *
	 * @param finished the completed job
	 * @throws BigQueryExternalException naming the job and what BigQuery said about it
	 */
	void requireSucceeded(Job finished) {
		if (finished.getStatus() != null && finished.getStatus().getError() != null) {
			throw new BigQueryExternalException("BigQuery query failed" + BigQueryJobs.suffix(finished)
					+ ": " + finished.getStatus().getError().getMessage());
		}
	}

	/**
	 * Maps a result set into one column-ordered map per row.
	 *
	 * @param result the query result
	 * @return the mapped rows, never {@code null}
	 */
	List<Map<String, Object>> toRows(TableResult result) {
		List<Map<String, Object>> rows = new ArrayList<>();
		for (FieldValueList row : result.iterateAll()) {
			Map<String, Object> mapped = new LinkedHashMap<>();
			for (Field field : Objects.requireNonNull(result.getSchema()).getFields()) {
				mapped.put(field.getName(), extractValue(field, row.get(field.getName())));
			}
			rows.add(mapped);
		}
		return rows;
	}

	/**
	 * Records what the completed job actually cost, to the log and to the meter registry.
	 *
	 * <p>Wall-clock time alone cannot tell an expensive query from a slow one: a cached read and a
	 * full-history scan can take the same second. Bytes billed and slot milliseconds are what make the
	 * difference visible, and they exist only on the job.
	 *
	 * <p>Never throws. Losing a measurement must not lose the rows it was measuring.
	 *
	 * @param job       the completed query job
	 * @param sql       the statement it ran, for the table tag
	 * @param operation the operation this read belongs to
	 * @param outcome   whether the job succeeded, so a costly failure is not counted as a cheap success
	 * @param rowCount  how many rows were returned
	 */
	void recordStatistics(Job job, String sql, String operation, String outcome, int rowCount) {
		try {
			JobStatistics.QueryStatistics statistics = job.getStatistics();
			if (statistics == null) {
				return;
			}
			String table = classifyTable(sql);
			boolean cacheHit = Boolean.TRUE.equals(statistics.getCacheHit());
			log.info("BigQuery read finished: outcome={}, operation={}, job={}, table={}, rows={},"
							+ " bytesProcessed={}, bytesBilled={}, slotMs={}, cacheHit={}",
					outcome, operation, BigQueryJobs.id(job), table, rowCount,
					statistics.getTotalBytesProcessed(), statistics.getTotalBytesBilled(),
					statistics.getTotalSlotMs(), cacheHit);
			record(METRIC_BYTES_PROCESSED, "Bytes BigQuery read for one query", table, operation, outcome,
					statistics.getTotalBytesProcessed());
			record(METRIC_BYTES_BILLED, "Bytes BigQuery billed for one query", table, operation, outcome,
					statistics.getTotalBytesBilled());
			record(METRIC_SLOT_MS, "Slot milliseconds one query consumed", table, operation, outcome,
					statistics.getTotalSlotMs());
			record(METRIC_ROWS, "Rows one query returned", table, operation, outcome, (long) rowCount);
			meterRegistry.counter(METRIC_CACHE_HITS, TAG_TABLE, table, TAG_OPERATION, operation,
					TAG_OUTCOME, outcome, TAG_CACHE_HIT, String.valueOf(cacheHit)).increment();
		} catch (RuntimeException ex) {
			log.warn("Could not record BigQuery job statistics for job={}: {}",
					BigQueryJobs.id(job), ex.getMessage());
		}
	}

	/**
	 * Records one value on a table- and operation-tagged distribution, skipping the ones BigQuery left unset.
	 *
	 * @param name        the meter name
	 * @param description what the meter measures
	 * @param table       the queried table tag
	 * @param operation   the operation this read belongs to
	 * @param outcome     whether the job succeeded
	 * @param value       the measured value, or {@code null} when BigQuery reported none
	 */
	void record(String name, String description, String table, String operation, String outcome, Long value) {
		if (value == null) {
			return;
		}
		DistributionSummary.builder(name)
				.description(description)
				.tag(TAG_TABLE, table)
				.tag(TAG_OPERATION, operation)
				.tag(TAG_OUTCOME, outcome)
				.register(meterRegistry)
				.record(value);
	}


	/**
	 * Classifies a query's source for the {@code bigquery.query} timer's {@code table} tag, by checking
	 * which of the app's configured fully-qualified tables/views appears in the rendered SQL.
	 *
	 * @param sql the rendered SQL about to run
	 * @return a short tag identifying the queried table/view, or {@code "other"} when none match
	 */
	String classifyTable(String sql) {
		if (sql.contains(properties.getAdjustmentsView())) {
			return "adjustments_view";
		}
		if (sql.contains(properties.getIoLinesTable())) {
			return "io_lines";
		}
		if (sql.contains(properties.getRipplingEmployeesTable())) {
			return "rippling_employees";
		}
		if (sql.contains(properties.getWriteTable())) {
			return "write_table";
		}
		return "other";
	}

	/**
	 * Extracts the underlying value of a BigQuery cell. For a {@code REPEATED} (ARRAY) field the cell
	 * value is a list of {@link FieldValue} elements; this returns a {@link List} of their underlying
	 * values (e.g. {@code String}s) rather than the {@code FieldValue} wrappers, so callers do not see
	 * {@code FieldValue{...}} string representations. Scalar fields return their value directly.
	 *
	 * @param field the column schema (used to detect REPEATED mode)
	 * @param cell  the cell value
	 * @return the extracted value: a {@code List<Object>} for repeated fields, otherwise the scalar value
	 */
	private Object extractValue(Field field, FieldValue cell) {
		if (field.getMode() == Field.Mode.REPEATED) {
			List<Object> values = new ArrayList<>();
			for (FieldValue element : cell.getRepeatedValue()) {
				values.add(element.getValue());
			}
			return values;
		}
		return cell.getValue();
	}
}
