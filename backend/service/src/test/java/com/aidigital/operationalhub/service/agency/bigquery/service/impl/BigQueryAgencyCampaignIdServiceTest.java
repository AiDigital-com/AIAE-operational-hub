package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.CachedBigQuerySearchExecutor;
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
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link BigQueryAgencyCampaignIdService}: the query shape over a mocked client, and
 * that an empty agency set never reaches BigQuery.
 */
@ExtendWith(MockitoExtension.class)
class BigQueryAgencyCampaignIdServiceTest {

	@Mock
	private BigQueryClient bigQueryClient;

	@Mock
	private BigQueryProperties bigQueryProperties;

	private BigQueryAgencyCampaignIdService service;

	@BeforeEach
	void setUp() {
		service = new BigQueryAgencyCampaignIdService(new BigQuerySearchGateway(
				bigQueryClient, bigQueryProperties, new CachedBigQuerySearchExecutor(bigQueryClient)));
	}

	@Test
	void shouldSelectDistinctCampaignIdsOfTheAgenciesInAStableOrderTest() {
		// Given: agencies named out of order - the SQL must sort them so the cache key is the same
		when(bigQueryProperties.getIoLinesTable()).thenReturn("proj.ds.io_lines");
		when(bigQueryClient.query(any())).thenReturn(List.of(
				Map.of("campaign_id", 100L), Map.of("campaign_id", 200L)));

		// When:
		List<Long> result = service.findCampaignIdsByAgencyIds(List.of(501L, 500L, 501L));

		// Then:
		assertThat(result).containsExactly(100L, 200L);
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(sql.getValue())
				.contains("SELECT DISTINCT")
				.contains("FROM `proj.ds.io_lines`")
				.contains("`campaign_id` IS NOT NULL")
				.contains("`agency_id` IN (500, 501)");
	}

	@Test
	void shouldNotQueryForNoAgenciesTest() {
		// When:
		List<Long> result = service.findCampaignIdsByAgencyIds(List.of());

		// Then:
		assertThat(result).isEmpty();
		verifyNoInteractions(bigQueryClient);
	}
}
