package com.aidigital.operationalhub.externalservices.bigquery.impl;

import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.google.cloud.bigquery.BigQuery;
import com.google.cloud.bigquery.BigQuery.JobOption;
import com.google.cloud.bigquery.Field;
import com.google.cloud.bigquery.FieldValue;
import com.google.cloud.bigquery.FieldValueList;
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
import static org.mockito.Mockito.mock;
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
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, new SimpleMeterRegistry());

		Schema schema = Schema.of(Field.of("id", StandardSQLTypeName.INT64));
		FieldValueList row = mock(FieldValueList.class);
		FieldValue idField = mock(FieldValue.class);
		when(row.get("id")).thenReturn(idField);
		when(idField.getValue()).thenReturn(1L);
		TableResult result = mock(TableResult.class);
		when(result.getSchema()).thenReturn(schema);
		when(result.iterateAll()).thenReturn(List.of(row));
		when(bigQuery.query(any(), any(JobOption.class))).thenReturn(result);

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
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, new SimpleMeterRegistry());

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
		when(bigQuery.query(any(), any(JobOption.class))).thenReturn(result);

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
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, new SimpleMeterRegistry());
		when(bigQuery.query(any(), any(JobOption.class))).thenThrow(new RuntimeException("boom"));

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
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, meterRegistry);
		TableResult result = mock(TableResult.class);
		when(result.iterateAll()).thenReturn(List.of());
		when(bigQuery.query(any(), any(JobOption.class))).thenReturn(result);

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
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, meterRegistry);
		when(bigQuery.query(any(), any(JobOption.class))).thenThrow(new RuntimeException("boom"));

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
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, new SimpleMeterRegistry());

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
		BigQueryClientImpl client = new BigQueryClientImpl(properties, bigQuery, new SimpleMeterRegistry());

		TableResult result = mock(TableResult.class);
		when(result.iterateAll()).thenReturn(List.of());
		ArgumentCaptor<QueryJobConfiguration> configCaptor = ArgumentCaptor.forClass(QueryJobConfiguration.class);
		when(bigQuery.query(configCaptor.capture(), any(JobOption.class))).thenReturn(result);

		// When:
		client.query("SELECT id FROM t");

		// Then: the job-level deadline carries the configured timeout
		assertThat(configCaptor.getValue().getJobTimeoutMs()).isEqualTo(45_000L);
	}

	@Test
	void shouldInitialiseFromCredentialsJsonStringTest() throws Exception {
		// Given: the service-account key provided inline as a JSON string (with a generated RSA key)
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		properties.setDataset("test_dataset");
		properties.setCredentialsJson(serviceAccountJson());

		// When/Then: the production constructor loads the credentials without throwing
		BigQueryClientImpl client = new BigQueryClientImpl(properties, new SimpleMeterRegistry());
		assertThat(client).isNotNull();
	}

	@Test
	void shouldFailWhenCredentialsCannotBeLoadedTest() {
		// Given: credentials JSON that is not a valid service-account key
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		properties.setCredentialsJson("{}");

		// When/Then:
		assertThatThrownBy(() -> new BigQueryClientImpl(properties, new SimpleMeterRegistry()))
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
