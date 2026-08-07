package com.aidigital.operationalhub.service.agency.bigquery.service;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryWriteClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.aidigital.operationalhub.service.exception.BusinessException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;

/**
 * Unit tests for {@link BigQueryWriteGateway}'s table-replacing write, which a dashboard's data source uses.
 */
@ExtendWith(MockitoExtension.class)
class BigQueryWriteGatewayTest {

	private static final String TABLE = "proj.gs_templates.acme_7_report_basic";

	@Mock
	private BigQueryWriteClient bigQueryWriteClient;

	@Mock
	private BigQueryProperties bigQueryProperties;

	@InjectMocks
	private BigQueryWriteGateway gateway;

	@Test
	void shouldReplaceTheTableRatherThanAppendToItTest() {
		// Given:
		doReturn(600_000L).when(bigQueryProperties).getTableWriteTimeoutMs();
		doReturn(0L).when(bigQueryWriteClient).execute(anyString(), anyLong());

		// When:
		gateway.replaceTable(TABLE, "SELECT 1 AS one");

		// Then: a second run has to refresh the data source, not double every figure on the dashboard, and the
		// budget is the table-write one - a read's seconds would time this out on any campaign of size
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		ArgumentCaptor<Long> timeout = ArgumentCaptor.forClass(Long.class);
		verify(bigQueryWriteClient).execute(sql.capture(), timeout.capture());
		assertThat(sql.getValue()).isEqualTo("CREATE OR REPLACE TABLE `" + TABLE + "` AS\nSELECT 1 AS one");
		assertThat(timeout.getValue()).isEqualTo(600_000L);
	}

	@Test
	void shouldCarryBigQuerysOwnReasonWhenTheWriteFailsTest() {
		// Given: the SDK's message, which is the only text that says what actually went wrong
		BigQueryExternalException failure = new BigQueryExternalException(
				"BigQuery write failed", new IllegalStateException("Access Denied: Table proj.gs_templates"));
		doReturn(600_000L).when(bigQueryProperties).getTableWriteTimeoutMs();
		doThrow(failure).when(bigQueryWriteClient).execute(anyString(), anyLong());

		// When-Then:
		assertThatThrownBy(() -> gateway.replaceTable(TABLE, "SELECT 1 AS one"))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_026")
				.hasMessageContaining("Access Denied");
	}
}
