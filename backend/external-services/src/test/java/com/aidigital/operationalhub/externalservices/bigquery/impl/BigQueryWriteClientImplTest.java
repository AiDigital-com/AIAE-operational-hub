package com.aidigital.operationalhub.externalservices.bigquery.impl;

import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.google.cloud.RetryOption;
import com.google.cloud.bigquery.BigQuery;
import com.google.cloud.bigquery.BigQueryError;
import com.google.cloud.bigquery.Job;
import com.google.cloud.bigquery.JobInfo;
import com.google.cloud.bigquery.JobStatistics;
import com.google.cloud.bigquery.JobStatus;
import com.google.cloud.bigquery.QueryJobConfiguration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link BigQueryWriteClientImpl} using a mocked BigQuery SDK service.
 */
@ExtendWith(MockitoExtension.class)
class BigQueryWriteClientImplTest {

	@Mock
	private BigQuery bigQuery;

	@Mock
	private Job job;

	@Mock
	private JobStatus jobStatus;

	@Mock
	private JobStatistics.QueryStatistics queryStatistics;

	@Test
	void shouldRunDmlAsANonLegacyJobAndReturnAffectedRowsTest() throws Exception {
		// Given:
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		properties.setDataset("test_dataset");
		BigQueryWriteClientImpl client = new BigQueryWriteClientImpl(properties, bigQuery);
		ArgumentCaptor<JobInfo> jobInfoCaptor = ArgumentCaptor.forClass(JobInfo.class);
		when(bigQuery.create(jobInfoCaptor.capture())).thenReturn(job);
		when(job.waitFor(any(RetryOption.class))).thenReturn(job);
		when(job.getStatus()).thenReturn(jobStatus);
		when(jobStatus.getError()).thenReturn(null);
		when(job.getStatistics()).thenReturn(queryStatistics);
		when(queryStatistics.getNumDmlAffectedRows()).thenReturn(3L);

		// When:
		long affected = client.execute("INSERT INTO `t` (`a`) VALUES (1)");

		// Then:
		assertThat(affected).isEqualTo(3L);
		QueryJobConfiguration config = jobInfoCaptor.getValue().getConfiguration();
		assertThat(config.getQuery()).isEqualTo("INSERT INTO `t` (`a`) VALUES (1)");
		assertThat(config.useLegacySql()).isFalse();
	}

	@Test
	void shouldReturnZeroWhenStatisticsReportNoAffectedRowsTest() throws Exception {
		// Given:
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		BigQueryWriteClientImpl client = new BigQueryWriteClientImpl(properties, bigQuery);
		when(bigQuery.create(any(JobInfo.class))).thenReturn(job);
		when(job.waitFor(any(RetryOption.class))).thenReturn(job);
		when(job.getStatus()).thenReturn(jobStatus);
		when(jobStatus.getError()).thenReturn(null);
		when(job.getStatistics()).thenReturn(queryStatistics);
		when(queryStatistics.getNumDmlAffectedRows()).thenReturn(null);

		// When:
		long affected = client.execute("INSERT INTO `t` (`a`) VALUES (1)");

		// Then:
		assertThat(affected).isZero();
	}

	@Test
	void shouldThrowWhenTheJobCompletesWithAnErrorTest() throws Exception {
		// Given:
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		BigQueryWriteClientImpl client = new BigQueryWriteClientImpl(properties, bigQuery);
		BigQueryError error = mock(BigQueryError.class);
		when(bigQuery.create(any(JobInfo.class))).thenReturn(job);
		when(job.waitFor(any(RetryOption.class))).thenReturn(job);
		when(job.getStatus()).thenReturn(jobStatus);
		when(jobStatus.getError()).thenReturn(error);

		// When/Then:
		assertThatThrownBy(() -> client.execute("INSERT INTO `t` (`a`) VALUES (1)"))
				.isInstanceOf(BigQueryExternalException.class)
				.hasMessageContaining("BigQuery write job failed");
	}

	@Test
	void shouldThrowWhenTheJobNoLongerExistsAfterWaitingTest() throws Exception {
		// Given:
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		BigQueryWriteClientImpl client = new BigQueryWriteClientImpl(properties, bigQuery);
		when(bigQuery.create(any(JobInfo.class))).thenReturn(job);
		when(job.waitFor(any(RetryOption.class))).thenReturn(null);

		// When/Then:
		assertThatThrownBy(() -> client.execute("INSERT INTO `t` (`a`) VALUES (1)"))
				.isInstanceOf(BigQueryExternalException.class)
				.hasMessageContaining("no longer exists");
	}

	@Test
	void shouldWrapSdkFailuresInBigQueryExternalExceptionTest() {
		// Given:
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		BigQueryWriteClientImpl client = new BigQueryWriteClientImpl(properties, bigQuery);
		when(bigQuery.create(any(JobInfo.class))).thenThrow(new RuntimeException("boom"));

		// When/Then:
		assertThatThrownBy(() -> client.execute("INSERT INTO `t` (`a`) VALUES (1)"))
				.isInstanceOf(BigQueryExternalException.class)
				.hasMessageContaining("BigQuery write statement failed");
	}

	@Test
	void shouldApplyTheConfiguredJobTimeoutTest() throws Exception {
		// Given:
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		properties.setJobTimeoutMs(45_000);
		BigQueryWriteClientImpl client = new BigQueryWriteClientImpl(properties, bigQuery);
		ArgumentCaptor<JobInfo> jobInfoCaptor = ArgumentCaptor.forClass(JobInfo.class);
		when(bigQuery.create(jobInfoCaptor.capture())).thenReturn(job);
		when(job.waitFor(any(RetryOption.class))).thenReturn(job);
		when(job.getStatus()).thenReturn(jobStatus);
		when(jobStatus.getError()).thenReturn(null);
		when(job.getStatistics()).thenReturn(queryStatistics);
		when(queryStatistics.getNumDmlAffectedRows()).thenReturn(1L);

		// When:
		client.execute("INSERT INTO `t` (`a`) VALUES (1)");

		// Then: the job-level deadline carries the configured timeout
		QueryJobConfiguration config = jobInfoCaptor.getValue().getConfiguration();
		assertThat(config.getJobTimeoutMs()).isEqualTo(45_000L);
	}

	@Test
	void shouldInitialiseFromCredentialsJsonStringTest() throws Exception {
		// Given: the service-account key provided inline as a JSON string (with a generated RSA key)
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		properties.setDataset("test_dataset");
		properties.setCredentialsJson(serviceAccountJson());

		// When/Then: the production constructor loads the credentials without throwing
		BigQueryWriteClientImpl client = new BigQueryWriteClientImpl(properties);
		assertThat(client).isNotNull();
	}

	@Test
	void shouldFailWhenCredentialsCannotBeLoadedTest() {
		// Given: credentials JSON that is not a valid service-account key
		BigQueryProperties properties = new BigQueryProperties();
		properties.setProjectId("test-project");
		properties.setCredentialsJson("{}");

		// When/Then:
		assertThatThrownBy(() -> new BigQueryWriteClientImpl(properties))
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
