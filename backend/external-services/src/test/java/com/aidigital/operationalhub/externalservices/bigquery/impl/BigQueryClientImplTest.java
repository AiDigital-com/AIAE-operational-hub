package com.aidigital.operationalhub.externalservices.bigquery.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryOperationContext;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.google.cloud.RetryOption;
import com.google.cloud.bigquery.BigQuery;
import com.google.cloud.bigquery.BigQueryError;
import com.google.cloud.bigquery.Field;
import com.google.cloud.bigquery.FieldValue;
import com.google.cloud.bigquery.FieldValueList;
import com.google.cloud.bigquery.Job;
import com.google.cloud.bigquery.JobId;
import com.google.cloud.bigquery.JobInfo;
import com.google.cloud.bigquery.JobStatistics;
import com.google.cloud.bigquery.JobStatus;
import com.google.cloud.bigquery.QueryJobConfiguration;
import com.google.cloud.bigquery.Schema;
import com.google.cloud.bigquery.StandardSQLTypeName;
import com.google.cloud.bigquery.TableResult;
import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link BigQueryClientImpl} using a mocked BigQuery SDK service.
 */
@ExtendWith(MockitoExtension.class)
class BigQueryClientImplTest {

	@Mock
	private BigQuery bigQuery;

	@Test
	void shouldMapQueryRowsToColumnMapsTest() throws Exception {
		// Given:
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		properties.setDataset("test_dataset");
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, new SimpleMeterRegistry(),
				new BigQueryOperationContext());

		Schema schema = Schema.of(Field.of("id", StandardSQLTypeName.INT64));
		FieldValueList row = mock(FieldValueList.class);
		FieldValue idField = mock(FieldValue.class);
		when(row.get("id")).thenReturn(idField);
		when(idField.getValue()).thenReturn(1L);
		TableResult result = mock(TableResult.class);
		when(result.getSchema()).thenReturn(schema);
		when(result.iterateAll()).thenReturn(List.of(row));
		Job job = mock(Job.class);
		when(bigQuery.create(any(JobInfo.class))).thenReturn(job);
		when(job.waitFor(any(RetryOption.class))).thenReturn(job);
		when(job.getQueryResults()).thenReturn(result);

		// When:
		List<Map<String, Object>> rows = client.query("SELECT id FROM t");

