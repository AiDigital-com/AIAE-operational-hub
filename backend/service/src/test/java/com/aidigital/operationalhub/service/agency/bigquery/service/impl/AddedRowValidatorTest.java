package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.CampaignDeliveryScope;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.CachedBigQuerySearchExecutor;
import com.aidigital.operationalhub.service.agency.model.AdjustmentRowModel;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.exception.BusinessException;
import org.instancio.Instancio;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.instancio.Select.field;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link AddedRowValidator} - PDI_117 V1-V8, applied to every manually-added report row
 * before it is written. Resolution is per level (D2): one row may carry real ids at some levels and
 * generated ids at others, so most scenarios below are expressed as which of the three levels resolves
 * to a real mart entity versus generates a fresh id.
 */
@ExtendWith(MockitoExtension.class)
class AddedRowValidatorTest {

	/** The exact rendered SQL {@link #scope()}'s constructedNames subquery is stubbed to answer. */
	private static final String NAMES_MARKER_SQL = "SELECT constructed_name_marker";
	private static final String SIXTEEN_SEGMENT_NAME =
			"AG_CL_IND_CAMP_CH_TAC_BUY_AUD_ULI_OTH_GEO_CRT_MSG_KWG_FLT_LANG";

	@Mock
	private BigQueryClient bigQueryClient;

	@Mock
	private BigQueryProperties bigQueryProperties;

	private ConstructedIdGenerator idGenerator;
	private AddedRowValidator validator;

	@BeforeEach
	void setUp() {
		BigQuerySearchGateway gateway = new BigQuerySearchGateway(
				bigQueryClient, bigQueryProperties, new CachedBigQuerySearchExecutor(bigQueryClient));
		idGenerator = new ConstructedIdGenerator();
		validator = new AddedRowValidator(gateway, bigQueryProperties, idGenerator);
		lenient().when(bigQueryProperties.getAdjustmentsView()).thenReturn("adjustments_view");
		lenient().when(bigQueryClient.query(anyString())).thenReturn(List.of());
	}

	private CampaignDeliveryScope scope() {
		CampaignModel campaign = new CampaignModel(
				42L, "Ourisman Ford 2026", 10L, "Ourisman Ford", 20L, "&Barr",
				"Live", "2026-01-01", "2026-12-31", 1000.0, List.of("Display"), "Automotive", 1L);
		return new CampaignDeliveryScope(
				campaign,
				new BqRequest("SELECT 42 AS `campaign_id`, 'uli-1' AS `line_item_id`"),
				new BqRequest(NAMES_MARKER_SQL));
	}

	private AdjustmentRowModel addedRow(
			String platform, String account, String accountId, String date,
			String name, String id, String nameLvl2, String idLvl2, String nameLvl3, String idLvl3) {
		return Instancio.of(AdjustmentRowModel.class)
				.set(field(AdjustmentRowModel::added), true)
				.set(field(AdjustmentRowModel::platform), platform)
				.set(field(AdjustmentRowModel::account), account)
				.set(field(AdjustmentRowModel::accountId), accountId)
				.set(field(AdjustmentRowModel::date), date)
				.set(field(AdjustmentRowModel::lineItemName), name)
				.set(field(AdjustmentRowModel::lineItemId), id)
				.set(field(AdjustmentRowModel::insertionOrderName), nameLvl2)
				.set(field(AdjustmentRowModel::insertionOrderId), idLvl2)
				.set(field(AdjustmentRowModel::campaignConstructedName), nameLvl3)
				.set(field(AdjustmentRowModel::campaignConstructedId), idLvl3)
				.create();
	}

	/** A row whose every level resolves to a real, matched mart entity. */
	private AdjustmentRowModel allRealRow(String platform, String account, String accountId, String date) {
		return addedRow(platform, account, accountId, date, "Line 1", "id1", "IO 1", "id2", "Creative 1", "id3");
	}

	/** A row whose every level is a candidate for generation (blank ids, sixteen-segment level-1 name). */
	private AdjustmentRowModel allGeneratedRow(String platform, String account, String accountId, String date) {
		return addedRow(
				platform, account, accountId, date, SIXTEEN_SEGMENT_NAME, null, "lvl2 name", null, "lvl3 name",
				null);
	}

