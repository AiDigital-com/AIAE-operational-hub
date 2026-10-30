package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingMappingSuggestedDimension;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingMappingSuggestedValue;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingMappingSuggestions;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingMappingSuggestionsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertRuleBandV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertRuleBaseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertRuleDaysV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertRuleFactorV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertRuleGapDaysV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertRuleGapPpV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertRuleSpendV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertRuleThresholdPctV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertRuleWindowThresholdV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertsConfigV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCampaignLinkV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCampaignLinksUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDataSettingsUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDataSourceV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDimSourcesV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryEntryV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryKindV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryListResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryVisibilityV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNotifyMetricsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNotifySettingsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRefreshStatusV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingSummaryProjectionV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleBand;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleBase;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleDays;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleFactor;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleGapDays;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleGapPp;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleSpend;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleThresholdPct;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleWindowThreshold;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertsConfig;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSheetTab;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignLink;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDataSettings;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingJournalEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibraryEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNotifyMetrics;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNotifySettings;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshStatus;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingThirdPartyCampaignsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingThirdPartyDataV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyCampaign;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyCampaigns;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyData;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyStatus;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingThirdPartyStatusV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceBinding;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceGroup;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceRead;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceSuggestions;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceValue;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceValues;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSheetProbe;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDimSourceReadV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDimSourceSuggestionsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDimSourceValuesV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingSheetProbeV1;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link PacingDashboardContractMapper}.
 */
class PacingDashboardContractMapperTest {

	private final PacingDashboardContractMapper mapper = new PacingDashboardContractMapper();

	@Test
	void shouldAllowEditOnlyForTheEntrysOwnAuthorOrAnUnrestrictedScopeTest() {
		// Still here after the dashboard pass-through (2026-10-29): the journal WRITE responses are
		// built by this method, and the browser-side port of the same rule (wire.ts) is held to it by
		// its parity test over real bodies - so this case and that one must keep agreeing.
		// Given: one entry authored by "pu-1".
		PacingJournalEntry entry = new PacingJournalEntry("j1", "2026-08-05", "Note", "someone@aidigital.com", "pu-1", null);

		// When/Then: a different, restricted-scope caller may not edit it.
		assertThat(mapper.toJournalV1(List.of(entry), "pu-2", false).get(0).getCanEdit()).isFalse();
		// When/Then: the entry's own author may.
		assertThat(mapper.toJournalV1(List.of(entry), "pu-1", false).get(0).getCanEdit()).isTrue();
		// When/Then: an unrestricted (admin) scope may edit any entry, authored by someone else.
		assertThat(mapper.toJournalV1(List.of(entry), "pu-2", true).get(0).getCanEdit()).isTrue();
		// When/Then: a caller not yet synced into Pacing (null own id) on a restricted scope may not.
		assertThat(mapper.toJournalV1(List.of(entry), null, false).get(0).getCanEdit()).isFalse();
	}

	@Test
	void shouldCarryOnlyTheDataSettingsTheRequestSetTest() {
		// Given: a request that moves the BigQuery source and touches nothing else. Pacing writes the
		// keys it receives, so an absent field has to stay absent all the way down - defaulting it here
		// would turn "the caller did not touch this" into "set it to the default", which on the source
		// means moving a corrected pacing back onto the raw feed.
		PacingDataSettingsUpdateV1 body = new PacingDataSettingsUpdateV1()
				// fromValue, not the generated constant: the generator strips the shared `platform_` prefix,
				// so its constant is named MART_ADJUSTMENTS_VIEW - a name that says less than the wire value
				// this test is actually about, and one a regenerated spec could rename underneath it.
				.source(PacingDataSourceV1.fromValue("platform_mart_adjustments_view"));

		// When:
		PacingDataSettings result = mapper.toDataSettings(body);

		// Then:
		assertThat(result.source()).isEqualTo("platform_mart_adjustments_view");
		assertThat(result.fetchCreatives()).isNull();
		assertThat(result.fetchConversions()).isNull();
		assertThat(result.dimSources()).isNull();
		assertThat(result.deliveryTab()).isNull();
	}

