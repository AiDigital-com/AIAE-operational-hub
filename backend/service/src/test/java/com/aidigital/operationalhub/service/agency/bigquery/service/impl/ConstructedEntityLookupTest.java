package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.CampaignDeliveryScope;
import com.aidigital.operationalhub.service.agency.bigquery.model.ConstructedEntityLevel;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.CachedBigQuerySearchExecutor;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.model.ConstructedEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link ConstructedEntityLookup} - the Add Line name-resolution/disambiguation reads
 * (PDI_117). Captures the rendered SQL to prove every read is scoped to the campaign, whitelisted, and
 * narrowed the way name resolution needs.
 */
@ExtendWith(MockitoExtension.class)
class ConstructedEntityLookupTest {

	@Mock
	private BigQueryClient bigQueryClient;

	@Mock
	private BigQueryProperties bigQueryProperties;

	private ConstructedEntityLookup lookup;

	@BeforeEach
	void setUp() {
		BigQuerySearchGateway gateway = new BigQuerySearchGateway(
				bigQueryClient, bigQueryProperties, new CachedBigQuerySearchExecutor(bigQueryClient));
		lookup = new ConstructedEntityLookup(gateway, bigQueryProperties);
		lenient().when(bigQueryProperties.getAdjustmentsView()).thenReturn("adjustments_view");
	}

	private CampaignDeliveryScope scope() {
		CampaignModel campaign = new CampaignModel(
				42L, "Ourisman Ford 2026", 10L, "Ourisman Ford", 20L, "&Barr",
				"Live", "2026-01-01", "2026-12-31", 1000.0, List.of("Display"), "Automotive", 1L);
		return new CampaignDeliveryScope(
				campaign,
				new BqRequest("SELECT 42 AS `campaign_id`, 'uli-1' AS `line_item_id`"),
				new BqRequest("SELECT 'Retargeting' AS `constructed_name`"));
	}

	@Test
	void shouldScopeTheEntityQueryToTheCampaignAndTheWhitelistedLevelColumnsTest() {
		// Given:
		when(bigQueryClient.query(anyString())).thenReturn(List.of());

		// When:
		lookup.findEntities(scope(), ConstructedEntityLevel.LVL1, null, null, "Retargeting", 1, 20);

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(sql.getValue())
				.contains("FROM `adjustments_view`")
				.contains("`constructed_name` IN (SELECT `constructed_name` FROM (SELECT 'Retargeting' AS "
						+ "`constructed_name`))")
				.contains("`constructed_id` AS entity_id")
				.contains("`constructed_name` AS entity_name")
				.contains("`constructed_name` = 'Retargeting'")
				.contains("GROUP BY `constructed_name`, `constructed_id`")
				.contains("LIMIT 20 OFFSET 0");
	}

	@Test
	void shouldNarrowByPlatformAndAccountIdTest() {
		// Given:
		when(bigQueryClient.query(anyString())).thenReturn(List.of());

		// When:
		lookup.findEntities(scope(), ConstructedEntityLevel.LVL2, "dv_360_dlv", "acct-1", "Insertion Order 1", 1, 20);

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(sql.getValue())
				.contains("`platform` = 'dv_360_dlv'")
				.contains("`account_id` = 'acct-1'")
				.contains("`constructed_name_lvl2` = 'Insertion Order 1'")
				.contains("`constructed_name_lvl2` AS entity_name")
				.contains("`constructed_id_lvl2` AS entity_id");
	}

	@Test
	void shouldMatchEveryEntityAtTheLevelWhenNameIsBlankTest() {
		// Given: the blank-name existence probe used to detect an empty campaign
		when(bigQueryClient.query(anyString())).thenReturn(List.of());

		// When:
		lookup.findEntities(scope(), ConstructedEntityLevel.LVL1, null, null, "", 1, 1);

		// Then: no name predicate at all - every entity at the level matches
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(sql.getValue()).doesNotContain("`constructed_name` = ''");
	}

	@Test
	void shouldMapEntityRowsIntoAPageWithTotalsTest() {
		// Given:
		when(bigQueryClient.query(anyString())).thenReturn(List.of(Map.of(
				"entity_name", "Retargeting", "entity_id", "12345", "first_date", "2026-03-01",
				"last_date", "2026-03-10", "entity_impressions", 500L, "total", 1L)));

		// When:
		Page<ConstructedEntity> page =
				lookup.findEntities(scope(), ConstructedEntityLevel.LVL1, null, null, "Retargeting", 1, 20);

		// Then:
		assertThat(page.getContent())
				.containsExactly(new ConstructedEntity("Retargeting", "12345", "2026-03-01", "2026-03-10", 500L));
		assertThat(page.getTotalElements()).isEqualTo(1L);
	}

	@Test
	void shouldResolveTheSingleIdAnExactNameMatchesTest() {
		// Given:
		when(bigQueryClient.query(anyString())).thenReturn(List.of(Map.of("entity_id", "12345")));

		// When:
		Optional<String> id = lookup.findSingleExistingId(scope(), ConstructedEntityLevel.LVL1, "Retargeting");

		// Then:
		assertThat(id).contains("12345");
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(sql.getValue()).contains("SELECT DISTINCT").contains("`constructed_name` = 'Retargeting'");
	}

	@Test
	void shouldReturnEmptyWhenTheNameMatchesNoIdTest() {
		// Given:
		when(bigQueryClient.query(anyString())).thenReturn(List.of());

		// When:
		Optional<String> id = lookup.findSingleExistingId(scope(), ConstructedEntityLevel.LVL1, "Nothing");

		// Then:
		assertThat(id).isEmpty();
	}

	@Test
	void shouldReturnEmptyWhenTheNameMatchesMoreThanOneIdTest() {
		// Given: constructed_name -> constructed_id is one-to-many (PDI_117-PLAN.md 2.1)
		when(bigQueryClient.query(anyString())).thenReturn(
				List.of(Map.of("entity_id", "111"), Map.of("entity_id", "222")));

		// When:
		Optional<String> id = lookup.findSingleExistingId(scope(), ConstructedEntityLevel.LVL1, "Ambiguous");

		// Then:
		assertThat(id).isEmpty();
	}

	@Test
	void shouldReturnEmptyForABlankNameWithoutQueryingTest() {
		// When:
		Optional<String> id = lookup.findSingleExistingId(scope(), ConstructedEntityLevel.LVL1, "  ");

		// Then:
		assertThat(id).isEmpty();
		verifyNoInteractions(bigQueryClient);
	}
}