	private void stubDeliveryAccountKnown(String platform, String account, String accountId) {
		when(bigQueryClient.query(argThat(sql -> sql != null && sql.startsWith("SELECT `platform` AS platform FROM")
				&& sql.contains("`platform` = '" + platform + "'")
				&& sql.contains("`account` = '" + account + "'")
				&& sql.contains("`account_id` = '" + accountId + "'"))))
				.thenReturn(List.of(Map.of("platform", platform)));
	}

	/** Stubs one level's name resolution to the given (name, id) matches. */
	private void stubLevelMatches(String nameColumn, String name, List<Map<String, Object>> rows) {
		when(bigQueryClient.query(argThat(sql -> sql != null
				&& sql.contains("`" + nameColumn + "` AS matched_name")
				&& sql.contains("`" + nameColumn + "` = '" + name + "'"))))
				.thenReturn(rows);
	}

	private Map<String, Object> matchRow(String name, String id) {
		return Map.of("matched_name", name, "matched_id", id);
	}

	private void stubNoOverrideOnDate() {
		when(bigQueryClient.query(argThat(sql -> sql != null && sql.startsWith("SELECT `date` AS date FROM")
				&& sql.contains(NAMES_MARKER_SQL) && sql.contains("`account_id` ="))))
				.thenReturn(List.of());
	}

	private void stubOverrideAlreadyExistsOnDate() {
		when(bigQueryClient.query(argThat(sql -> sql != null && sql.startsWith("SELECT `date` AS date FROM")
				&& sql.contains(NAMES_MARKER_SQL) && sql.contains("`account_id` ="))))
				.thenReturn(List.of(Map.of("date", "2026-03-15")));
	}

	private void stubGeneratedKeyUnused() {
		when(bigQueryClient.query(argThat(sql -> sql != null && sql.startsWith("SELECT `date` AS date FROM")
				&& !sql.contains(NAMES_MARKER_SQL))))
				.thenReturn(List.of());
	}

	private void stubGeneratedKeyAlreadyUsed() {
		when(bigQueryClient.query(argThat(sql -> sql != null && sql.startsWith("SELECT `date` AS date FROM")
				&& !sql.contains(NAMES_MARKER_SQL))))
				.thenReturn(List.of(Map.of("date", "2026-03-15")));
	}

	private void stubInheritedNames(String... names) {
		when(bigQueryClient.query(NAMES_MARKER_SQL)).thenReturn(
				List.of(names).stream().map(name -> Map.<String, Object>of("constructed_name", name)).toList());
	}

	@Test
	void shouldRejectWhenPlatformAccountOrAccountIdIsBlankTest() {
		// Given: V1
		AdjustmentRowModel row = allRealRow("dv_360_dlv", "DLV Main", "", "2026-03-15");

		// When/Then:
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_043");
	}

	@Test
	void shouldRejectWhenTheDeliveryAccountTripleIsUnknownToTheCampaignTest() {
		// Given: V1 - no known delivery account (default empty stub)
		AdjustmentRowModel row = allRealRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When/Then:
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_043");
	}

	@Test
	void shouldRejectALevelWhoseRealIdDoesNotMatchTheResolvedNameTest() {
		// Given: V2 - level 1's name resolves to a different id than the client claims
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		stubLevelMatches("constructed_name", "Line 1", List.of(matchRow("Line 1", "real-id")));
		AdjustmentRowModel row = allRealRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When/Then: row claims "id1", the name only resolves to "real-id"
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_044");
	}

