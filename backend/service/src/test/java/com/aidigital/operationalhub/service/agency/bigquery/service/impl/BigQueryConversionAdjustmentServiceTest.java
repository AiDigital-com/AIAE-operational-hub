package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.BigQueryWriteClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQueryWriteGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.CachedBigQuerySearchExecutor;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.model.ConversionAdjustmentRowModel;
import com.aidigital.operationalhub.service.agency.model.ConversionBreakdownQuery;
import com.aidigital.operationalhub.service.agency.model.ConversionRowExportModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowDateRangeModel;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import com.aidigital.operationalhub.service.entity.HubSyncLockService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Tests for the conversions adjustment path, whose whole job is that an adjustment replaces the previous
 * one rather than joining it - the conversions view counts both if it does not.
 *
 * <p>Covers {@link BigQueryConversionAdjustmentService} together with the three collaborators it delegates
 * to, wired for real over mocked BigQuery gateways. Deliberately not three test classes: what these assert
 * is the behaviour of the path from a request to the statements that reach BigQuery, and splitting them by
 * collaborator would test the seams instead of the thing the seams were carved out of.
 */
@ExtendWith(MockitoExtension.class)
class BigQueryConversionAdjustmentServiceTest {

	@Mock
	private BigQueryClient bigQueryClient;

	@Mock
	private BigQueryWriteClient bigQueryWriteClient;

	@Mock
	private BigQueryProperties bigQueryProperties;

	@Mock
	private CampaignService campaignService;

	@Mock
	private CampaignMartClientResolver clientResolver;

	@Mock
	private HubSyncLockService syncLockService;

	private BigQueryConversionAdjustmentService service;

	private ConversionAdjustmentWriter writer;

	@BeforeEach
	void setUp() {
		// The real collaborators over mocked gateways: the split is a rearrangement, and these tests are the
		// evidence that it did not change behaviour, so they exercise the same path end to end.
		BigQuerySearchGateway searchGateway = new BigQuerySearchGateway(
				bigQueryClient, bigQueryProperties, new CachedBigQuerySearchExecutor(bigQueryClient));
		writer = new ConversionAdjustmentWriter(
				searchGateway, new BigQueryWriteGateway(bigQueryWriteClient, bigQueryProperties), syncLockService);
		service = new BigQueryConversionAdjustmentService(
				campaignService,
				clientResolver,
				new ConversionRowReader(searchGateway, bigQueryProperties),
				new ConversionTemplateDiffer(),
				writer);
		lenient().when(bigQueryProperties.getConversionsWriteTable()).thenReturn("conversions_table");
		lenient().when(bigQueryProperties.getConversionsView()).thenReturn("conversions_view");
		lenient().when(syncLockService.tryAcquire("conversion_adjustments")).thenReturn(true);
		lenient().when(clientResolver.forConversionsMart(any())).thenAnswer(invocation -> invocation.getArgument(0));
	}

	private CampaignModel campaign() {
		return new CampaignModel(42L, "Ourisman Ford 2026", 10L, "Ourisman Ford", 20L, "&Barr",
				"Live", "2026-01-01", "2026-12-31", 1000.0, List.of("Display"), "Automotive", 1L);
	}

	private void givenCampaign() {
		when(campaignService.getVisibleCampaign(any(), anyLong())).thenReturn(campaign());
	}

	private ConversionAdjustmentRowModel adjustment(String action, Double conversions) {
		return new ConversionAdjustmentRowModel(
				"2026-03-10", "DV360", "Ourisman Main", "acct-1",
				action, "PURCHASE",
				"20_Ourisman Ford_AUTO_Ourisman Ford 2026_Display_Retargeting", "LI-1",
				"Display — Ourisman Ford 2026", "IO-1",
				"Hero 30s", "CR-1",
				conversions, "conversions");
	}

	private Map<String, Object> conversionRow(String action, Double conversions) {
		Map<String, Object> row = new HashMap<>();
		row.put("date", "2026-03-10");
		row.put("platform", "DV360");
		row.put("account", "Ourisman Main");
		row.put("account_id", "acct-1");
		row.put("conversion_action", action);
		row.put("conversion_category", "PURCHASE");
		row.put("constructed_name", "20_Ourisman Ford_AUTO_Ourisman Ford 2026_Display_Retargeting");
		row.put("constructed_id", "LI-1");
		row.put("constructed_name_lvl2", "Display — Ourisman Ford 2026");
		row.put("constructed_id_lvl2", "IO-1");
		row.put("constructed_name_lvl3", "Hero 30s");
		row.put("constructed_id_lvl3", "CR-1");
		row.put("conversions", conversions);
		return row;
	}

