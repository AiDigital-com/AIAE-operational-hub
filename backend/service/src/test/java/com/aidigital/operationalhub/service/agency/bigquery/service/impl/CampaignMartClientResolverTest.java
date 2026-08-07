package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.bigquery.model.AgencyClientKey;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.CachedBigQuerySearchExecutor;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link CampaignMartClientResolver}, which keeps report scoping tied to the mart's own
 * {@code CNB_client} rather than stale or placeholder client names from the campaign source.
 */
@ExtendWith(MockitoExtension.class)
class CampaignMartClientResolverTest {

	@Mock
	private BigQueryClient bigQueryClient;

	@Mock
	private BigQueryProperties bigQueryProperties;

	private CampaignMartClientResolver resolver;

	@BeforeEach
	void setUp() {
		BigQuerySearchGateway gateway = new BigQuerySearchGateway(
				bigQueryClient, bigQueryProperties, new CachedBigQuerySearchExecutor(bigQueryClient));
		resolver = new CampaignMartClientResolver(gateway, bigQueryProperties);
		lenient().when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		lenient().when(bigQueryProperties.getAdjustmentsView()).thenReturn("adjustments_view");
		lenient().when(bigQueryProperties.getConversionsView()).thenReturn("conversions_view");
	}

	private CampaignModel campaign(String clientName) {
		return new CampaignModel(
				42452L, "TCL Mobile/Tablets 2026", 10L, clientName, 20L, "&Barr",
				"Live", "2026-01-01", "2026-12-31", 1000.0, List.of("Meta"), "Electronics", 1L);
	}

	private CampaignModel campaign(long id, String name, String clientName) {
		return new CampaignModel(
				id, name, 10L, clientName, 20L, "&Barr",
				"Live", "2026-01-01", "2026-12-31", 1000.0, List.of("Meta"), "Electronics", 1L);
	}

	@Test
	void shouldPreferTheSingleAdjustmentsMartClientOverTheCampaignSourceTest() {
		// Given:
		when(bigQueryClient.query(anyString())).thenReturn(List.of(Map.of("CNB_client", "TCL")));

		// When:
		CampaignModel resolved = resolver.forAdjustmentsMart(campaign("Wrong Client"));

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(resolved.clientName()).isEqualTo("TCL");
		assertThat(sql.getValue()).contains("FROM `adjustments_view`");
		assertThat(sql.getValue()).contains("SELECT DISTINCT `CNB_client` AS CNB_client");
		assertThat(sql.getValue()).contains("`CNB_campaign_name` = 'TCL Mobile/Tablets 2026'");
		assertThat(sql.getValue()).contains("LIMIT 2 OFFSET 0");
	}

	@Test
	void shouldFallbackToACleanCampaignClientWhenTheMartClientIsAmbiguousTest() {
		// Given:
		when(bigQueryClient.query(anyString()))
				.thenReturn(List.of(Map.of("CNB_client", "TCL"), Map.of("CNB_client", "Other TCL")));

		// When:
		CampaignModel resolved = resolver.forConversionsMart(campaign("Fallback TCL"));

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(resolved.clientName()).isEqualTo("Fallback TCL");
		assertThat(sql.getValue()).contains("FROM `conversions_view`");
	}

	@Test
	void shouldResolveAdjustmentsMartClientsForAPageWithOneBatchQueryTest() {
		// Given:
		when(bigQueryClient.query(anyString())).thenReturn(List.of(
				Map.of("CNB_campaign_name", "TCL Mobile/Tablets 2026", "CNB_client", "TCL"),
				Map.of("CNB_campaign_name", "Ambiguous Campaign", "CNB_client", "Client A"),
				Map.of("CNB_campaign_name", "Ambiguous Campaign", "CNB_client", "Client B")));

		// When:
		List<CampaignModel> resolved = resolver.forAdjustmentsMart(List.of(
				campaign(1L, "TCL Mobile/Tablets 2026", ""),
				campaign(2L, "Ambiguous Campaign", "Fallback Client")));

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(resolved).extracting(CampaignModel::clientName)
				.containsExactly("TCL", "Fallback Client");
		assertThat(sql.getValue()).contains("FROM `adjustments_view`");
		assertThat(sql.getValue()).contains(
				"`CNB_campaign_name` IN ('TCL Mobile/Tablets 2026', 'Ambiguous Campaign')");
		assertThat(sql.getValue()).contains("GROUP BY `CNB_campaign_name`, `CNB_client`");
	}