	@Test
	void shouldResolveARealLevelFromTheMatchedMartRowDiscardingTheClientSentNameTest() {
		// Given: V2 positive + V5 - the resolved name/id come from the mart match, not the client
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		stubLevelMatches("constructed_name", "Line 1", List.of(matchRow("mart-exact-name", "id1")));
		stubLevelMatches("constructed_name_lvl2", "IO 1", List.of(matchRow("mart-io-name", "id2")));
		stubLevelMatches("constructed_name_lvl3", "Creative 1", List.of(matchRow("mart-creative-name", "id3")));
		stubNoOverrideOnDate();
		AdjustmentRowModel row = allRealRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When:
		AdjustmentRowModel resolved = validator.resolve(scope(), row);

		// Then:
		assertThat(resolved.lineItemName()).isEqualTo("mart-exact-name");
		assertThat(resolved.lineItemId()).isEqualTo("id1");
		assertThat(resolved.insertionOrderName()).isEqualTo("mart-io-name");
		assertThat(resolved.insertionOrderId()).isEqualTo("id2");
		assertThat(resolved.campaignConstructedName()).isEqualTo("mart-creative-name");
		assertThat(resolved.campaignConstructedId()).isEqualTo("id3");
	}

	@Test
	void shouldRejectGeneratingALevelWhoseNameAlreadyResolvesToOneEntityTest() {
		// Given: V8 - the client asked to generate (blank id), but the name matches a real entity
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		stubLevelMatches("constructed_name", SIXTEEN_SEGMENT_NAME, List.of(matchRow(SIXTEEN_SEGMENT_NAME, "id1")));
		AdjustmentRowModel row = allGeneratedRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When/Then:
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_049");
	}

	@Test
	void shouldRejectGeneratingALevelWhoseNameResolvesToSeveralEntitiesTest() {
		// Given: V8 - several matches (2.1: constructed_name -> constructed_id is one-to-many); the
		// client must name which one instead of asking to generate
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		stubLevelMatches("constructed_name", SIXTEEN_SEGMENT_NAME,
				List.of(matchRow(SIXTEEN_SEGMENT_NAME, "id1"), matchRow(SIXTEEN_SEGMENT_NAME, "id1b")));
		AdjustmentRowModel row = allGeneratedRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When/Then:
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_049");
	}

	@Test
	void shouldGenerateWhenTheNameResolvesToNothingTest() {
		// Given: V8 positive - genuinely nothing to resolve
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		stubGeneratedKeyUnused();
		AdjustmentRowModel row = allGeneratedRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When:
		AdjustmentRowModel resolved = validator.resolve(scope(), row);

		// Then:
		assertThat(resolved.lineItemId()).startsWith("OPH_");
		assertThat(resolved.insertionOrderId()).startsWith("OPH_");
		assertThat(resolved.campaignConstructedId()).startsWith("OPH_");
	}

	@Test
	void shouldResolveAnExistingInsertionOrderAndLineItemWithABrandNewCreativeTest() {
		// Given: the most common addition - level 1 and level 2 already exist, level 3 (creative) is new.
		// A whole-row mode could not express this (PDI_117-PLAN.md D2); per-level resolution can.
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		stubLevelMatches("constructed_name", "Line 1", List.of(matchRow("Line 1", "id1")));
		stubLevelMatches("constructed_name_lvl2", "IO 1", List.of(matchRow("IO 1", "id2")));
		// level 3 asks to generate (blank id) and resolves to nothing - the new creative
		stubGeneratedKeyUnused();
		AdjustmentRowModel row = addedRow(
				"dv_360_dlv", "DLV Main", "acct-1", "2026-03-15", "Line 1", "id1", "IO 1", "id2",
				"Brand New Creative", null);

		// When:
		AdjustmentRowModel resolved = validator.resolve(scope(), row);

		// Then: real ids for levels 1/2, a freshly generated id for level 3
		assertThat(resolved.lineItemId()).isEqualTo("id1");
		assertThat(resolved.insertionOrderId()).isEqualTo("id2");
		assertThat(resolved.campaignConstructedName()).isEqualTo("Brand New Creative");
		assertThat(resolved.campaignConstructedId()).startsWith("OPH_");
	}

	@Test
	void shouldRejectAnAllRealRowThatAlreadyHasAMartRowOnThatDateTest() {
		// Given: V3 - every level resolved real, and that exact entity already has a row on this date
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		stubLevelMatches("constructed_name", "Line 1", List.of(matchRow("Line 1", "id1")));
		stubLevelMatches("constructed_name_lvl2", "IO 1", List.of(matchRow("IO 1", "id2")));
		stubLevelMatches("constructed_name_lvl3", "Creative 1", List.of(matchRow("Creative 1", "id3")));
		stubOverrideAlreadyExistsOnDate();
		AdjustmentRowModel row = allRealRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When/Then:
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_045");
	}