	@Test
	void shouldCarryTheDeliveryTabSwitchTest() {
		// Given: switching the Delivery tab off is a value to write, not an absent one.
		PacingDataSettingsUpdateV1 body = new PacingDataSettingsUpdateV1().deliveryTab(false);

		// When:
		PacingDataSettings result = mapper.toDataSettings(body);

		// Then:
		assertThat(result.deliveryTab()).isFalse();
		assertThat(result.source()).isNull();
	}

	@Test
	void shouldKeepAFalseFetchToggleDistinctFromAnAbsentOneTest() {
		// Given: turning a toggle off is a value to write; leaving it alone is not. Collapsing the two
		// would make every toggle one-way.
		PacingDataSettingsUpdateV1 body = new PacingDataSettingsUpdateV1()
				.fetchCreatives(false)
				.dimSources(new PacingDimSourcesV1().entries(List.of(Map.of("id", "devices", "loader", "bq_mart"))));

		// When:
		PacingDataSettings result = mapper.toDataSettings(body);

		// Then:
		assertThat(result.source()).isNull();
		assertThat(result.fetchCreatives()).isFalse();
		assertThat(result.fetchConversions()).isNull();
		assertThat(result.dimSources()).containsExactly(Map.of("id", "devices", "loader", "bq_mart"));
	}

	@Test
	void shouldKeepAnEmptyDimensionSourceListDistinctFromAnAbsentOneTest() {
		// Given: the wrapper is present and its list is empty - "clear every dimension source", which is
		// what unticking the last one means. Collapsing it back to null would make that unticking a
		// silent no-op; the wrapper exists precisely so this case survives the generated DTO.
		PacingDataSettingsUpdateV1 body =
				new PacingDataSettingsUpdateV1().dimSources(new PacingDimSourcesV1().entries(List.of()));

		// When:
		PacingDataSettings result = mapper.toDataSettings(body);

		// Then:
		assertThat(result.dimSources()).isNotNull().isEmpty();
	}

