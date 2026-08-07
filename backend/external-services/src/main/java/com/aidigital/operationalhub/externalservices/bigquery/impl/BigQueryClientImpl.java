package com.aidigital.operationalhub.externalservices.bigquery.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.RetryOption;
import com.google.cloud.bigquery.BigQuery;
import com.google.cloud.bigquery.BigQuery.JobOption;
import com.google.cloud.bigquery.BigQueryOptions;
import com.google.cloud.bigquery.Field;
import com.google.cloud.bigquery.FieldValue;
import com.google.cloud.bigquery.FieldValueList;
import com.google.cloud.bigquery.QueryJobConfiguration;
import com.google.cloud.bigquery.TableResult;
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

	private final BigQueryProperties properties;
	private final BigQuery bigQuery;
	private final MeterRegistry meterRegistry;

	/**
	 * Constructs the client and authenticates using the configured service-account JSON string.
	 *
	 * @param properties    BigQuery configuration (project ID, dataset, credentials JSON)
	 * @param meterRegistry registry the per-query {@code bigquery.query} timer is recorded against
	 * @throws BigQueryExternalException when credentials cannot be loaded
	 */
	public BigQueryClientImpl(BigQueryProperties properties, MeterRegistry meterRegistry) {
		this.properties = properties;
		this.meterRegistry = meterRegistry;
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
	 * @throws BigQueryExternalException on query failure or SDK error
	 */
	@Override
	public List<Map<String, Object>> query(String sql) {
		log.debug("Running BigQuery query:\nproject = {},\ndataset = {},\nquery = {}",
				properties.getProjectId(), properties.getDataset(), sql);
		Timer.Sample sample = Timer.start(meterRegistry);
		String outcome = "success";
		try {
			QueryJobConfiguration config = QueryJobConfiguration.newBuilder(sql)
					.setUseLegacySql(false)
					.setJobTimeoutMs(properties.getJobTimeoutMs())
					.build();
			TableResult result = bigQuery.query(config, JobOption.retryOptions(
					RetryOption.totalTimeout(Duration.ofMillis(properties.getJobTimeoutMs()))));
			List<Map<String, Object>> rows = new ArrayList<>();
			for (FieldValueList row : result.iterateAll()) {
				Map<String, Object> mapped = new LinkedHashMap<>();
				for (Field field : Objects.requireNonNull(result.getSchema()).getFields()) {
					mapped.put(field.getName(), extractValue(field, row.get(field.getName())));
				}
				rows.add(mapped);
			}
			return rows;
		} catch (BigQueryExternalException ex) {
			outcome = "error";
			throw ex;
		} catch (Exception ex) {
			outcome = "error";
			throw new BigQueryExternalException("BigQuery query failed", ex);
		} finally {
			sample.stop(Timer.builder("bigquery.query")
					.description("BigQuery read latency, tagged by which configured table/view the query reads from")
					.tag("table", classifyTable(sql))
					.tag("outcome", outcome)
					.register(meterRegistry));
		}
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