	private WorkbookAdjustmentRow uploadedRow(String action, String conversions) {
		Map<String, String> cells = new LinkedHashMap<>();
		cells.put("date", "2026-03-10");
		cells.put("line_item_id", "LI-1");
		cells.put("insertion_order_id", "IO-1");
		cells.put("creative_id", "CR-1");
		cells.put("conversion_action", action);
		cells.put("conversion_category", "PURCHASE");
		if (conversions != null) {
			cells.put("conversions", conversions);
		}
		return new WorkbookAdjustmentRow(2, cells);
	}

	@Test
	void shouldReadTheConversionsRowsAtTheirOwnPerActionGrainTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(conversionRow("Purchase", 12.0)));

		// When:
		ConversionRowExportModel export =
				service.findConversionRows(null, 42L, ReportRowDateRangeModel.none());

		// Then: the action is a column of its own here, unlike in the report, where it is summed away
		assertThat(export.rows()).hasSize(1);
		assertThat(export.rows().get(0).conversionAction()).isEqualTo("Purchase");
		assertThat(export.rows().get(0).conversions()).isEqualTo(12.0);
		assertThat(export.truncated()).isFalse();
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(sql.getValue()).contains("FROM `conversions_view`");
		assertThat(sql.getValue()).contains("`conversion_action`");
		assertThat(sql.getValue()).doesNotContain("GROUP BY");
	}

	@Test
	void shouldScopeTheTemplateReadToTheCampaignAndStopBeforeTodayTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(conversionRow("Purchase", 12.0)));

		// When:
		service.findConversionRows(null, 42L, new ReportRowDateRangeModel("2026-03-01", "2026-03-31"));

		// Then: a day still collecting conversions would be edited against a figure that moves by evening
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(sql.getValue()).contains("`CNB_campaign_name` = 'Ourisman Ford 2026'");
		assertThat(sql.getValue()).contains("`CNB_client` = 'Ourisman Ford'");
		assertThat(sql.getValue()).contains("`date` < CURRENT_DATE()");
		assertThat(sql.getValue()).contains("`date` >= '2026-03-01'");
	}

	@Test
	void shouldScopeTheTemplateReadWithTheEffectiveConversionsMartClientTest() {
		// Given: the campaign source client is stale, and the conversions mart resolver corrected it.
		CampaignModel sourceCampaign = new CampaignModel(
				42L, "TCL Mobile/Tablets 2026", 10L, "Wrong Client", 20L, "&Barr",
				"Live", "2026-01-01", "2026-12-31", 1000.0, List.of("Display"), "Automotive", 1L);
		CampaignModel martCampaign = new CampaignModel(
				42L, "TCL Mobile/Tablets 2026", 10L, "TCL", 20L, "&Barr",
				"Live", "2026-01-01", "2026-12-31", 1000.0, List.of("Display"), "Automotive", 1L);
		when(campaignService.getVisibleCampaign(any(), anyLong())).thenReturn(sourceCampaign);
		when(clientResolver.forConversionsMart(sourceCampaign)).thenReturn(martCampaign);
		when(bigQueryClient.query(anyString())).thenReturn(List.of(conversionRow("Purchase", 12.0)));

		// When:
		service.findConversionRows(null, 42L, ReportRowDateRangeModel.none());

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		verify(clientResolver).forConversionsMart(sourceCampaign);
		assertThat(sql.getValue()).contains("`CNB_campaign_name` = 'TCL Mobile/Tablets 2026'");
		assertThat(sql.getValue()).contains("`CNB_client` = 'TCL'");
		assertThat(sql.getValue()).doesNotContain("`CNB_client` = 'Wrong Client'");
	}

	@Test
	void shouldSelectTheBreakdownWithTheReportsOwnNameComparisonTest() {
		// Given: one report row, named the way the report joins conversions on
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(conversionRow("Purchase", 12.0)));

		// When:
		service.findConversionRowsBehind(null, 42L, new ConversionBreakdownQuery(
				"2026-03-10",
				"20_Ourisman Ford_AUTO_Ourisman Ford 2026_Display_Retargeting",
				"Hero 30s",
				"Display"));

		// Then: lower-cased and trimmed on both sides, and an absent level 3 compared as a value of its
		// own - the report's join exactly. A breakdown selected any other way would not sum to the cell
		// it sits under.
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(sql.getValue()).contains("`date` = '2026-03-10'");
		assertThat(sql.getValue()).contains(
				"LOWER(TRIM(`constructed_name`)) = "
						+ "LOWER(TRIM('20_Ourisman Ford_AUTO_Ourisman Ford 2026_Display_Retargeting'))");
		assertThat(sql.getValue()).contains(
				"LOWER(TRIM(COALESCE(`constructed_name_lvl3`, 'empty'))) = LOWER(TRIM('Hero 30s'))");
	}

	@Test
	void shouldCompareAnAbsentLevelThreeAgainstThePlaceholderTest() {
		// Given: a report row with no level-3 name
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of());

		// When:
		service.findConversionRowsBehind(null, 42L, new ConversionBreakdownQuery(
				"2026-03-10", "20_Ourisman Ford_AUTO_Ourisman Ford 2026_Display_Retargeting", null, "Display"));

		// Then: both sides become the placeholder, so rows that also lack a level 3 match - NULL = NULL
		// would match none of them
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(sql.getValue()).contains(
				"LOWER(TRIM(COALESCE(`constructed_name_lvl3`, 'empty'))) = LOWER(TRIM('empty'))");
	}

	@Test
	void shouldIgnoreLevelThreeOnAChannelThatReportsAgainstTheCampaignTest() {
		// Given: Google Search, whose conversions the report attaches without matching level 3
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(conversionRow("Purchase", 12.0)));

		// When:
		service.findConversionRowsBehind(null, 42L, new ConversionBreakdownQuery(
				"2026-03-10",
				"20_Ourisman Ford_AUTO_Ourisman Ford 2026_Display_Retargeting",
				"Hero 30s",
				"Google Search"));

		// Then: no level-3 predicate - keeping it would show one creative's slice under a figure that
		// covers the whole campaign. The column itself stays in the select list, as it does for every
		// breakdown row; what must be gone is the comparison.
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(sql.getValue()).contains("`constructed_name_lvl3`");
		assertThat(sql.getValue()).doesNotContain("COALESCE(`constructed_name_lvl3`");
	}

	@Test
	void shouldNarrowByLevelThreeWhenTheRowHasNoChannelTest() {
		// Given: a report row the name-builder mapping does not cover, so it arrives with no channel
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(conversionRow("Purchase", 12.0)));

		// When:
		service.findConversionRowsBehind(null, 42L, new ConversionBreakdownQuery(
				"2026-03-10",
				"20_Ourisman Ford_AUTO_Ourisman Ford 2026_Display_Retargeting",
				"Hero 30s",
				null));

		// Then: level 3 still narrows the read, matching what the join does with a NULL channel - `IN` is
		// unknown there, not true. Answering it by asking an immutable list whether it contains null threw
		// instead, and every breakdown on an unmapped row failed.
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(sql.getValue()).contains(
				"LOWER(TRIM(COALESCE(`constructed_name_lvl3`, 'empty'))) = LOWER(TRIM('Hero 30s'))");
	}

	@Test
	void shouldWriteAnUploadedRowWhoseFigureChangedTest() {
		// Given: the sheet says 30 where the mart says 12
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(conversionRow("Purchase", 12.0)));
		// Different answers per statement, so the assertion can tell the two apart: five rows removed,
		// one written. A single stubbed value would let a count of deletes pass as a count of writes.
		when(bigQueryWriteClient.execute(anyString()))
				.thenAnswer(call -> call.getArgument(0, String.class).startsWith("DELETE") ? 5L : 1L);

		// When:
		int written = service.applyConversionAdjustments(
				Instancio.create(CurrentUserModel.class), 42L, List.of(uploadedRow("Purchase", "30")));

		// Then: the count is the inserted rows, not the deleted ones - it is what the success toast shows
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(2)).execute(sql.capture());
		assertThat(sql.getAllValues().get(0)).startsWith("DELETE FROM `conversions_table`");
		assertThat(sql.getAllValues().get(1)).contains("30.0");
		assertThat(written).isEqualTo(1);
	}

	@Test
	void shouldTakeTheWrittenIdentityFromTheMartNotFromTheSheetTest() {
		// Given: the sheet's identity cells find the row; they do not describe it
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(conversionRow("Purchase", 12.0)));

		// When:
		service.applyConversionAdjustments(
				Instancio.create(CurrentUserModel.class), 42L, List.of(uploadedRow("Purchase", "30")));

		// Then: a level name the sheet never carried is still written, because it came from the matched row
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(2)).execute(sql.capture());
		assertThat(sql.getAllValues().get(1)).contains("'Hero 30s'");
		assertThat(sql.getAllValues().get(1)).contains("'Display — Ourisman Ford 2026'");
	}

	@Test
	void shouldMatchAKeyWhoseMartValueCarriesStrayWhitespaceTest() {
		// Given: the mart's level-3 id has a trailing space, which the spreadsheet reader trims away
		givenCampaign();
		Map<String, Object> martRow = conversionRow("Purchase", 12.0);
		martRow.put("constructed_id_lvl3", "CR-1 ");
		when(bigQueryClient.query(anyString())).thenReturn(List.of(martRow));

		// When:
		service.applyConversionAdjustments(
				Instancio.create(CurrentUserModel.class), 42L, List.of(uploadedRow("Purchase", "30")));

		// Then: the row still finds its baseline - untrimmed, this key could never match and the whole
		// upload would be rejected for a reason invisible to the user
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(2)).execute(sql.capture());
		assertThat(sql.getAllValues().get(1)).contains("30.0");
	}

	@Test
	void shouldMatchAKeyWhoseMartValueIsAnEmptyStringTest() {
		// Given: the mart reports an empty level-3 id; the reader omits an empty cell entirely, so the
		// uploaded side reads null
		givenCampaign();
		Map<String, Object> martRow = conversionRow("Purchase", 12.0);
		martRow.put("constructed_id_lvl3", "");
		when(bigQueryClient.query(anyString())).thenReturn(List.of(martRow));
		Map<String, String> cells = new LinkedHashMap<>();
		cells.put("date", "2026-03-10");
		cells.put("line_item_id", "LI-1");
		cells.put("insertion_order_id", "IO-1");
		cells.put("conversion_action", "Purchase");
		cells.put("conversion_category", "PURCHASE");
		cells.put("conversions", "30");

		// When:
		service.applyConversionAdjustments(
				Instancio.create(CurrentUserModel.class), 42L, List.of(new WorkbookAdjustmentRow(2, cells)));

		// Then: "" and an absent cell resolve to the same key, so the round-trip holds
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(2)).execute(sql.capture());
		assertThat(sql.getAllValues().get(1)).contains("30.0");
	}

	@Test
	void shouldNotFoldTwoKeysThatDifferOnlyInCaseTest() {
		// Given: the mart has "purchase"; the sheet names "Purchase" - two different actions, not one
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(conversionRow("purchase", 12.0)));

		// When-Then: normalizing case would silently write one action's figure onto another's row
		assertThatThrownBy(() -> service.applyConversionAdjustments(
				Instancio.create(CurrentUserModel.class), 42L, List.of(uploadedRow("Purchase", "30"))))
				.isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_027.getCode());
	}

	@Test
	void shouldSkipAnUploadedRowWhoseFigureIsUnchangedTest() {
		// Given: the sheet restates what the mart already says
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(conversionRow("Purchase", 12.0)));

		// When:
		int written = service.applyConversionAdjustments(
				null, 42L, List.of(uploadedRow("Purchase", "12")));

		// Then: nothing written, and nothing deleted either - an unchanged row is not an edit
		assertThat(written).isZero();
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldRejectAnUploadedRowThatMatchesNoConversionsRowTest() {
		// Given: the mart has a Purchase row; the sheet names a Lead row
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(conversionRow("Purchase", 12.0)));

		// When-Then:
		assertThatThrownBy(() -> service.applyConversionAdjustments(
				null, 42L, List.of(uploadedRow("Lead", "30"))))
				.isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_027.getCode());
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldNotReadAnythingForAnUploadWithNoRowsTest() {
		// Given: a file holding only its header
		givenCampaign();
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);

		// When:
		int written = service.applyConversionAdjustments(user, 42L, List.of());

		// Then: no baseline read - with no rows there is nothing to narrow it by, so it would have scanned
		// the campaign's whole conversions history to diff nothing against it
		assertThat(written).isZero();
		verifyNoInteractions(bigQueryClient);
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldReportEveryStaleRowAtOnceRatherThanTheFirstTest() {
		// Given: the mart has one Purchase row; the sheet names three actions that no longer exist
		givenCampaign();
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		when(bigQueryClient.query(anyString())).thenReturn(List.of(conversionRow("Purchase", 12.0)));
		List<WorkbookAdjustmentRow> rows = List.of(
				new WorkbookAdjustmentRow(2, uploadedRow("Lead", "30").cells()),
				new WorkbookAdjustmentRow(3, uploadedRow("Install", "40").cells()),
				new WorkbookAdjustmentRow(4, uploadedRow("Signup", "50").cells()));

		// When-Then: naming only row 2 would send someone to fix one line of a file where three are stale,
		// and they would learn that one row per attempt
		assertThatThrownBy(() -> service.applyConversionAdjustments(user, 42L, rows))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("3 of 3")
				.hasMessageContaining("2, 3, 4");
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldSayTheUploadIsTooLargeToMatchRatherThanCallEveryRowStaleTest() {
		// Given: a baseline read that comes back one row past the cap
		givenCampaign();
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		List<Map<String, Object>> overflowing = new ArrayList<>();
		for (int row = 0; row <= 100_000; row++) {
			overflowing.add(conversionRow("Purchase " + row, 1.0));
		}
		when(bigQueryClient.query(anyString())).thenReturn(overflowing);

		// When-Then: undetected, the rows past the cap are simply absent from the map and every uploaded row
		// pointing at one reads as stale - sending the user to fix a template that is not the problem
		assertThatThrownBy(() -> service.applyConversionAdjustments(
				user, 42L, List.of(uploadedRow("Purchase", "30"))))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("more than 100000 conversions rows");
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldRejectAnUploadedRowWithANonNumericConversionsCellTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(conversionRow("Purchase", 12.0)));

		// When-Then: silently treating it as no change would lose the user's edit without saying so
		assertThatThrownBy(() -> service.applyConversionAdjustments(
				null, 42L, List.of(uploadedRow("Purchase", "twelve"))))
				.isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_027.getCode());
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldNarrowTheBaselineReadToTheUploadsOwnDatesAndLineItemsTest() {
		// Given:
		givenCampaign();
		when(bigQueryClient.query(anyString())).thenReturn(List.of(conversionRow("Purchase", 12.0)));

		// When:
		service.applyConversionAdjustments(
				Instancio.create(CurrentUserModel.class), 42L, List.of(uploadedRow("Purchase", "30")));

		// Then: a campaign-wide read to diff a handful of rows would be paid for nothing
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient).query(sql.capture());
		assertThat(sql.getValue()).contains("`date` IN ('2026-03-10')");
		assertThat(sql.getValue()).contains("`constructed_id` IN ('LI-1')");
	}

	@Test
	void shouldDeleteTheKeyBeforeInsertingItsReplacementTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);

		// When:
		writer.replaceAdjustments(campaign(), user, List.of(adjustment("Purchase", 12.0)));

		// Then: the order is the contract - an insert reaching BigQuery before the delete would
		// leave two rows for one key, and the view sums both
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(2)).execute(sql.capture());
		assertThat(sql.getAllValues().get(0)).startsWith("DELETE FROM `conversions_table`");
		assertThat(sql.getAllValues().get(1)).startsWith("INSERT INTO `conversions_table`");
	}

	@Test
	void shouldDeleteByEveryColumnOfTheNaturalKeyTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);

		// When:
		writer.replaceAdjustments(campaign(), user, List.of(adjustment("Purchase", 12.0)));

		// Then: a delete on any narrower key would remove rows the insert does not put back, and every text
		// comparison goes through the marts' absent-value placeholder - the identity we hold was read through
		// a view that emits COALESCE(col, 'not set'), so an exact match would miss a row stored as NULL
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(2)).execute(sql.capture());
		String delete = sql.getAllValues().get(0);
		for (String column : BigQueryConversionsViewColumns.TEXT_NATURAL_KEY) {
			assertThat(delete).contains("COALESCE(`" + column + "`, 'not set') = ");
		}
	}

	@Test
	void shouldCompareTheDateColumnWithoutTheTextPlaceholderTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);

		// When:
		writer.replaceAdjustments(campaign(), user, List.of(adjustment("Purchase", 12.0)));

		// Then: date is the one key column that is not text. BigQuery has no common type for a DATE and
		// 'not set', so wrapping it would fail the statement at analysis and the whole write with it - the
		// view draws the same line, comparing its date through a DATE sentinel instead.
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(2)).execute(sql.capture());
		String delete = sql.getAllValues().get(0);
		assertThat(delete).contains("`" + BigQueryConversionsViewColumns.DATE + "` = ");
		assertThat(delete).doesNotContain("COALESCE(`" + BigQueryConversionsViewColumns.DATE + "`");
	}

	@Test
	void shouldWriteTheConversionsValueAndLeaveTheOtherMetricsUnsetTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);

		// When:
		writer.replaceAdjustments(campaign(), user, List.of(adjustment("Purchase", 12.0)));

		// Then: an unwritten metric falls back to the mart's own figure in the view; a zero would
		// instead assert the day had none
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(2)).execute(sql.capture());
		String insert = sql.getAllValues().get(1);
		assertThat(insert).contains("`conversions`");
		assertThat(insert).contains("12.0");
		assertThat(insert).doesNotContain("`revenue`");
		assertThat(insert).doesNotContain("`installs`");
		assertThat(insert).doesNotContain("`all_conversions`");
		assertThat(insert).doesNotContain("`post_view_conversions`");
	}

	@Test
	void shouldStampTheServerClockAndTheCurrentUserNotTheCallerTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);

		// When:
		writer.replaceAdjustments(campaign(), user, List.of(adjustment("Purchase", 12.0)));

		// Then: DATETIME, evaluated by BigQuery - the write table's audit columns reject a TIMESTAMP
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(2)).execute(sql.capture());
		String insert = sql.getAllValues().get(1);
		assertThat(insert).contains("CURRENT_DATETIME()");
		assertThat(insert).contains("'" + user.email() + "'");
	}

	@Test
	void shouldKeepOnlyTheLastAdjustmentWhenOneBatchNamesAKeyTwiceTest() {
		// Given: the same day, line item and action twice - a spreadsheet can easily say this
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		List<ConversionAdjustmentRowModel> adjustments =
				List.of(adjustment("Purchase", 12.0), adjustment("Purchase", 30.0));
		when(bigQueryWriteClient.execute(anyString()))
				.thenAnswer(call -> call.getArgument(0, String.class).startsWith("DELETE") ? 5L : 1L);

		// When:
		long written = writer.replaceAdjustments(campaign(), user, adjustments);

		// Then: both rows would carry the same last_modified_at, so no reader could separate them -
		// the later value wins here instead, and one row is reported written rather than two
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(2)).execute(sql.capture());
		String insert = sql.getAllValues().get(1);
		assertThat(insert).contains("30.0");
		assertThat(insert).doesNotContain("12.0");
		assertThat(written).isEqualTo(1L);
	}

	@Test
	void shouldWriteBothAdjustmentsWhenOnlyTheConversionActionDiffersTest() {
		// Given: one line item on one day, two actions - two rows in the conversions mart, not one
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		List<ConversionAdjustmentRowModel> adjustments =
				List.of(adjustment("Purchase", 12.0), adjustment("Lead", 30.0));

		// When:
		writer.replaceAdjustments(campaign(), user, adjustments);

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryWriteClient, times(2)).execute(sql.capture());
		assertThat(sql.getAllValues().get(1)).contains("12.0").contains("30.0");
	}

	@Test
	void shouldRefuseAnAdjustmentWhoseNameBelongsToAnotherCampaignTest() {
		// Given: this table has no campaign columns of its own, so the level-1 name is the only boundary
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		ConversionAdjustmentRowModel foreign = new ConversionAdjustmentRowModel(
				"2026-03-10", "DV360", "Ourisman Main", "acct-1",
				"Purchase", "PURCHASE",
				"20_Someone Else_AUTO_Someone Else 2026_Display_Retargeting", "LI-9",
				"lvl2", "IO-9", "lvl3", "CR-9",
				12.0, "conversions");

		// When-Then:
		assertThatThrownBy(() -> writer.replaceAdjustments(campaign(), user, List.of(foreign)))
				.isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_027.getCode());
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldRefuseAnAdjustmentWithNoConversionActionTest() {
		// Given: without an action there is no conversions row to replace
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		ConversionAdjustmentRowModel actionless = adjustment(" ", 12.0);

		// When-Then:
		assertThatThrownBy(() -> writer.replaceAdjustments(campaign(), user, List.of(actionless)))
				.isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_027.getCode());
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldRefuseAnAdjustmentThatSetsNoConversionsValueTest() {
		// Given: nothing to write - the row would delete the previous adjustment and replace it with null
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		ConversionAdjustmentRowModel empty = adjustment("Purchase", null);

		// When-Then:
		assertThatThrownBy(() -> writer.replaceAdjustments(campaign(), user, List.of(empty)))
				.isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_027.getCode());
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldRefuseAnEmptyBatchTest() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);

		// When-Then:
		assertThatThrownBy(() -> writer.replaceAdjustments(campaign(), user, List.of()))
				.isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_027.getCode());
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldNotInsertWhenTheDeleteFailsTest() {
		// Given: the delete is what makes the insert a replacement, so a failed delete is fatal to both
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		when(bigQueryWriteClient.execute(contains("DELETE FROM")))
				.thenThrow(new BigQueryExternalException("Access Denied: no delete permission"));

		// When-Then:
		assertThatThrownBy(() -> writer.replaceAdjustments(campaign(), user, List.of(adjustment("Purchase", 12.0))))
				.isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_026.getCode());
		verify(bigQueryWriteClient, times(1)).execute(anyString());
	}

	@Test
	void shouldRefuseToWriteWhileAnotherConversionsWriteHoldsTheLockTest() {
		// Given: another write is mid-flight. Two overlapping delete/insert pairs interleave as
		// delete, delete, insert, insert and leave two rows for one key - the doubling the delete prevents.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		when(syncLockService.tryAcquire("conversion_adjustments")).thenReturn(false);

		// When-Then: refused rather than queued, so the user is told to retry instead of waiting blind
		assertThatThrownBy(() -> writer.replaceAdjustments(campaign(), user, List.of(adjustment("Purchase", 12.0))))
				.isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_033.getCode());
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldReleaseTheLockWhenTheWriteFailsTest() {
		// Given: the delete fails, which aborts the whole write
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		when(bigQueryWriteClient.execute(contains("DELETE FROM")))
				.thenThrow(new BigQueryExternalException("Access Denied: no delete permission"));

		// When:
		assertThatThrownBy(() -> writer.replaceAdjustments(campaign(), user, List.of(adjustment("Purchase", 12.0))))
				.isInstanceOf(BusinessException.class);

		// Then: released anyway - a lock left held by a failed write would block the campaign's conversions
		// for everyone until someone cleared the row by hand
		verify(syncLockService).release("conversion_adjustments");
	}

	@Test
	void shouldRefuseToWriteWhenTheCampaignHasNoNameToCheckAgainstTest() {
		// Given: a campaign whose name is unknown. This table has no campaign columns of its own - the view
		// splits the level-1 name to derive them - so the name is the only boundary there is.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		CampaignModel nameless = new CampaignModel(42L, null, 10L, "Ourisman Ford", 20L, "&Barr",
				"Live", "2026-01-01", "2026-12-31", 1000.0, List.of("Display"), "Automotive", 1L);

		// When-Then: refused. Allowing it would let any level-1 name through, another client's included
		assertThatThrownBy(() -> writer.replaceAdjustments(nameless, user, List.of(adjustment("Purchase", 12.0))))
				.isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_027.getCode());
		verifyNoInteractions(bigQueryWriteClient);
	}

	@Test
	void shouldResolveTheCampaignBeforeTouchingBigQueryTest() {
		// Given: an unknown or invisible campaign
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		when(campaignService.getVisibleCampaign(any(), anyLong()))
				.thenThrow(new BusinessException(OperationalHubErrorReason.OPH_025, "999"));

		// When-Then:
		assertThatThrownBy(() -> service.applyConversionAdjustments(user, 999L, List.of(uploadedRow("Purchase", "30"))))
				.isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_025.getCode());
		verifyNoInteractions(bigQueryWriteClient);
	}
}