	@Test
	void shouldMapFullNotifySettingsFromV1Test() {
		// Given: §14 - the reverse direction, as the notify-settings save endpoint reads it.
		PacingNotifySettingsV1 body = new PacingNotifySettingsV1()
				.alerts(new PacingAlertsConfigV1()
						.enabled(true)
						.bidFactAbovePlan(new PacingAlertRuleWindowThresholdV1().enabled(true).slack(true).window(2).thresholdPct(5.0))
						.dataGap(new PacingAlertRuleGapDaysV1().enabled(true).slack(true).gapDays(1))
						.ctrBelowTarget(new PacingAlertRuleFactorV1().enabled(true).slack(true).factor(0.7))
						.vcrBelowTarget(new PacingAlertRuleFactorV1().enabled(true).slack(true).factor(0.7))
						.ctrAboveTarget(new PacingAlertRuleFactorV1().enabled(true).slack(true).factor(2.0))
						.vcrOver100(new PacingAlertRuleBaseV1().enabled(true).slack(true))
						.noImpressionsYet(new PacingAlertRuleBaseV1().enabled(true).slack(true))
						.pacingOffPace(new PacingAlertRuleBandV1().enabled(true).slack(true).low(-5.0).high(5.0))
						.marginBelowTarget(new PacingAlertRuleGapPpV1().enabled(true).slack(true).gapPp(3.0))
						.spendOverspend(new PacingAlertRuleSpendV1().enabled(true).slack(true).warnPct(90.0).badPct(100.0))
						.dspForecastOverspend(new PacingAlertRuleBaseV1().enabled(true).slack(true))
						.staleData(new PacingAlertRuleDaysV1().enabled(true).slack(true).days(2))
						.rateCostAbovePlan(new PacingAlertRuleThresholdPctV1().enabled(true).slack(true).thresholdPct(10.0)))
				.metrics(new PacingNotifyMetricsV1().vcr(false))
				.hidePaused(false)
				.summaryProjection(PacingSummaryProjectionV1.REFORECAST);

		// When:
		PacingNotifySettings result = mapper.toNotifySettings(body);

		// Then:
		assertThat(result.alerts().enabled()).isTrue();
		assertThat(result.alerts().bidFactAbovePlan().window()).isEqualTo(2);
		assertThat(result.alerts().bidFactAbovePlan().thresholdPct()).isEqualTo(5.0);
		assertThat(result.alerts().dataGap().gapDays()).isEqualTo(1);
		assertThat(result.alerts().ctrBelowTarget().factor()).isEqualTo(0.7);
		assertThat(result.alerts().vcrBelowTarget().factor()).isEqualTo(0.7);
		assertThat(result.alerts().ctrAboveTarget().factor()).isEqualTo(2.0);
		assertThat(result.alerts().vcrOver100().enabled()).isTrue();
		assertThat(result.alerts().noImpressionsYet().slack()).isTrue();
		assertThat(result.alerts().pacingOffPace().low()).isEqualTo(-5.0);
		assertThat(result.alerts().pacingOffPace().high()).isEqualTo(5.0);
		assertThat(result.alerts().marginBelowTarget().gapPp()).isEqualTo(3.0);
		assertThat(result.alerts().spendOverspend().warnPct()).isEqualTo(90.0);
		assertThat(result.alerts().spendOverspend().badPct()).isEqualTo(100.0);
		assertThat(result.alerts().dspForecastOverspend().enabled()).isTrue();
		assertThat(result.alerts().staleData().days()).isEqualTo(2);
		assertThat(result.alerts().rateCostAbovePlan().thresholdPct()).isEqualTo(10.0);
		assertThat(result.metrics().vcr()).isFalse();
		assertThat(result.hidePaused()).isFalse();
		assertThat(result.summaryProjection()).isEqualTo("reforecast");
	}

	@Test
	void shouldMapRefreshStatusTest() {
		// Given:
		PacingRefreshStatus status = new PacingRefreshStatus(true, "r1", 42, "2026-08-31");

		// When:
		PacingRefreshStatusV1 result = mapper.toV1(status);

		// Then:
		assertThat(result.getExists()).isTrue();
		assertThat(result.getRefreshId()).isEqualTo("r1");
		assertThat(result.getRowCount()).isEqualTo(42);
		assertThat(result.getLatestDate()).isEqualTo(LocalDate.of(2026, 8, 31));
	}

	@Test
	void shouldMapLibraryEntryAndListTest() {
		// Given:
		PacingLibraryEntry entry = new PacingLibraryEntry(
				"e1", "widget", "Budget card", "Shows client budget", Map.of("id", "w_1"),
				"Azat Nabiev", "2026-08-01", "2026-08-02", 3, true, true, "private", 5);

		// When:
		PacingLibraryEntryV1 v1 = mapper.toV1(entry);
		PacingLibraryListResponseV1 listV1 = mapper.toListV1(List.of(entry));

		// Then:
		assertThat(v1.getId()).isEqualTo("e1");
		assertThat(v1.getKind()).isEqualTo(PacingLibraryKindV1.WIDGET);
		assertThat(v1.getOwnerName()).isEqualTo("Azat Nabiev");
		assertThat(v1.getUsage()).isEqualTo(5);
		assertThat(v1.getVisibility()).isEqualTo(PacingLibraryVisibilityV1.PRIVATE);
		assertThat(listV1.getEntries()).hasSize(1);
		assertThat(listV1.getEntries().get(0).getId()).isEqualTo("e1");
	}

