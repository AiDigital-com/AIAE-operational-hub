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

import java.util.HashMap;
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

	private Map<String, Object> clientRow(Long campaignId, Long agencyId, Long clientId, String clientName) {
		Map<String, Object> row = new HashMap<>();
		row.put("campaign_id", campaignId);
		row.put("agency_id", agencyId);
		row.put("advertiser_id", clientId);
		row.put("CNB_client", clientName);
		return row;
	}

	@Test
	void shouldPreferTheSingleAdjustmentsMartClientOverTheCampaignSourceTest() {
		// Given:
		when(bigQueryClient.query(anyString())).thenReturn(List.of(clientRow(42452L, 20L, 10L, "TCL")));

		// When:
		CampaignModel resolved = resolver.forAdjustmentsMart(campaign("Wrong Client"));

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(resolved.clientName()).isEqualTo("TCL");
		assertThat(sql.getValue()).contains("FROM `io_lines`");
		assertThat(sql.getValue()).contains("LEFT JOIN `adjustments_view` mart");
		assertThat(sql.getValue()).contains("`campaign_id` IN (42452)");
		assertThat(sql.getValue()).contains("CAST(mart.`CNB_unique_line_item_id` AS STRING) = scoped.`line_item_id`");
		assertThat(sql.getValue()).doesNotContain("`CNB_campaign_name` =");
	}

	@Test
	void shouldResolveAdjustmentsMartClientsForAPageWithOneBatchQueryTest() {
		// Given:
		when(bigQueryClient.query(anyString())).thenReturn(List.of(
				clientRow(1L, 20L, 10L, "TCL"),
				clientRow(2L, 20L, 10L, "Client A"),
				clientRow(2L, 20L, 10L, "Client B")));

		// When:
		List<CampaignModel> resolved = resolver.forAdjustmentsMart(List.of(
				campaign(1L, "TCL Mobile/Tablets 2026", ""),
				campaign(2L, "Ambiguous Campaign", "Fallback Client")));

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(resolved).extracting(CampaignModel::clientName)
				.containsExactly("TCL", "Fallback Client");
		assertThat(sql.getValue()).contains("FROM `io_lines`");
		assertThat(sql.getValue()).contains("LEFT JOIN `adjustments_view` mart");
		assertThat(sql.getValue()).contains("`campaign_id` IN (1, 2)");
		assertThat(sql.getValue()).contains("GROUP BY scoped.`campaign_id`");
		assertThat(sql.getValue()).doesNotContain("`CNB_campaign_name` IN");
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
						clientRow(1L, 31291L, 0L, "Sunland Park"),
						clientRow(2L, 31291L, 0L, "Sunland Park")));
		AgencyClientKey key = new AgencyClientKey(31291L, 0L);

		// When:
		Map<AgencyClientKey, String> names =
				resolver.adjustmentsMartClientNamesForAgencyClients(List.of(key));

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(names).containsEntry(key, "Sunland Park");
		assertThat(sql.getValue())
				.contains("FROM `io_lines`")
				.contains("`agency_id` IN (31291)")
				.contains("`advertiser_id` IN (0)")
				.contains("`line_item_id` IS NOT NULL")
				.contains("LEFT JOIN `adjustments_view` mart")
				.contains("CAST(mart.`CNB_unique_line_item_id` AS STRING) = scoped.`line_item_id`");
	}

	@Test
	void shouldResolveSeveralAgencyClientNamesThroughCampaignsTest() {
		// Given:
		when(bigQueryClient.query(anyString()))
				.thenReturn(List.of(
						clientRow(1L, 31291L, 0L, "Sunland Park"),
						clientRow(2L, 31291L, 0L, "Comfort Care"),
						clientRow(2L, 31291L, 0L, "-"),
						clientRow(3L, 31291L, 0L, "-")));
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
						clientRow(1L, 12760L, 0L, "TCL"),
						clientRow(2L, 12760L, 0L, "TCL"),
						clientRow(2L, 12760L, 0L, "TCL Technology"),
						clientRow(3L, 12760L, 0L, "-"),
						clientRow(4L, 12760L, 0L, null)));
		AgencyClientKey key = new AgencyClientKey(12760L, 0L);

		// When:
		Map<AgencyClientKey, List<String>> names =
				resolver.adjustmentsMartClientNameSetsForAgencyClients(List.of(key));

		// Then:
		assertThat(names).containsEntry(key, List.of("TCL", "Client without name"));
	}

	@Test
	void shouldBuildLineItemBridgeForCampaignClientLookupTest() {
		// When:
		String sql = resolver.martClientsByLineItemScope(
				"adjustments_view",
				resolver.lineItemsForCampaigns(List.of(47155L))).sql();

		// Then:
		assertThat(sql)
				.contains("FROM `io_lines`")
				.contains("LEFT JOIN `adjustments_view` mart")
				.contains("`campaign_id` IN (47155)")
				.contains("CAST(mart.`CNB_unique_line_item_id` AS STRING) = scoped.`line_item_id`")
				.doesNotContain("`CNB_campaign_name`");
	}

	@Test
	void shouldBuildMartClientSearchRowsThroughLineItemBridgeTest() {
		// When:
		String sql = resolver.agencyClientRowsForMartClientSearch(List.of(11517L), "Andy's").sql();

		// Then:
		assertThat(sql)
				.contains("FROM `io_lines`")
				.contains("JOIN `adjustments_view` mart")
				.contains("`agency_id` IN (11517)")
				.contains("CAST(mart.`CNB_unique_line_item_id` AS STRING) = scoped.`line_item_id`")
				.contains("CONTAINS_SUBSTR(mart.`CNB_client`, 'Andy\\'s')")
				.contains("LOWER(TRIM(mart.`CNB_client`)) NOT IN ('-', 'null', 'client without name')")
				.doesNotContain("`CNB_campaign_name`");
	}

	@Test
	void shouldBuildAgencySearchFromMartClientRowsTest() {
		// When:
		BqRequest request = resolver.agencyIdsForMartClientSearch("Andy", List.of(11517L));

		// Then:
		assertThat(request.sql())
				.contains("SELECT DISTINCT `agency_id` FROM (")
				.contains("JOIN `adjustments_view` mart")
				.contains("CONTAINS_SUBSTR(mart.`CNB_client`, 'Andy')");
	}

	@Test
	void shouldResolveAndyClientWhenHubCampaignNameDiffersFromMartCampaignNameTest() {
		// Given:
		CampaignModel hubCampaign = new CampaignModel(
				47155L, "2026_Andy's Frozen Custard_Bentonville AR", 21376L, "",
				11517L, "True Media", "Live", "2026-07-01", "2026-09-30", 28778.04,
				List.of("CTV/OTT", "Audio"), "Restaurants & QSR", 2L);
		when(bigQueryClient.query(anyString()))
				.thenReturn(List.of(clientRow(47155L, 11517L, 21376L, "Andy's Frozen Custard")));

		// When:
		CampaignModel resolved = resolver.forAdjustmentsMart(hubCampaign);

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(resolved.clientName()).isEqualTo("Andy's Frozen Custard");
		assertThat(sql.getValue()).contains("`campaign_id` IN (47155)");
		assertThat(sql.getValue()).doesNotContain("2026_Andy's Frozen Custard_Bentonville AR");
	}
}
