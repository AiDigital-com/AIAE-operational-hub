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
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.instancio.Select.field;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link AddedRowValidator} - PDI_117 V1-V8, applied to every manually-added report row
 * before it is written. Resolution is per level (D2): one row may carry real ids at some levels and
 * generated ids at others, so most scenarios below are expressed as which of the three levels resolves
 * to a real mart entity versus generates a fresh id.
 *
 * <p>PDI_117-perf: this class folds what used to be up to six scoped BigQuery reads per row (each
 * re-scanning the view twice via a nested campaign-scope subquery) into as few as three single-pass
 * reads - a campaign-scope read, one folded V1-plus-three-level-resolve read, and one unscoped V4 read,
 * with a fourth, narrower read only when the unscoped read finds a collision. The read-count and
 * generated-SQL tests below pin that shape down so it cannot silently regress; every V1-V8 test still
 * exercises the exact same validation outcomes and error codes as before.
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

	/** Stubs the campaign-scope read ({@link CampaignDeliveryScope#constructedNames()}) to the given names. */
	private void stubScopeNames(String... names) {
		when(bigQueryClient.query(NAMES_MARKER_SQL)).thenReturn(
				List.of(names).stream().map(name -> Map.<String, Object>of("constructed_name", name)).toList());
	}

	/** Stubs the folded V1-plus-three-level read (identified by its {@code ARRAY_AGG}-led select list). */
	private void stubFoldedResolution(
			List<String> lvl1Ids, List<String> lvl2Ids, List<String> lvl3Ids, boolean hasDelivery) {
		when(bigQueryClient.query(argThat(sql -> sql != null && sql.startsWith("SELECT ARRAY_AGG"))))
				.thenReturn(List.of(Map.of(
						"matched_ids_lvl1", lvl1Ids,
						"matched_ids_lvl2", lvl2Ids,
						"matched_ids_lvl3", lvl3Ids,
						"has_delivery", hasDelivery)));
	}

	/** Stubs V4's unscoped final-key read (no {@code platform} predicate) to find nothing. */
	private void stubUnscopedKeyUnused() {
		when(bigQueryClient.query(argThat(sql -> sql != null && sql.startsWith("SELECT `date` AS date FROM")
				&& !sql.contains("`platform`"))))
				.thenReturn(List.of());
	}

	/** Stubs V4's unscoped final-key read to find an existing row on the row's date. */
	private void stubUnscopedKeyAlreadyUsed() {
		when(bigQueryClient.query(argThat(sql -> sql != null && sql.startsWith("SELECT `date` AS date FROM")
				&& !sql.contains("`platform`"))))
				.thenReturn(List.of(Map.of("date", "2026-03-15")));
	}

	/** Stubs V3's campaign-scoped final-key read (carries a {@code platform} predicate) to find a row. */
	private void stubScopedOverrideExistsOnDate() {
		when(bigQueryClient.query(argThat(sql -> sql != null && sql.startsWith("SELECT `date` AS date FROM")
				&& sql.contains("`platform`"))))
				.thenReturn(List.of(Map.of("date", "2026-03-15")));
	}

	@Test
	void shouldRejectWhenPlatformAccountOrAccountIdIsBlankTest() {
		// Given: V1 (blank-input half) - no BigQuery read should even be attempted
		AdjustmentRowModel row = allRealRow("dv_360_dlv", "DLV Main", "", "2026-03-15");

		// When/Then:
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_043");
		verify(bigQueryClient, never()).query(anyString());
	}

	@Test
	void shouldRejectWhenTheDeliveryAccountTripleIsUnknownToTheCampaignTest() {
		// Given: V1 (existence half) - the folded read's default (unstubbed) answer carries no delivery
		AdjustmentRowModel row = allRealRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When/Then:
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_043");
	}

	@Test
	void shouldRejectALevelWhoseRealIdDoesNotMatchTheResolvedNameTest() {
		// Given: V2 - level 1's name resolves to a different id than the client claims
		stubFoldedResolution(List.of("real-id"), List.of(), List.of(), true);
		AdjustmentRowModel row = allRealRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When/Then: row claims "id1", the name only resolves to "real-id"
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_044");
	}

	@Test
	void shouldResolveARealLevelWhenTheClientClaimedIdIsAmongTheCampaignsMatchedIdsTest() {
		// Given: V2 positive + V5 - the id is accepted only because the folded read's own matched-id set
		// for this exact name contains it; a matched row's name is always the client's own typed name
		// (the folded read's condition is an exact equality), so the id is what is independently
		// re-verified against the mart, never the client's say-so alone
		stubFoldedResolution(List.of("id1"), List.of("id2"), List.of("id3"), true);
		stubUnscopedKeyUnused();
		AdjustmentRowModel row = allRealRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When:
		AdjustmentRowModel resolved = validator.resolve(scope(), row);

		// Then:
		assertThat(resolved.lineItemName()).isEqualTo("Line 1");
		assertThat(resolved.lineItemId()).isEqualTo("id1");
		assertThat(resolved.insertionOrderName()).isEqualTo("IO 1");
		assertThat(resolved.insertionOrderId()).isEqualTo("id2");
		assertThat(resolved.campaignConstructedName()).isEqualTo("Creative 1");
		assertThat(resolved.campaignConstructedId()).isEqualTo("id3");
	}

	@Test
	void shouldRejectGeneratingALevelWhoseNameAlreadyResolvesToOneEntityTest() {
		// Given: V8 - the client asked to generate (blank id), but the name matches a real entity
		stubFoldedResolution(List.of("id1"), List.of(), List.of(), true);
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
		stubFoldedResolution(List.of("id1", "id1b"), List.of(), List.of(), true);
		AdjustmentRowModel row = allGeneratedRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When/Then:
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_049");
	}

	@Test
	void shouldGenerateWhenTheNameResolvesToNothingTest() {
		// Given: V8 positive - genuinely nothing to resolve
		stubFoldedResolution(List.of(), List.of(), List.of(), true);
		stubUnscopedKeyUnused();
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
		stubFoldedResolution(List.of("id1"), List.of("id2"), List.of(), true);
		stubUnscopedKeyUnused();
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
		// Given: V3 - every level resolved real, and that exact entity already has a row on this date;
		// the unscoped V4 check finds the collision first, then the narrower scoped check confirms it
		// falls within this campaign
		stubFoldedResolution(List.of("id1"), List.of("id2"), List.of("id3"), true);
		stubUnscopedKeyAlreadyUsed();
		stubScopedOverrideExistsOnDate();
		AdjustmentRowModel row = allRealRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When/Then:
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_045");
	}

	@Test
	void shouldNotApplyV3WhenAnyLevelWasGeneratedEvenIfTheKeyWouldOtherwiseCollideTest() {
		// Given: level 3 is generated (new creative), so V3 (override-in-disguise) must not run at all -
		// the scoped collision check is stubbed (lenient - it is expected to go unused) to report a
		// collision, proving it is never consulted rather than merely never colliding; the unscoped V4
		// check alone decides, and a freshly generated id genuinely is not already used
		stubFoldedResolution(List.of("id1"), List.of("id2"), List.of(), true);
		stubUnscopedKeyUnused();
		lenient().when(bigQueryClient.query(argThat(sql -> sql != null && sql.startsWith("SELECT `date` AS date FROM")
				&& sql.contains("`platform`"))))
				.thenReturn(List.of(Map.of("date", "2026-03-15")));
		AdjustmentRowModel row = addedRow(
				"dv_360_dlv", "DLV Main", "acct-1", "2026-03-15", "Line 1", "id1", "IO 1", "id2",
				"Brand New Creative", null);

		// When/Then: resolves without throwing, and the scoped (platform-carrying) check is never called
		AdjustmentRowModel resolved = validator.resolve(scope(), row);
		assertThat(resolved.campaignConstructedId()).startsWith("OPH_");
		verify(bigQueryClient, never()).query(argThat(
				sql -> sql != null && sql.startsWith("SELECT `date` AS date FROM") && sql.contains("`platform`")));
	}

	@Test
	void shouldRejectWhenTheGeneratedKeyAlreadyExistsInTheMartTest() {
		// Given: V4 - applies to the final key regardless of origin; since every level here is generated,
		// the collision is decided by the unscoped read alone, no second (scoped) read needed
		stubFoldedResolution(List.of(), List.of(), List.of(), true);
		stubUnscopedKeyAlreadyUsed();
		AdjustmentRowModel row = allGeneratedRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When/Then:
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_046");
		verify(bigQueryClient, never()).query(argThat(
				sql -> sql != null && sql.startsWith("SELECT `date` AS date FROM") && sql.contains("`platform`")));
	}

	@Test
	void shouldRejectGeneratingLevelOneWhenTheNameDoesNotHaveSixteenSegmentsTest() {
		// Given: V6 - only applies when level 1 itself is generated
		stubFoldedResolution(List.of(), List.of(), List.of(), true);
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
		stubFoldedResolution(List.of("id1"), List.of(), List.of(), true);
		stubUnscopedKeyUnused();
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
		stubScopeNames(
				"AG_CL_IND_CAMP_x1_x2_x3_x4_x5_x6_x7_x8_x9_x10_x11_x12",
				"AG_CL_IND_CAMP_y1_y2_y3_y4_y5_y6_y7_y8_y9_y10_y11_y12");
		stubFoldedResolution(List.of(), List.of(), List.of(), true);
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
		stubFoldedResolution(List.of(), List.of(), List.of(), true);
		stubUnscopedKeyUnused();
		AdjustmentRowModel row = allGeneratedRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When: does not throw
		AdjustmentRowModel resolved = validator.resolve(scope(), row);

		// Then:
		assertThat(resolved.lineItemId()).startsWith("OPH_");
	}

	@Test
	void shouldGenerateFreshDeterministicIdsFromNameAndCampaignScopeIgnoringWhateverTheClientSentTest() {
		// Given: D3 - level 1 hashes its own name; levels 2/3 hash the campaign scope plus their own name
		stubFoldedResolution(List.of(), List.of(), List.of(), true);
		stubUnscopedKeyUnused();
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
		stubFoldedResolution(List.of(), List.of(), List.of(), true);
		stubUnscopedKeyUnused();
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
		stubFoldedResolution(List.of(), List.of(), List.of(), true);
		stubUnscopedKeyUnused();
		AdjustmentRowModel row = addedRow(
				"dv_360_dlv", "DLV Main", "acct-1", "2026-03-15", SIXTEEN_SEGMENT_NAME, "OPH_stalepreview0",
				"lvl2", "OPH_stalepreview1", "lvl3", "OPH_stalepreview2");
		String expectedId = idGenerator.generate(List.of(SIXTEEN_SEGMENT_NAME));

		// When:
		AdjustmentRowModel resolved = validator.resolve(scope(), row);

		// Then: recomputed, not the stale preview value carried in
		assertThat(resolved.lineItemId()).isEqualTo(expectedId);
	}

	@Test
	void shouldIssueExactlyThreeGatewayReadsForAHappyPathAddedRowWithNoCollisionTest() {
		// Given: PDI_117-perf - down from the original six reads (a campaign-scope read, the folded
		// V1-plus-three-level-resolve read, and the unscoped V4 read); the narrower, campaign-scoped V3
		// read only runs when the unscoped read finds a collision, which it does not here
		stubScopeNames("Line 1");
		stubFoldedResolution(List.of("id1"), List.of("id2"), List.of("id3"), true);
		stubUnscopedKeyUnused();
		AdjustmentRowModel row = allRealRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");
		ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);

		// When:
		validator.resolve(scope(), row);

		// Then: exactly three reads, in order: scope names, the folded read, the unscoped key check
		verify(bigQueryClient, times(3)).query(sqlCaptor.capture());
		List<String> queries = sqlCaptor.getAllValues();
		assertThat(queries.get(0)).isEqualTo(NAMES_MARKER_SQL);
		assertThat(queries.get(1)).startsWith("SELECT ARRAY_AGG");
		assertThat(queries.get(2)).startsWith("SELECT `date` AS date FROM");
	}

	@Test
	void shouldIssueFourGatewayReadsWhenTheUnscopedKeyCheckFindsACollisionTest() {
		// Given: the collision path - the unscoped V4 read finds something, so the narrower, campaign-
		// scoped V3 read is needed as a fourth read to tell the two errors apart
		stubScopeNames("Line 1");
		stubFoldedResolution(List.of("id1"), List.of("id2"), List.of("id3"), true);
		stubUnscopedKeyAlreadyUsed();
		stubScopedOverrideExistsOnDate();
		AdjustmentRowModel row = allRealRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");

		// When/Then:
		assertThatThrownBy(() -> validator.resolve(scope(), row))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo("OPH_045");
		verify(bigQueryClient, times(4)).query(anyString());
	}

	@Test
	void shouldInlineTheCampaignScopeAsLiteralsInTheFoldedReadWithoutTheNestedSubqueryTest() {
		// Given: PDI_117-perf - the folded read's campaign-scope predicate is rendered as escaped string
		// literals, not the old nested "SELECT DISTINCT constructed_name ..." subquery, which cost the
		// view a second full scan on every one of the original six reads
		stubScopeNames("Line 1", "IO 1");
		stubFoldedResolution(List.of("id1"), List.of("id2"), List.of("id3"), true);
		stubUnscopedKeyUnused();
		AdjustmentRowModel row = allRealRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");
		ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);

		// When:
		validator.resolve(scope(), row);

		// Then:
		verify(bigQueryClient, times(3)).query(sqlCaptor.capture());
		String foldedSql = sqlCaptor.getAllValues().stream()
				.filter(sql -> sql.startsWith("SELECT ARRAY_AGG"))
				.findFirst()
				.orElseThrow();
		assertThat(foldedSql).contains("`constructed_name` IN ('Line 1', 'IO 1')");
		assertThat(foldedSql).doesNotContain("SELECT DISTINCT");
		assertThat(foldedSql).doesNotContain(NAMES_MARKER_SQL);
	}

	@Test
	void shouldFallBackToTheSubqueryFormWhenTheCampaignScopeIsTooLargeToInlineTest() {
		// Given: a campaign scope large enough that inlining it as literals would push the statement past
		// BigQuery's length ceiling (BqInsert.MAX_STATEMENT_BYTES) - falls back to the original nested
		// subquery form rather than breaking the statement, the same idea BqInsert.Builder#buildBatches
		// applies to an oversized write batch
		// Each name's own leading segment is unique, so they share no naming-convention prefix (V7 has
		// nothing to enforce) and only the scope's sheer size drives this test.
		List<String> hugeScope = IntStream.range(0, 80_000).mapToObj(index -> index + "_scope_name").toList();
		when(bigQueryClient.query(NAMES_MARKER_SQL)).thenReturn(
				hugeScope.stream().map(name -> Map.<String, Object>of("constructed_name", name)).toList());
		stubFoldedResolution(List.of(), List.of(), List.of(), true);
		stubUnscopedKeyUnused();
		AdjustmentRowModel row = allGeneratedRow("dv_360_dlv", "DLV Main", "acct-1", "2026-03-15");
		ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);

		// When:
		validator.resolve(scope(), row);

		// Then: the folded read falls back to the nested subquery instead of an inlined literal list
		verify(bigQueryClient, times(3)).query(sqlCaptor.capture());
		String foldedSql = sqlCaptor.getAllValues().stream()
				.filter(sql -> sql.startsWith("SELECT ARRAY_AGG"))
				.findFirst()
				.orElseThrow();
		assertThat(foldedSql).contains("`constructed_name` IN (SELECT `constructed_name` FROM (" + NAMES_MARKER_SQL
				+ "))");
	}
}