	@Test
	void shouldReadCampaignLinksUpdateInOrderTest() {
		// Given: a whole-array save (§16) - order is display order, so it must survive the mapping
		PacingCampaignLinksUpdateV1 body = new PacingCampaignLinksUpdateV1().links(List.of(
				new PacingCampaignLinkV1().name("DV360").url("https://displayvideo.google.com/#ng_nav/p/1"),
				new PacingCampaignLinkV1().name("Asana").url("https://app.asana.com/0/123/456")));

		// When:
		List<PacingCampaignLink> result = mapper.toCampaignLinks(body);

		// Then:
		assertThat(result).containsExactly(
				new PacingCampaignLink("DV360", "https://displayvideo.google.com/#ng_nav/p/1"),
				new PacingCampaignLink("Asana", "https://app.asana.com/0/123/456"));
	}

	@Test
	void everyThirdPartyStateIsCarried() {
		for (String state : List.of("none", "pending", "ready", "error")) {
			PacingThirdPartyStatusV1 result =
					mapper.toV1(new PacingThirdPartyStatus(true, state, null, null, null));
			assertThat(result.getState().getValue()).isEqualTo(state);
		}
	}

	@Test
	void anUnreadableThirdPartyStateReadsAsNoneRatherThanReachingTheUi() {
		// The enum is what a widget switches on. A value outside it would arrive as an unhandled
		// branch, and "we cannot say" is `none` - never a state that makes the widget poll forever.
		assertThat(mapper.stateOrNone(null)).isEqualTo(PacingThirdPartyStatusV1.StateEnum.NONE);
		assertThat(mapper.stateOrNone("")).isEqualTo(PacingThirdPartyStatusV1.StateEnum.NONE);
		assertThat(mapper.stateOrNone("READY")).isEqualTo(PacingThirdPartyStatusV1.StateEnum.NONE);
		assertThat(mapper.stateOrNone("something-new")).isEqualTo(PacingThirdPartyStatusV1.StateEnum.NONE);
	}

	@Test
	void theThirdPartyFileIsReportedAsPacingWroteIt() {
		PacingThirdPartyStatusV1 result = mapper.toV1(new PacingThirdPartyStatus(
				true, "ready", "2026-10-09T12:00:00.000Z", 1200, List.of("Spring Sale", "Autumn")));

		assertThat(result.getFetchedAt()).isEqualTo("2026-10-09T12:00:00.000Z");
		assertThat(result.getRowCount()).isEqualTo(1200);
		assertThat(result.getCampaigns()).containsExactly("Spring Sale", "Autumn");
	}

	@Test
	void theCampaignPickerKeepsEverySpellingUntouched() {
		// A saved source stores the campaign name verbatim, so trimming or case-folding it here would
		// store a name the export does not have and the next fetch would match nothing.
		PacingThirdPartyCampaigns src = new PacingThirdPartyCampaigns(true, List.of(
				new PacingThirdPartyCampaign("  Spring Sale  ", "Weekly", "2026-07-01", 13_695_782L),
				new PacingThirdPartyCampaign("autumn PUSH", null, null, null)), true);

		PacingThirdPartyCampaignsV1 result = mapper.toV1(src);

		assertThat(result.getStale()).isTrue();
		assertThat(result.getCampaigns()).hasSize(2);
		assertThat(result.getCampaigns().get(0).getName()).isEqualTo("  Spring Sale  ");
		assertThat(result.getCampaigns().get(0).getReport()).isEqualTo("Weekly");
		assertThat(result.getCampaigns().get(0).getLastSeen()).isEqualTo("2026-07-01");
		assertThat(result.getCampaigns().get(0).getImp()).isEqualTo(13_695_782L);
		// A campaign the export knows only by name still belongs in the picker.
		assertThat(result.getCampaigns().get(1).getName()).isEqualTo("autumn PUSH");
		assertThat(result.getCampaigns().get(1).getReport()).isNull();
	}

	@Test
	void anAbsentCampaignListIsAnEmptyPickerRatherThanANull() {
		PacingThirdPartyCampaignsV1 result =
				mapper.toV1(new PacingThirdPartyCampaigns(true, null, false));

		assertThat(result.getCampaigns()).isEmpty();
		assertThat(result.getStale()).isFalse();
	}

