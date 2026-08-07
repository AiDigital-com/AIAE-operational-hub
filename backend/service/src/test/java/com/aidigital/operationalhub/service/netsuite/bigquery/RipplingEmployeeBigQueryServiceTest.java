package com.aidigital.operationalhub.service.netsuite.bigquery;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.CachedBigQuerySearchExecutor;
import com.aidigital.operationalhub.service.netsuite.model.RipplingEmployee;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link RipplingEmployeeBigQueryService}, which builds the active-employees query via
 * {@link com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest} over a mocked client.
 */
@ExtendWith(MockitoExtension.class)
class RipplingEmployeeBigQueryServiceTest {

	@Mock
	private BigQueryClient bigQueryClient;

	@Mock
	private BigQueryProperties bigQueryProperties;

	private RipplingEmployeeBigQueryService service;

	@BeforeEach
	void setUp() {
		service = new RipplingEmployeeBigQueryService(
				new BigQuerySearchGateway(bigQueryClient, bigQueryProperties,
						new CachedBigQuerySearchExecutor(bigQueryClient)),
				bigQueryProperties);
	}

	@Test
	void shouldLoadActiveEmployeesWithTrimmedValuesTest() {
		// Given:
		when(bigQueryProperties.getRipplingEmployeesTable()).thenReturn("proj.ds.rippling");
		when(bigQueryClient.query(any())).thenReturn(List.of(
				Map.of("employee", " Jane Lead ", "department", "Pod A", "work_email", "jane@example.com",
						"teams", " HOUSE , MPO Team Leads ", "title", " Team Lead, Media Optimization ",
						"manager", " Gerel Mutulova ")));

		// When:
		List<RipplingEmployee> result = service.loadActiveEmployees();

		// Verification:
		assertThat(result).hasSize(1);
		assertThat(result.get(0).name()).isEqualTo("Jane Lead");
		assertThat(result.get(0).department()).isEqualTo("Pod A");
		assertThat(result.get(0).workEmail()).isEqualTo("jane@example.com");
		assertThat(result.get(0).teams()).isEqualTo("HOUSE , MPO Team Leads");
		assertThat(result.get(0).title()).isEqualTo("Team Lead, Media Optimization");
		assertThat(result.get(0).manager()).isEqualTo("Gerel Mutulova");

		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(sql.getValue())
				.contains("FROM `proj.ds.rippling`")
				.contains("ANY_VALUE(`employee`)")
				.contains("ANY_VALUE(`teams`)")
				.contains("ANY_VALUE(`title`)")
				.contains("ANY_VALUE(`manager`)")
				.contains("`employment_status` = 'Active'")
				.contains("`work_email` IS NOT NULL")
				.contains("GROUP BY `work_email`");
	}
}