	@Test
	void shouldNotApplyV3WhenAnyLevelWasGeneratedEvenIfTheKeyWouldOtherwiseCollideTest() {
		// Given: level 3 is generated (new creative), so V3 (override-in-disguise) must not run at all -
		// stubbed (lenient - it is expected to go unused) to report a collision, proving it is never
		// consulted rather than merely never colliding
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		stubLevelMatches("constructed_name", "Line 1", List.of(matchRow("Line 1", "id1")));
		stubLevelMatches("constructed_name_lvl2", "IO 1", List.of(matchRow("IO 1", "id2")));
		lenient().when(bigQueryClient.query(argThat(sql -> sql != null && sql.startsWith("SELECT `date` AS date FROM")
				&& sql.contains(NAMES_MARKER_SQL) && sql.contains("`account_id` ="))))
				.thenReturn(List.of(Map.of("date", "2026-03-15")));
		stubGeneratedKeyUnused();
		AdjustmentRowModel row = addedRow(
				"dv_360_dlv", "DLV Main", "acct-1", "2026-03-15", "Line 1", "id1", "IO 1", "id2",
				"Brand New Creative", null);

		// When/Then: resolves without throwing
		AdjustmentRowModel resolved = validator.resolve(scope(), row);
		assertThat(resolved.campaignConstructedId()).startsWith("OPH_");
	}

	@Test
	void shouldRejectWhenTheGeneratedKeyAlreadyExistsInTheMartTest() {
		// Given: V4 - applies to the final key regardless of origin
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		stubGeneratedKeyAlreadyUsed();
		AdjustmentRowModel row = allGeneratedRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When/Then:
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_046");
	}

	@Test
	void shouldRejectGeneratingLevelOneWhenTheNameDoesNotHaveSixteenSegmentsTest() {
		// Given: V6 - only applies when level 1 itself is generated
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		AdjustmentRowModel row = addedRow(
				"dv_360_dlv", "DLV Main", "acct-1", "2026-03-15", "only_three_segments", null, "l2", null, "l3",
				null);

		// When/Then:
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_047");
	}

	@Test
	void shouldNotApplyV6WhenLevelOneResolvesToARealNonConventionalNameTest() {
		// Given: level 1 resolves to a real mart entity whose name has only one segment (e.g. Google Ads
		// campaigns - PDI_117-PLAN.md 2.3) - V6 must not reject a real match
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		stubLevelMatches("constructed_name", "Demand Gen - 2025-09-26",
				List.of(matchRow("Demand Gen - 2025-09-26", "id1")));
		stubGeneratedKeyUnused();
		AdjustmentRowModel row = addedRow(
				"dv_360_dlv", "DLV Main", "acct-1", "2026-03-15", "Demand Gen - 2025-09-26", "id1", "lvl2 name",
				null, "lvl3 name", null);

		// When: does not throw
		AdjustmentRowModel resolved = validator.resolve(scope(), row);

		// Then:
		assertThat(resolved.lineItemId()).isEqualTo("id1");
	}

	@Test
	void shouldRejectGeneratingLevelOneWhenTheNameLeavesTheCampaignsInheritedPrefixTest() {
		// Given: V7 - only applies when level 1 itself is generated
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		stubInheritedNames(
				"AG_CL_IND_CAMP_x1_x2_x3_x4_x5_x6_x7_x8_x9_x10_x11_x12",
				"AG_CL_IND_CAMP_y1_y2_y3_y4_y5_y6_y7_y8_y9_y10_y11_y12");
		String outsidePrefix = "ZZ_ZZ_ZZ_ZZ_ch_tac_buy_aud_uli_oth_geo_crt_msg_kwg_flt_lang";
		AdjustmentRowModel row = addedRow(
				"dv_360_dlv", "DLV Main", "acct-1", "2026-03-15", outsidePrefix, null, "l2", null, "l3", null);

		// When/Then:
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_048");
	}