	@Test
	void theCm360FileRidesThroughFieldForField() {
		PacingThirdPartyData file = new PacingThirdPartyData(
				"2026-10-09T12:00:00.000Z", List.of("Spring Sale"),
				List.of(Map.of("report", "Weekly", "campaigns", List.of("Spring Sale"))),
				"ready", 4, 13884, List.of(Map.of("campaign", "Spring Sale", "impressions", 10)));

		PacingThirdPartyDataV1 result = mapper.toV1(file);

		assertThat(result.getFetchedAt()).isEqualTo("2026-10-09T12:00:00.000Z");
		assertThat(result.getCampaigns()).containsExactly("Spring Sale");
		assertThat(result.getGroups()).hasSize(1);
		assertThat(result.getStatus()).isEqualTo("ready");
		assertThat(result.getDroppedDupes()).isEqualTo(4);
		assertThat(result.getRowCount()).isEqualTo(13884);
		// Rows stay opaque: they are ad-server columns that differ per report.
		assertThat(result.getRows()).singleElement()
				.satisfies(row -> assertThat(row).containsEntry("campaign", "Spring Sale"));
	}

	@Test
	void shouldReadAProposalWithNoDimensionsAsAnEmptyListTest() {
		// The contract makes `dimensions` required, and "nothing proposed" is a real answer - a caller
		// must be able to read it without a null check. The notice is what explains it.
		// Given:
		PacingMappingSuggestions suggestions =
				new PacingMappingSuggestions(true, null, "we need to add ai connection");

		// When:
		PacingMappingSuggestionsV1 result = mapper.toV1(suggestions);

		// Then:
		assertThat(result.getDimensions()).isEmpty();
		assertThat(result.getNotice()).isEqualTo("we need to add ai connection");
	}

	@Test
	void shouldCarryAProposedDimensionWithItsValuesAndAliasesTest() {
		// Given:
		PacingMappingSuggestions suggestions = new PacingMappingSuggestions(true, List.of(
				new PacingMappingSuggestedDimension("Format", List.of(
						new PacingMappingSuggestedValue("CTV", List.of("connected tv")),
						// A value with no aliases is normal, and must not come out null.
						new PacingMappingSuggestedValue("Display", null)))), null);

		// When:
		PacingMappingSuggestionsV1 result = mapper.toV1(suggestions);

		// Then:
		assertThat(result.getNotice()).isNull();
		assertThat(result.getDimensions()).singleElement().satisfies(d -> {
			assertThat(d.getName()).isEqualTo("Format");
			assertThat(d.getValues()).hasSize(2);
			assertThat(d.getValues().get(0).getValue()).isEqualTo("CTV");
			assertThat(d.getValues().get(0).getAliases()).containsExactly("connected tv");
			assertThat(d.getValues().get(1).getAliases()).isEmpty();
		});
	}

	@Test
	void shouldReadAProposedDimensionWithNoValuesAsAnEmptyListTest() {
		// Given:
		PacingMappingSuggestions suggestions = new PacingMappingSuggestions(
				true, List.of(new PacingMappingSuggestedDimension("Format", null)), null);

		// When:
		PacingMappingSuggestionsV1 result = mapper.toV1(suggestions);

		// Then:
		assertThat(result.getDimensions()).singleElement()
				.satisfies(d -> assertThat(d.getValues()).isEmpty());
	}