	@Test
	void shouldDropPlaceholderCampaignClientsWhenTheMartHasNoSingleClientTest() {
		// Given:
		when(bigQueryClient.query(anyString())).thenReturn(List.of());

		// When:
		CampaignModel resolved = resolver.forAdjustmentsMart(campaign("Client without name"));

		// Then:
		assertThat(resolved.clientName()).isNull();
	}

	@Test
	void shouldDropDashClientPlaceholderTest() {
		// Given:
		when(bigQueryClient.query(anyString())).thenReturn(List.of(Map.of("CNB_client", "-")));

		// When:
		CampaignModel resolved = resolver.forAdjustmentsMart(campaign("Client without name"));

		// Then:
		assertThat(resolved.clientName()).isNull();
	}

	@Test
	void shouldResolveAgencyClientNamesThroughCampaignsInOneBatchTest() {
		// Given:
		when(bigQueryClient.query(anyString()))
				.thenReturn(List.of(
						Map.of("agency_id", 31291L, "advertiser_id", 0L, "campaign", "TCL Mobile/Tablets 2026"),
						Map.of("agency_id", 31291L, "advertiser_id", 0L, "campaign", "Sunland Retargeting"),
						Map.of("agency_id", 999L, "advertiser_id", 0L, "campaign", "Other Agency Campaign")))
				.thenReturn(List.of(
						Map.of("CNB_campaign_name", "TCL Mobile/Tablets 2026", "CNB_client", "Sunland Park"),
						Map.of("CNB_campaign_name", "Sunland Retargeting", "CNB_client", "Sunland Park")));
		AgencyClientKey key = new AgencyClientKey(31291L, 0L);

		// When:
		Map<AgencyClientKey, String> names =
				resolver.adjustmentsMartClientNamesForAgencyClients(List.of(key));

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(2)).query(sql.capture());
		assertThat(names).containsEntry(key, "Sunland Park");
		assertThat(sql.getAllValues().get(0))
				.contains("FROM `io_lines`")
				.contains("`agency_id` IN (31291)")
				.contains("`advertiser_id` IN (0)")
				.contains("`campaign` IS NOT NULL");
		assertThat(sql.getAllValues().get(1))
				.contains("FROM `adjustments_view`")
				.contains("`CNB_campaign_name` IN ('TCL Mobile/Tablets 2026', 'Sunland Retargeting')")
				.contains("GROUP BY `CNB_campaign_name`, `CNB_client`");
	}

	@Test
	void shouldResolveSeveralAgencyClientNamesThroughCampaignsTest() {
		// Given:
		when(bigQueryClient.query(anyString()))
				.thenReturn(List.of(
						Map.of("agency_id", 31291L, "advertiser_id", 0L, "campaign", "Sunland Campaign"),
						Map.of("agency_id", 31291L, "advertiser_id", 0L, "campaign", "Comfort Campaign"),
						Map.of("agency_id", 31291L, "advertiser_id", 0L, "campaign", "Unknown Campaign")))
				.thenReturn(List.of(
						Map.of("CNB_campaign_name", "Sunland Campaign", "CNB_client", "Sunland Park"),
						Map.of("CNB_campaign_name", "Comfort Campaign", "CNB_client", "Comfort Care"),
						Map.of("CNB_campaign_name", "Comfort Campaign", "CNB_client", "-"),
						Map.of("CNB_campaign_name", "Unknown Campaign", "CNB_client", "-")));
		AgencyClientKey key = new AgencyClientKey(31291L, 0L);

		// When:
		Map<AgencyClientKey, List<String>> names =
				resolver.adjustmentsMartClientNameSetsForAgencyClients(List.of(key));

		// Then:
		assertThat(names).containsEntry(key, List.of("Sunland Park", "Comfort Care", "Client without name"));
	}

	@Test
	void shouldSplitTclPlaceholderClientIntoRealMartBucketsAndFallbackTest() {
		// Given:
		when(bigQueryClient.query(anyString()))
				.thenReturn(List.of(
						Map.of("agency_id", 12760L, "advertiser_id", 0L, "campaign", "Campaign 1"),
						Map.of("agency_id", 12760L, "advertiser_id", 0L, "campaign", "Campaign 2"),
						Map.of("agency_id", 12760L, "advertiser_id", 0L, "campaign", "Campaign 3"),
						Map.of("agency_id", 12760L, "advertiser_id", 0L, "campaign", "Campaign 4")))
				.thenReturn(List.of(
						Map.of("CNB_campaign_name", "Campaign 1", "CNB_client", "TCL"),
						Map.of("CNB_campaign_name", "Campaign 2", "CNB_client", "TCL"),
						Map.of("CNB_campaign_name", "Campaign 2", "CNB_client", "TCL Technology"),
						Map.of("CNB_campaign_name", "Campaign 3", "CNB_client", "-")));
		AgencyClientKey key = new AgencyClientKey(12760L, 0L);

		// When:
		Map<AgencyClientKey, List<String>> names =
				resolver.adjustmentsMartClientNameSetsForAgencyClients(List.of(key));

		// Then:
		assertThat(names).containsEntry(key, List.of("TCL", "Client without name"));
	}

	@Test
	void shouldBuildAdjustmentsCampaignNamesForClientSubqueryTest() {
		// When:
		String sql = resolver.adjustmentsCampaignNamesForClient(" Sunland Park ").sql();

		// Then:
		assertThat(sql)
				.contains("FROM `adjustments_view`")
				.contains("SELECT `CNB_campaign_name` AS CNB_campaign_name")
				.contains("ARRAY_LENGTH(real_clients) = 1")
				.contains("real_clients[OFFSET(0)] = 'Sunland Park'")
				.contains("LOWER(TRIM(`CNB_client`)) NOT IN ('-', 'null', 'client without name')");
	}

	@Test
	void shouldBuildAdjustmentsCampaignNamesWithRealClientSubqueryTest() {
		// When:
		String sql = resolver.adjustmentsCampaignNamesWithRealClient().sql();

		// Then:
		assertThat(sql)
				.contains("FROM `adjustments_view`")
				.contains("SELECT `CNB_campaign_name` AS CNB_campaign_name")
				.contains("`CNB_campaign_name` IS NOT NULL")
				.contains("TRIM(`CNB_client`) != ''")
				.contains("LOWER(TRIM(`CNB_client`)) NOT IN ('-', 'null', 'client without name')")
				.contains("ARRAY_LENGTH(real_clients) = 1");
	}

	@Test
	void shouldScopeAdjustmentsCampaignNameSubqueriesByCandidateIoCampaignsTest() {
		// Given:
		BqRequest scope = new BqRequest.Builder()
				.from("io_lines")
				.distinct()
				.select("campaign")
				.whereIn("agency_id", List.of(12760L))
				.whereIn("advertiser_id", List.of(0L))
				.whereNotNull("campaign")
				.build();

		// When:
		String sql = resolver.adjustmentsCampaignNamesForClient("TCL", scope).sql();

		// Then:
		assertThat(sql)
				.contains("FROM `adjustments_view`")
				.contains("`CNB_campaign_name` IN (SELECT `campaign` FROM (SELECT DISTINCT "
						+ "`campaign` AS campaign FROM `io_lines` WHERE `agency_id` IN (12760) "
						+ "AND `advertiser_id` IN (0) AND `campaign` IS NOT NULL))")
				.contains("real_clients[OFFSET(0)] = 'TCL'");
	}
}