		// Then:
		assertThat(rows).hasSize(1);
		assertThat(rows.get(0)).containsEntry("id", 1L);
	}

	@Test
	void shouldExtractRepeatedFieldValuesAsAPlainListTest() throws Exception {
		// Given: a REPEATED (ARRAY) column whose cell holds FieldValue elements
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, new SimpleMeterRegistry(),
				new BigQueryOperationContext());

		Schema schema = Schema.of(
				Field.newBuilder("channels", StandardSQLTypeName.STRING).setMode(Field.Mode.REPEATED).build());
		FieldValue display = mock(FieldValue.class);
		when(display.getValue()).thenReturn("Display");
		FieldValue video = mock(FieldValue.class);
		when(video.getValue()).thenReturn("Video");
		FieldValue channelsCell = mock(FieldValue.class);
		when(channelsCell.getRepeatedValue()).thenReturn(List.of(display, video));
		FieldValueList row = mock(FieldValueList.class);
		when(row.get("channels")).thenReturn(channelsCell);
		TableResult result = mock(TableResult.class);
		when(result.getSchema()).thenReturn(schema);
		when(result.iterateAll()).thenReturn(List.of(row));
		Job job = mock(Job.class);
		when(bigQuery.create(any(JobInfo.class))).thenReturn(job);
		when(job.waitFor(any(RetryOption.class))).thenReturn(job);
		when(job.getQueryResults()).thenReturn(result);

		// When:
		List<Map<String, Object>> rows = client.query("SELECT channels FROM t");

		// Then: the array cell is a plain list of underlying values, not FieldValue wrappers
		assertThat(rows).hasSize(1);
		assertThat(rows.get(0).get("channels")).isEqualTo(List.of("Display", "Video"));
	}

	@Test
	void shouldWrapSdkFailuresInBigQueryExternalExceptionTest() throws Exception {
		// Given:
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, new SimpleMeterRegistry(),
				new BigQueryOperationContext());
		when(bigQuery.create(any(JobInfo.class))).thenThrow(new RuntimeException("boom"));

		// When/Then:
		assertThatThrownBy(() -> client.query("SELECT 1"))
				.isInstanceOf(BigQueryExternalException.class)
				.hasMessageContaining("BigQuery query failed");
	}

	@Test
	void shouldRecordATimerTaggedByOutcomeAndQueriedTableTest() throws Exception {
		// Given: a query against the configured adjustments view
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		properties.setAdjustmentsView("proj.dataset.adjustments_view");
		SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, meterRegistry,
				new BigQueryOperationContext());
		TableResult result = mock(TableResult.class);
		when(result.iterateAll()).thenReturn(List.of());
		Job job = mock(Job.class);
		when(bigQuery.create(any(JobInfo.class))).thenReturn(job);
		when(job.waitFor(any(RetryOption.class))).thenReturn(job);
		when(job.getQueryResults()).thenReturn(result);

		// When:
		client.query("SELECT * FROM `proj.dataset.adjustments_view`");

		// Then: one bigquery.query timer sample, tagged by the matched table and a success outcome
		Timer timer = meterRegistry.find("bigquery.query")
				.tag("table", "adjustments_view")
				.tag("outcome", "success")
				.timer();
		assertThat(timer).isNotNull();
		assertThat(timer.count()).isEqualTo(1);
	}

	@Test
	void shouldRecordAnErrorOutcomeTimerWhenTheQueryFailsTest() throws Exception {
		// Given:
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, meterRegistry,
				new BigQueryOperationContext());
		when(bigQuery.create(any(JobInfo.class))).thenThrow(new RuntimeException("boom"));

		// When:
		assertThatThrownBy(() -> client.query("SELECT 1")).isInstanceOf(BigQueryExternalException.class);

		// Then: the timer still records, tagged with an error outcome
		Timer timer = meterRegistry.find("bigquery.query").tag("outcome", "error").timer();
		assertThat(timer).isNotNull();
		assertThat(timer.count()).isEqualTo(1);
	}

	@Test
	void shouldClassifyAQueryByWhichConfiguredTableItReadsTest() {
		// Given:
		BigQueryProperties properties = new BigQueryProperties();
		properties.setIoLinesTable("proj.dataset.io_lines");
		properties.setRipplingEmployeesTable("proj.dataset.rippling_employees");
		properties.setAdjustmentsView("proj.dataset.adjustments_view");
		properties.setWriteTable("proj.dataset.write_table");
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, new SimpleMeterRegistry(),
				new BigQueryOperationContext());

		// When/Then:
		assertThat(client.classifyTable("SELECT * FROM `proj.dataset.io_lines`")).isEqualTo("io_lines");
		assertThat(client.classifyTable("SELECT * FROM `proj.dataset.rippling_employees`"))
				.isEqualTo("rippling_employees");
		assertThat(client.classifyTable("SELECT * FROM `proj.dataset.adjustments_view`"))
				.isEqualTo("adjustments_view");
		assertThat(client.classifyTable("SELECT * FROM `proj.dataset.write_table`")).isEqualTo("write_table");
		assertThat(client.classifyTable("SELECT 1")).isEqualTo("other");
	}

	@Test
	void shouldApplyTheConfiguredJobTimeoutTest() throws Exception {
		// Given:
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		properties.setJobTimeoutMs(45_000);
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, new SimpleMeterRegistry(),
				new BigQueryOperationContext());

		TableResult result = mock(TableResult.class);
		when(result.iterateAll()).thenReturn(List.of());
		ArgumentCaptor<JobInfo> jobCaptor = ArgumentCaptor.forClass(JobInfo.class);
		Job job = mock(Job.class);
		when(bigQuery.create(any(JobInfo.class))).thenReturn(job);
		when(job.waitFor(any(RetryOption.class))).thenReturn(job);
		when(job.getQueryResults()).thenReturn(result);

		// When:
		client.query("SELECT id FROM t");

		// Then: the job-level deadline carries the configured timeout
		verify(bigQuery).create(jobCaptor.capture());
		QueryJobConfiguration config = jobCaptor.getValue().getConfiguration();
		assertThat(config.getJobTimeoutMs()).isEqualTo(45_000L);
	}

	@Test
	void shouldRecordWhatTheCompletedJobActuallyCostTest() throws Exception {
		// Given: a completed job reporting bytes, slot time and a cache hit
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		properties.setAdjustmentsView("proj.dataset.adjustments_view");
		SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, meterRegistry,
				new BigQueryOperationContext());
		TableResult result = mock(TableResult.class);
		when(result.iterateAll()).thenReturn(List.of());
		JobStatistics.QueryStatistics statistics = mock(JobStatistics.QueryStatistics.class);
		when(statistics.getTotalBytesProcessed()).thenReturn(4_000L);
		when(statistics.getTotalBytesBilled()).thenReturn(10_485_760L);
		when(statistics.getTotalSlotMs()).thenReturn(1_234L);
		when(statistics.getCacheHit()).thenReturn(true);
		Job job = mock(Job.class);
		when(bigQuery.create(any(JobInfo.class))).thenReturn(job);
		when(job.waitFor(any(RetryOption.class))).thenReturn(job);
		when(job.getQueryResults()).thenReturn(result);
		doReturn(statistics).when(job).getStatistics();

		// When:
		client.query("SELECT * FROM `proj.dataset.adjustments_view`");

		// Then: wall-clock time alone could not tell this read from an expensive one
		assertThat(meterRegistry.find("bigquery.query.bytes.processed").tag("table", "adjustments_view")
				.summary().totalAmount()).isEqualTo(4_000.0);
		assertThat(meterRegistry.find("bigquery.query.bytes.billed").tag("table", "adjustments_view")
				.summary().totalAmount()).isEqualTo(10_485_760.0);
		assertThat(meterRegistry.find("bigquery.query.slot.ms").tag("table", "adjustments_view")
				.summary().totalAmount()).isEqualTo(1_234.0);
		assertThat(meterRegistry.find("bigquery.query.cache").tag("cacheHit", "true").counter().count())
				.isEqualTo(1.0);
	}

	@Test
	void shouldStillReturnTheRowsWhenTheJobCarriesNoStatisticsTest() throws Exception {
		// Given: a job whose statistics BigQuery did not populate
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, meterRegistry,
				new BigQueryOperationContext());
		Schema schema = Schema.of(Field.of("id", StandardSQLTypeName.INT64));
		FieldValue idField = mock(FieldValue.class);
		when(idField.getValue()).thenReturn(7L);
		FieldValueList row = mock(FieldValueList.class);
		when(row.get("id")).thenReturn(idField);
		TableResult result = mock(TableResult.class);
		when(result.getSchema()).thenReturn(schema);
		when(result.iterateAll()).thenReturn(List.of(row));
		Job job = mock(Job.class);
		when(bigQuery.create(any(JobInfo.class))).thenReturn(job);
		when(job.waitFor(any(RetryOption.class))).thenReturn(job);
		when(job.getQueryResults()).thenReturn(result);

		// When:
		List<Map<String, Object>> rows = client.query("SELECT id FROM t");

		// Then: losing a measurement must not lose the rows it was measuring
		assertThat(rows).hasSize(1);
		assertThat(meterRegistry.find("bigquery.query.bytes.billed").summary()).isNull();
	}

	@Test
	void shouldNameTheFailedJobSoItCanBeFoundInBigQueryHistoryTest() throws Exception {
		// Given: a job that finished with an error
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, new SimpleMeterRegistry(),
				new BigQueryOperationContext());
		JobStatus status = mock(JobStatus.class);
		when(status.getError()).thenReturn(new BigQueryError("invalidQuery", null, "Unrecognized name: nope"));
		Job job = mock(Job.class);
		when(bigQuery.create(any(JobInfo.class))).thenReturn(job);
		when(job.waitFor(any(RetryOption.class))).thenReturn(job);
		when(job.getStatus()).thenReturn(status);
		when(job.getJobId()).thenReturn(JobId.of("test-project", "job-123"));

		// When-Then:
		assertThatThrownBy(() -> client.query("SELECT nope FROM t"))
				.isInstanceOf(BigQueryExternalException.class)
				.hasMessageContaining("job=job-123")
				.hasMessageContaining("Unrecognized name");
	}

	@Test
	void shouldLeaveTheBytesBilledCeilingUnsetUntilItIsConfiguredTest() throws Exception {
		// Given: the default configuration, which sets no ceiling
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, new SimpleMeterRegistry(),
				new BigQueryOperationContext());

		// When:
		QueryJobConfiguration unbounded = client.queryConfig("SELECT 1", "get_report_rows");
		properties.setMaxBytesBilled(100_000_000L);
		QueryJobConfiguration bounded = client.queryConfig("SELECT 1", "get_report_rows");

		// Then: a ceiling that rejects a legitimate report is worse than an expensive one, so it is opt-in
		assertThat(unbounded.getMaximumBytesBilled()).isNull();
		assertThat(bounded.getMaximumBytesBilled()).isEqualTo(100_000_000L);
	}

	@Test
	void shouldLabelTheJobWithTheOperationThatAskedForItTest() throws Exception {
		// Given: a request-scoped operation name, as the interceptor sets at the edge
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		properties.setAdjustmentsView("proj.dataset.adjustments_view");
		SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
		BigQueryOperationContext operationContext = new BigQueryOperationContext();
		operationContext.set("get_report_rows");
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, meterRegistry, operationContext);
		TableResult result = mock(TableResult.class);
		when(result.iterateAll()).thenReturn(List.of());
		JobStatistics.QueryStatistics statistics = mock(JobStatistics.QueryStatistics.class);
		when(statistics.getTotalBytesBilled()).thenReturn(1_024L);
		Job job = mock(Job.class);
		ArgumentCaptor<JobInfo> jobCaptor = ArgumentCaptor.forClass(JobInfo.class);
		when(bigQuery.create(jobCaptor.capture())).thenReturn(job);
		when(job.waitFor(any(RetryOption.class))).thenReturn(job);
		when(job.getQueryResults()).thenReturn(result);
		doReturn(statistics).when(job).getStatistics();

		// When:
		client.query("SELECT * FROM `proj.dataset.adjustments_view`");

		// Then: BigQuery's own job history can group cost by what the Hub was doing, not only by table
		QueryJobConfiguration config = jobCaptor.getValue().getConfiguration();
		assertThat(config.getLabels()).containsEntry("oph_operation", "get_report_rows");
		assertThat(meterRegistry.find("bigquery.query.bytes.billed").tag("operation", "get_report_rows")
				.summary().totalAmount()).isEqualTo(1_024.0);
		assertThat(meterRegistry.find("bigquery.query").tag("operation", "get_report_rows").timer().count())
				.isEqualTo(1);
	}

	@Test
	void shouldLabelAJobNobodyNamedAsUnlabelledTest() throws Exception {
		// Given: a query run off any request thread, so nothing named the operation
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, new SimpleMeterRegistry(),
				new BigQueryOperationContext());

		// When:
		QueryJobConfiguration config = client.queryConfig("SELECT 1", new BigQueryOperationContext().current());

		// Then: a missing label must not stop a query
		assertThat(config.getLabels()).containsEntry("oph_operation", "unlabelled");
	}

	@Test
	void shouldRecordWhatAFailedJobSpentBeforeItFailedTest() throws Exception {
		// Given: a job that burned bytes and slots and then hit a resource limit
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		properties.setAdjustmentsView("proj.dataset.adjustments_view");
		SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();
		BigQueryOperationContext operationContext = new BigQueryOperationContext();
		operationContext.set("get_report_rows");
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, meterRegistry, operationContext);
		JobStatistics.QueryStatistics statistics = mock(JobStatistics.QueryStatistics.class);
		when(statistics.getTotalBytesBilled()).thenReturn(21_474_836_480L);
		when(statistics.getTotalSlotMs()).thenReturn(4_000_000L);
		JobStatus status = mock(JobStatus.class);
		when(status.getError()).thenReturn(new BigQueryError("resourcesExceeded", null, "Query exceeded resources"));
		Job job = mock(Job.class);
		when(bigQuery.create(any(JobInfo.class))).thenReturn(job);
		when(job.waitFor(any(RetryOption.class))).thenReturn(job);
		when(job.getStatus()).thenReturn(status);
		when(job.getJobId()).thenReturn(JobId.of("test-project", "job-777"));
		doReturn(statistics).when(job).getStatistics();

		// When-Then: the caller still sees the failure, named after its job
		assertThatThrownBy(() -> client.query("SELECT * FROM `proj.dataset.adjustments_view`"))
				.isInstanceOf(BigQueryExternalException.class)
				.hasMessageContaining("job=job-777");

		// And the cost is recorded under an error outcome: a distribution that counts only successes
		// describes a cheaper Hub than the one being billed for
		assertThat(meterRegistry.find("bigquery.query.bytes.billed").tag("outcome", "error")
				.summary().totalAmount()).isEqualTo(21_474_836_480.0);
		assertThat(meterRegistry.find("bigquery.query.slot.ms").tag("outcome", "error")
				.summary().totalAmount()).isEqualTo(4_000_000.0);
		assertThat(meterRegistry.find("bigquery.query.bytes.billed").tag("outcome", "success").summary())
				.isNull();
	}

	@Test
	void shouldNameTheSubmittedJobWhenTheWaitIsInterruptedTest() throws Exception {
		// Given: a wait interrupted while the job is running
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, new SimpleMeterRegistry(),
				new BigQueryOperationContext());
		Job job = mock(Job.class);
		when(bigQuery.create(any(JobInfo.class))).thenReturn(job);
		when(job.getJobId()).thenReturn(JobId.of("test-project", "job-888"));
		when(job.waitFor(any(RetryOption.class))).thenThrow(new InterruptedException("abandoned"));

        // When-Then: the failure names the job that is still running in BigQuery
		try {
			assertThatThrownBy(() -> client.query("SELECT 1"))
					.isInstanceOf(BigQueryExternalException.class)
					.hasMessageContaining("interrupted")
					.hasMessageContaining("job=job-888");

			// And the thread's interrupt flag survives, so whoever interrupted it sees it took effect
			assertThat(Thread.currentThread().isInterrupted()).isTrue();
		} finally {
			// Cleared so the flag does not leak into the next test on this thread.
			Thread.interrupted();
		}
	}

	@Test
	void shouldInitialiseFromCredentialsJsonStringTest() throws Exception {
		// Given: the service-account key provided inline as a JSON string (with a generated RSA key)
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		properties.setDataset("test_dataset");
		properties.setCredentialsJson(serviceAccountJson());

		// When/Then: the production constructor loads the credentials without throwing
		BigQueryClientImpl client = new BigQueryClientImpl(properties, new SimpleMeterRegistry(), new BigQueryOperationContext());
		assertThat(client).isNotNull();
	}

	@Test
	void shouldFailWhenCredentialsCannotBeLoadedTest() {
		// Given: credentials JSON that is not a valid service-account key
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		properties.setCredentialsJson("{}");

		// When/Then:
		assertThatThrownBy(() -> new BigQueryClientImpl(properties, new SimpleMeterRegistry(), new BigQueryOperationContext()))
				.isInstanceOf(BigQueryExternalException.class)
				.hasMessageContaining("Failed to load BigQuery credentials");
	}

	private String serviceAccountJson() throws Exception {
		KeyPairGenerator keyPairGenerator = KeyPairGenerator.getInstance("RSA");
		keyPairGenerator.initialize(2048);
		KeyPair keyPair = keyPairGenerator.generateKeyPair();
		String privateKeyPem = "-----BEGIN PRIVATE KEY-----\n"
				+ Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(keyPair.getPrivate().getEncoded())
				+ "\n-----END PRIVATE KEY-----\n";
		return """
				{
				  "type": "service_account",
				  "project_id": "test-project",
				  "private_key_id": "key-1",
				  "private_key": "%s",
				  "client_email": "test@test-project.iam.gserviceaccount.com",
				  "client_id": "1234567890",
				  "token_uri": "https://oauth2.googleapis.com/token"
				}
				""".formatted(privateKeyPem.replace("\n", "\\n"));
	}
}