	@Test
	void shouldKeepSampleCellTypesSoADateColumnStillReadsAsOneTest() {
		// Given: a tab whose Date column holds a spreadsheet SERIAL number, which is how Google hands
		// a real date back - 46170 is 2026-05-28.
		PacingSheetTab tab = new PacingSheetTab(0, "GAF pacing 2026", 5003, 14, 0,
				List.of("Date", "Impressions"),
				List.of(List.of(46170, 5477)),
				List.of(List.of("46170", "5477")));

		// When:
		var result = mapper.toV1(tab);

		// Then: the sample keeps the number. Flattened to "46170" the settings screen reads the
		// column as text that merely looks numeric, refuses it the Date role, and blocks the save.
		assertThat(result.getSample()).singleElement()
				.satisfies(row -> assertThat(row.get(0)).isEqualTo(46170));
		// The grid is the display twin and stays text - it is what the header-row picker shows.
		assertThat(result.getGrid()).singleElement()
				.satisfies(row -> assertThat(row.get(0)).isEqualTo("46170"));
	}

	@Test
	void shouldReadAnAbsentJournalAsAnEmptyListTest() {
		// Given/When/Then: a pacing with no journal yet answers with an empty list, never a null the
		// write responses would have to guard against.
		assertThat(mapper.toJournalV1(null, "pu-1", true)).isEmpty();
	}

	@Test
	void shouldLeaveTheLatestDateEmptyWhenPacingHasNoneOrAMalformedOneTest() {
		// Given/When/Then: no date, a blank date and a date that is not ISO all read as "no date";
		// a missing row count reads as zero.
		assertThat(mapper.toV1(new PacingRefreshStatus(false, null, null, null)).getLatestDate()).isNull();
		assertThat(mapper.toV1(new PacingRefreshStatus(false, null, null, "  ")).getLatestDate()).isNull();
		assertThat(mapper.toV1(new PacingRefreshStatus(true, "r1", 1, "yesterday")).getLatestDate()).isNull();
		assertThat(mapper.toV1(new PacingRefreshStatus(false, null, null, null)).getRowCount()).isZero();
	}

	@Test
	void shouldMapASheetProbeWithItsTabsTest() {
		// Given: a readable spreadsheet with one tab.
		PacingSheetTab tab = new PacingSheetTab(7, "Plan", 120, 6, 1,
				List.of("Date", "Impressions"), List.of(List.of("2026-05-28", 10)), List.of(List.of("2026-05-28", "10")));
		PacingSheetProbe probe = new PacingSheetProbe(true, "sheet-1", "GAF pacing", "svc@example.iam", null, List.of(tab));

		// When:
		PacingSheetProbeV1 result = mapper.toV1(probe);

		// Then: `ok` arrives as `readable`, the rest field for field.
		assertThat(result.getReadable()).isTrue();
		assertThat(result.getSpreadsheetId()).isEqualTo("sheet-1");
		assertThat(result.getTitle()).isEqualTo("GAF pacing");
		assertThat(result.getShareWith()).isEqualTo("svc@example.iam");
		assertThat(result.getError()).isNull();
		assertThat(result.getTabs()).singleElement()
				.satisfies(t -> assertThat(t.getTitle()).isEqualTo("Plan"));
	}

	@Test
	void shouldReadAnUnreadableSheetProbeWithoutIdOrTabsAsEmptyRatherThanNullTest() {
		// Given: Pacing could not open the sheet, so it knows neither its id nor its tabs.
		PacingSheetProbe probe = new PacingSheetProbe(false, null, null, null, "not_shared", null);

		// When:
		PacingSheetProbeV1 result = mapper.toV1(probe);

		// Then:
		assertThat(result.getReadable()).isFalse();
		assertThat(result.getSpreadsheetId()).isEmpty();
		assertThat(result.getTabs()).isEmpty();
		assertThat(result.getError()).isEqualTo("not_shared");
	}

	@Test
	void shouldMapDimSourceValuesWithTheirRowCountsTest() {
		// Given:
		PacingDimSourceValues values = new PacingDimSourceValues(
				List.of("Placement"),
				List.of(new PacingDimSourceValue(List.of("Display_300x250"), 12), new PacingDimSourceValue(null, 0)),
				true, 5000);

		// When:
		PacingDimSourceValuesV1 result = mapper.toV1(values);

		// Then:
		assertThat(result.getColumns()).containsExactly("Placement");
		assertThat(result.getTruncated()).isTrue();
		assertThat(result.getScannedRows()).isEqualTo(5000);
		assertThat(result.getValues()).hasSize(2);
		assertThat(result.getValues().get(0).getValues()).containsExactly("Display_300x250");
		assertThat(result.getValues().get(0).getRows()).isEqualTo(12);
		// A value Pacing listed without cells is an empty tuple, not a null.
		assertThat(result.getValues().get(1).getValues()).isEmpty();
	}

