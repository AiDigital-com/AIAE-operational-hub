package com.aidigital.operationalhub.service.netsuite.bigquery;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.CachedBigQuerySearchExecutor;
import com.aidigital.operationalhub.service.netsuite.model.AgencyLead;
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
 * Unit tests for {@link AgencyLeadBigQueryService}, which builds the per-agency lead query via
 * {@link com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest} over a mocked client.
 */
@ExtendWith(MockitoExtension.class)
class AgencyLeadBigQueryServiceTest {

	@Mock
	private BigQueryClient bigQueryClient;

	@Mock
	private BigQueryProperties bigQueryProperties;

	private AgencyLeadBigQueryService service;

	@BeforeEach
	void setUp() {
		service = new AgencyLeadBigQueryService(new BigQuerySearchGateway(
				bigQueryClient, bigQueryProperties, new CachedBigQuerySearchExecutor(bigQueryClient)));
	}

	@Test
	void shouldLoadOneLeadPerAgencyTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("proj.ds.io_lines");
		when(bigQueryClient.query(any())).thenReturn(List.of(
				Map.of("agency_id", 500L, "mpo_team_lead", " Jane Lead ")));

		// When:
		List<AgencyLead> result = service.loadAgencyLeads();

		// Verification:
		assertThat(result).hasSize(1);
		assertThat(result.get(0).agencyId()).isEqualTo(500L);
		assertThat(result.get(0).mpoTeamLead()).isEqualTo("Jane Lead");

		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(sql.getValue())
				.contains("FROM `proj.ds.io_lines`")
				.contains("ANY_VALUE(`mpo_team_lead`)")
				.contains("`agency_id` IS NOT NULL")
				.contains("GROUP BY `agency_id`");
	}
}
