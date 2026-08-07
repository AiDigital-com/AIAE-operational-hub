package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.CampaignDeliveryScope;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.CachedBigQuerySearchExecutor;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;

/**
 * Unit tests for {@link CampaignDeliveryScopeResolver}, which maps Hub campaigns to delivery mart rows
 * through NetSuite line item ids rather than string-matching campaign/client names.
 */
@ExtendWith(MockitoExtension.class)
class CampaignDeliveryScopeResolverTest {

	@Mock
	private BigQueryClient bigQueryClient;

	@Mock
	private BigQueryProperties bigQueryProperties;

	private CampaignDeliveryScopeResolver resolver;

	@BeforeEach
	void setUp() {
		BigQuerySearchGateway gateway = new BigQuerySearchGateway(
				bigQueryClient, bigQueryProperties, new CachedBigQuerySearchExecutor(bigQueryClient));
		resolver = new CampaignDeliveryScopeResolver(gateway, bigQueryProperties);
		lenient().when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		lenient().when(bigQueryProperties.getAdjustmentsView()).thenReturn("adjustments_view");
		lenient().when(bigQueryProperties.getConversionsView()).thenReturn("conversions_view");
	}

	private CampaignModel campaign() {
		return new CampaignModel(
				47155L, "2026_Andy's Frozen Custard_Bentonville AR", 21376L, "Andy's Frozen Custard",
				11517L, "True Media", "Live", "2026-07-01", "2026-09-30", 28778.04,
				List.of("CTV/OTT", "Audio"), "Restaurants & QSR", 2L);
	}

	@Test
	void shouldBuildACampaignScopeThroughNetSuiteLineItemsTest() {
		// When:
		CampaignDeliveryScope scope = resolver.forCampaign(campaign());

		// Then:
		assertThat(scope.lineItems().sql())
				.contains("FROM `io_lines`")
				.contains("`campaign_id` = 47155")
				.contains("CAST(`line_item_id` AS STRING) AS line_item_id");
		assertThat(scope.constructedNames().sql())
				.contains("FROM `adjustments_view`")
				.contains("`CNB_unique_line_item_id` IN")
				.contains("SELECT `line_item_id` FROM (" + scope.lineItems().sql() + ")")
				.contains("`constructed_name` IS NOT NULL");
	}

	@Test
	void shouldBuildAConversionsScopeThroughTheConversionsMartTest() {
		// When:
		CampaignDeliveryScope scope = resolver.forConversions(campaign());

		// Then:
		assertThat(scope.lineItems().sql())
				.contains("FROM `io_lines`")
				.contains("`campaign_id` = 47155");
		assertThat(scope.constructedNames().sql())
				.contains("FROM `conversions_view`")
				.contains("`CNB_unique_line_item_id` IN")
				.contains("SELECT `line_item_id` FROM (" + scope.lineItems().sql() + ")")
				.contains("`constructed_name` IS NOT NULL");
	}

	@Test
	void shouldBuildAgencyClientLineItemScopeTest() {
		// When:
		BqRequest lineItems = resolver.lineItemsForAgencyClients(List.of(11517L), List.of(21376L));

		// Then:
		assertThat(lineItems.sql())
				.contains("FROM `io_lines`")
				.contains("`agency_id` IN (11517)")
				.contains("`advertiser_id` IN (21376)")
				.contains("`line_item_id` IS NOT NULL");
	}

	@Test
	void shouldBuildSingleRealClientCampaignScopeTest() {
		// Given:
		BqRequest lineItems = resolver.lineItemsForAgencyClients(List.of(11517L), List.of(21376L));

		// When:
		BqRequest campaigns = resolver.campaignIdsForSingleRealClient("Andy's Frozen Custard", lineItems);

		// Then:
		assertThat(campaigns.sql())
				.contains("HAVING COUNT(DISTINCT IF(")
				.contains("MAX(IF(")
				.contains("= 'Andy\\'s Frozen Custard'")
				.contains("LEFT JOIN `adjustments_view` mart")
				.contains("mart.`CNB_unique_line_item_id` = scoped.`line_item_id`")
				.doesNotContain("ARRAY_AGG");
	}

	@Test
	void shouldReturnNullSingleClientScopeForPlaceholderClientNamesTest() {
		// Given:
		BqRequest lineItems = resolver.lineItemsForAgencyClients(List.of(11517L), List.of(0L));

		// When/Then:
		assertThat(resolver.campaignIdsForSingleRealClient("Client without name", lineItems)).isNull();
		assertThat(resolver.campaignIdsForSingleRealClient("-", lineItems)).isNull();
		assertThat(resolver.campaignIdsForSingleRealClient(" ", lineItems)).isNull();
	}

	@Test
	void shouldBuildPlaceholderBucketAsCampaignsWithoutOneSingleRealClientTest() {
		// Given:
		BqRequest lineItems = resolver.lineItemsForAgencyClients(List.of(12760L), List.of(0L));

		// When:
		BqRequest campaigns = resolver.campaignIdsWithSingleRealClient(lineItems);

		// Then:
		assertThat(campaigns.sql())
				.contains("COUNT(DISTINCT IF(")
				.contains("`CNB_client` IS NOT NULL")
				.contains("LOWER(TRIM(`CNB_client`)) NOT IN ('-', 'null', 'client without name')")
				.contains("HAVING COUNT(DISTINCT")
				.doesNotContain("ARRAY_AGG");
	}
}