	@Test
	void shouldAllowGeneratingLevelOneWhenTheCampaignHasNoKnownNamesToInheritAPrefixFromTest() {
		// Given: an empty campaign - no rows to disagree with, so V7 has nothing to enforce
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		stubGeneratedKeyUnused();
		AdjustmentRowModel row = allGeneratedRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When: does not throw
		AdjustmentRowModel resolved = validator.resolve(scope(), row);

		// Then:
		assertThat(resolved.lineItemId()).startsWith("OPH_");
	}

	@Test
	void shouldGenerateFreshDeterministicIdsFromNameAndCampaignScopeIgnoringWhateverTheClientSentTest() {
		// Given: D3 - level 1 hashes its own name; levels 2/3 hash the campaign scope plus their own name
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		stubGeneratedKeyUnused();
		AdjustmentRowModel row = allGeneratedRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");
		String expectedId1 = idGenerator.generate(List.of(SIXTEEN_SEGMENT_NAME));
		String campaignScope = idGenerator.scopeOf(SIXTEEN_SEGMENT_NAME);
		String expectedId2 = idGenerator.generate(List.of(campaignScope, "lvl2 name"));
		String expectedId3 = idGenerator.generate(List.of(campaignScope, "lvl3 name"));

		// When:
		AdjustmentRowModel resolved = validator.resolve(scope(), row);

		// Then:
		assertThat(resolved.lineItemId()).isEqualTo(expectedId1);
		assertThat(resolved.insertionOrderId()).isEqualTo(expectedId2);
		assertThat(resolved.campaignConstructedId()).isEqualTo(expectedId3);
	}

	@Test
	void shouldGiveTheSameLevel2NameADifferentIdUnderADifferentCampaignScopeTest() {
		// Given: the same free-form level-2 name typed under two different campaigns (two different
		// level-1 names, hence two different scopes) - proves level 2/3 ids are not bare-name hashes
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		stubGeneratedKeyUnused();
		String otherCampaignName = "ZZ_ZZ_ZZ_ZZ_ch_tac_buy_aud_uli_oth_geo_crt_msg_kwg_flt_lang";
		AdjustmentRowModel rowA = addedRow(
				"dv_360_dlv", "DLV Main", "acct-1", "2026-03-15", SIXTEEN_SEGMENT_NAME, null,
				"shared insertion order", null, "lvl3 name", null);
		AdjustmentRowModel rowB = addedRow(
				"dv_360_dlv", "DLV Main", "acct-1", "2026-03-15", otherCampaignName, null,
				"shared insertion order", null, "lvl3 name", null);

		// When:
		AdjustmentRowModel resolvedA = validator.resolve(scope(), rowA);
		AdjustmentRowModel resolvedB = validator.resolve(scope(), rowB);

		// Then:
		assertThat(resolvedA.insertionOrderId()).isNotEqualTo(resolvedB.insertionOrderId());
	}

	@Test
	void shouldTreatAnOphPrefixedClientSentIdAsAGenerationRequestNotARealIdTest() {
		// Given: a row carrying a previewed OPH_ id (mode B's own preview) rather than a blank one - still
		// treated as "generate", since a real match can never produce an OPH_-prefixed id (2.2)
		stubDeliveryAccountKnown("dv_360_dlv", "DLV Main", "acct-1");
		stubGeneratedKeyUnused();
		AdjustmentRowModel row = addedRow(
				"dv_360_dlv", "DLV Main", "acct-1", "2026-03-15", SIXTEEN_SEGMENT_NAME, "OPH_stalepreview0",
				"lvl2", "OPH_stalepreview1", "lvl3", "OPH_stalepreview2");
		String expectedId = idGenerator.generate(List.of(SIXTEEN_SEGMENT_NAME));

		// When:
		AdjustmentRowModel resolved = validator.resolve(scope(), row);

		// Then: recomputed, not the stale preview value carried in
		assertThat(resolved.lineItemId()).isEqualTo(expectedId);
	}
}