	@Test
	void shouldReadAbsentDimSourceColumnsAndValuesAsEmptyListsTest() {
		PacingDimSourceValuesV1 result = mapper.toV1(new PacingDimSourceValues(null, null, false, 0));

		assertThat(result.getColumns()).isEmpty();
		assertThat(result.getValues()).isEmpty();
		assertThat(result.getTruncated()).isFalse();
	}

	@Test
	void shouldMapDimSourceSuggestionsWithBindingsAndGroupsTest() {
		// Given: a proposal that routes one sheet value to a line item and groups two others.
		PacingDimSourceSuggestions suggestions = new PacingDimSourceSuggestions(
				true, null,
				List.of(new PacingDimSourceBinding("Display_300x250", "li-1")),
				List.of("Video_A", "Video_B"),
				List.of(new PacingDimSourceGroup("Video", List.of("Video_A", "Video_B")), new PacingDimSourceGroup("Other", null)),
				3);

		// When:
		PacingDimSourceSuggestionsV1 result = mapper.toV1(suggestions);

		// Then:
		assertThat(result.getAvailable()).isTrue();
		assertThat(result.getNotice()).isNull();
		assertThat(result.getConsidered()).isEqualTo(3);
		assertThat(result.getBindings()).singleElement().satisfies(b -> {
			assertThat(b.getValue()).isEqualTo("Display_300x250");
			assertThat(b.getLineItemId()).isEqualTo("li-1");
		});
		assertThat(result.getMembers()).containsExactly("Video_A", "Video_B");
		assertThat(result.getGroups()).hasSize(2);
		assertThat(result.getGroups().get(0).getLabel()).isEqualTo("Video");
		assertThat(result.getGroups().get(0).getMembers()).containsExactly("Video_A", "Video_B");
		// A group Pacing proposed without members is an empty group, not a null.
		assertThat(result.getGroups().get(1).getMembers()).isEmpty();
	}

	@Test
	void shouldCarryAnUnavailableProposalWithItsNoticeAndEmptyListsTest() {
		// Given: Pacing has no model configured; the lists may be absent altogether.
		PacingDimSourceSuggestions suggestions =
				new PacingDimSourceSuggestions(false, "we need to add ai connection", null, null, null, 0);

		// When:
		PacingDimSourceSuggestionsV1 result = mapper.toV1(suggestions);

		// Then: the UI gets the notice and empty lists, never nulls to guard.
		assertThat(result.getAvailable()).isFalse();
		assertThat(result.getNotice()).isEqualTo("we need to add ai connection");
		assertThat(result.getBindings()).isEmpty();
		assertThat(result.getMembers()).isEmpty();
		assertThat(result.getGroups()).isEmpty();
	}

	@Test
	void shouldMapADimSourceReadFieldForFieldTest() {
		// Given:
		PacingDimSourceRead read = new PacingDimSourceRead("src-1", 5003, 12, 3, 184_320L, "covers 2026-05-01..2026-05-28");

		// When:
		PacingDimSourceReadV1 result = mapper.toV1(read);

		// Then:
		assertThat(result.getSourceId()).isEqualTo("src-1");
		assertThat(result.getRows()).isEqualTo(5003);
		assertThat(result.getUnboundRows()).isEqualTo(12);
		assertThat(result.getUnparsedCells()).isEqualTo(3);
		assertThat(result.getBytes()).isEqualTo(184_320L);
		assertThat(result.getCoverageHint()).isEqualTo("covers 2026-05-01..2026-05-28");
	}
}
