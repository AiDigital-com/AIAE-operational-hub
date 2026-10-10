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
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDashboardV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDataSettingsUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDataSourceV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDimSourcesV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryEntryV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryKindV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryListResponseV1;
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
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignLink;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDashboardCampaign;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDashboardData;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDataSettings;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingJournalEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibraryEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLineItemPlan;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNotifyMetrics;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNotifySettings;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingPauseInterval;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshStatus;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingThirdPartyCampaignsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingThirdPartyDataV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyCampaign;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyCampaigns;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyData;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyStatus;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingThirdPartyStatusV1;
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
	void shouldMapFullDashboardPayloadTest() {
		// Given:
		PacingDashboardCampaign campaign = new PacingDashboardCampaign(
				"nike-ss26", "p1", "Nike SS26", "2026-08-01", "2026-09-30", "USD", 1.0, "Live", "SO-1",
				"https://docs.google.com/spreadsheets/d/abc",
				List.of(new PacingCampaignLink("Asana", "https://app.asana.com/0/123/456")), true);
		PacingLineItemPlan plan = new PacingLineItemPlan(
				"111", "Display", "DV360", List.of("VIP", "renewal"), "Nike SS26 - Display", "CPM", 5000.0,
				1_000_000.0, 20.0, null, null,
				"2026-08-01", "2026-09-30",
				List.of(new PacingPauseInterval("2026-08-10", "2026-08-12")),
				List.of(Map.of("target_impressions", 200_000)),
				// Value groups: two delivered Audience values read as one named value on this line.
				List.of(Map.of("dim_key", "audience", "name", "Brand", "values", List.of("PMax_Brand", "Search_Brand"))),
				// Net cost mode: operative ratio, stored ratio, lock, NetSuite baseline.
				null, false, false, null, 0.85, 0.85, true, 0.8,
				// Primary conversions: the operative choice, the stored one, and whether this line's
				// own source brings conversion rows at all.
				List.of("Purchase"), List.of("Purchase"), true);
		PacingJournalEntry journal =
				new PacingJournalEntry("j1", "2026-08-05", "Kicked off", "azat@aidigital.com", "pu-1", null);
		PacingDashboardData data = new PacingDashboardData(
				campaign, Map.of("111", plan), List.of(Map.of("date", "2026-08-01", "impressions", 500)),
				"2026-08-05",
				// types / availableSplits / availableMetrics / conversionTags - the four the moved
				// widget renderer reads; unset here because these cases are about the other fields.
				null, null, null, null, List.of(Map.of("creative_name", "Hero 15s")), null,
				Map.of("devices", Map.of("rows", List.of())), null, null,
				Map.of("widgets", List.of()), Map.of("groupBy", "day"), Map.of("contextWidgetSpec", 2),
				Map.of("campaign", Map.of("mA", 42.5)), null,
				Map.of("source", "platform_mart_adjustments_view", "fetch_creatives", true), null,
				List.of(journal));

		// When: the caller authored this journal entry themselves ("pu-1"), on a restricted scope.
		PacingDashboardV1 result = mapper.toV1(data, "pu-1", false);

		// Then: the "id" field Pacing calls the campaign is renamed to "slug" on this contract
		assertThat(result.getCampaign().getSlug()).isEqualTo("nike-ss26");
		// The metric bag rides through untouched: it is Pacing's arithmetic, and the
		// Hub neither reshapes nor recomputes any of it - margin especially, which is
		// applied server-side and nowhere else.
		assertThat(result.getMetrics()).isEqualTo(Map.of("campaign", Map.of("mA", 42.5)));
		assertThat(result.getCampaign().getPacingId()).isEqualTo("p1");
		// §16: the source URL and the reference links ride through verbatim - Pacing already dropped
		// any link duplicating the source URL, so the mapper repeats no de-duplication.
		assertThat(result.getCampaign().getSourceUrl()).isEqualTo("https://docs.google.com/spreadsheets/d/abc");
		assertThat(result.getCampaign().getLinks()).hasSize(1);
		assertThat(result.getCampaign().getLinks().get(0).getName()).isEqualTo("Asana");
		assertThat(result.getCampaign().getLinks().get(0).getUrl()).isEqualTo("https://app.asana.com/0/123/456");
		assertThat(result.getCampaign().getStartDate()).isEqualTo(LocalDate.of(2026, 8, 1));
		assertThat(result.getPlanByLineItem()).containsKey("111");
		assertThat(result.getPlanByLineItem().get("111").getPlannedImpressions()).isEqualTo(1_000_000.0);
		// Primary conversions (spec 2026-09-13). Asserted rather than merely compiled: the operative
		// list is a MATH input the browser-side engine reads, and a mapper that quietly stopped
		// forwarding it would leave every line counting every conversion action the platform
		// reported - a wrong number with nothing failing anywhere. The same class of silent loss this
		// contract already suffered on `cost_coef` and the net family.
		assertThat(result.getPlanByLineItem().get("111").getPrimaryConversions()).containsExactly("Purchase");
		assertThat(result.getPlanByLineItem().get("111").getStoredPrimaryConversions()).containsExactly("Purchase");
		assertThat(result.getPlanByLineItem().get("111").getConversionData()).isTrue();
		assertThat(result.getPlanByLineItem().get("111").getPauseIntervals()).hasSize(1);
		assertThat(result.getPlanByLineItem().get("111").getPauseIntervals().get(0).getFrom())
				.isEqualTo(LocalDate.of(2026, 8, 10));
		assertThat(result.getPlanByLineItem().get("111").getLabels()).containsExactly("VIP", "renewal");
		assertThat(result.getPlanByLineItem().get("111").getDescription()).isEqualTo("Nike SS26 - Display");
		// Net cost mode (Pacing spec 2026-09-07): the four net fields pass through verbatim - the
		// browser-side engine multiplies each cost row by netRatio, so dropping it here would
		// silently read a net pacing as gross. netMode is the campaign-wide switch echo.
		assertThat(result.getCampaign().getNetMode()).isTrue();
		assertThat(result.getPlanByLineItem().get("111").getNetRatio()).isEqualTo(0.85);
		assertThat(result.getPlanByLineItem().get("111").getStoredNetRatio()).isEqualTo(0.85);
		assertThat(result.getPlanByLineItem().get("111").getNetRatioLocked()).isTrue();
		assertThat(result.getPlanByLineItem().get("111").getNsNetRatio()).isEqualTo(0.8);
		assertThat(result.getFactsDaily()).hasSize(1);
		assertThat(result.getAsOf()).isEqualTo("2026-08-05");
		// The two Breakdown aux feeds ride through byte-for-byte, and an ABSENT one stays absent:
		// null is what tells the panel this pacing does not collect the file, so it must not offer
		// that cut. Flattening it to an empty list would earn an empty tab instead.
		assertThat(result.getCreatives()).containsExactly(Map.of("creative_name", "Hero 15s"));
		assertThat(result.getConversions()).isNull();
		assertThat(result.getDimSources()).containsKey("devices");
		assertThat(result.getDisplay()).containsKey("widgets");
		assertThat(result.getAggregate()).containsEntry("groupBy", "day");
		assertThat(result.getLibraryEntries()).isNull();
		// The data namespace rides through whole: the Data panel edits four of its keys and must be
		// able to carry the rest back unchanged.
		assertThat(result.getData())
				.isEqualTo(Map.of("source", "platform_mart_adjustments_view", "fetch_creatives", true));
		assertThat(result.getJournal()).hasSize(1);
		assertThat(result.getJournal().get(0).getMsg()).isEqualTo("Kicked off");
		assertThat(result.getJournal().get(0).getCanEdit()).isTrue();
	}

	@Test
	void shouldDefaultLineItemPlanLabelsToEmptyListWhenPacingOmitsThemTest() {
		// Given: a line item with no labels/description at all, exactly like every other optional
		// field on this record - a missing labels array must not become a null on the contract
		// (matching the existing `containers` default two lines above it in the mapper).
		PacingDashboardCampaign campaign = new PacingDashboardCampaign(
				"nike-ss26", "p1", "Nike SS26", "2026-08-01", "2026-09-30", "USD", 1.0, "Live", "SO-1",
				"", List.of(), null);
		PacingLineItemPlan plan = new PacingLineItemPlan(
				"111", "Display", "DV360", null, null, "CPM", 5000.0, 1_000_000.0, 20.0, null, null,
				"2026-08-01", "2026-09-30", List.of(), List.of(), null, null, false, false, null, null, null, null, null,
				// Primary conversions unset: this case is about the fields above.
				null, null, null);
		PacingDashboardData data = new PacingDashboardData(
				campaign, Map.of("111", plan), List.of(), "2026-08-05",
				// types / availableSplits / availableMetrics / conversionTags - the four the moved
				// widget renderer reads; unset here because these cases are about the other fields.
				null, null, null, null, null, null, null, null, null, Map.of(), Map.of(),
				Map.of(), Map.of(), null, Map.of(), null, List.of());

		// When:
		PacingDashboardV1 result = mapper.toV1(data, "pu-1", false);

		// Then:
		assertThat(result.getPlanByLineItem().get("111").getLabels()).isEmpty();
		assertThat(result.getPlanByLineItem().get("111").getDescription()).isNull();
	}

	@Test
	void shouldAllowEditOnlyForTheEntrysOwnAuthorOrAnUnrestrictedScopeTest() {
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
	void shouldMapFullNotifySettingsToV1Test() {
		// Given: §14 - all 13 alert keys, exercising every one of the per-shape mapping helpers.
		PacingNotifySettings settings = new PacingNotifySettings(
				new PacingAlertsConfig(
						true,
						new PacingAlertRuleWindowThreshold(true, true, 2, 5),
						new PacingAlertRuleGapDays(true, true, 1),
						new PacingAlertRuleFactor(true, true, 0.7),
						new PacingAlertRuleFactor(true, true, 0.7),
						new PacingAlertRuleFactor(true, true, 2.0),
						new PacingAlertRuleBase(true, true),
						new PacingAlertRuleBase(true, true),
						new PacingAlertRuleBand(true, true, -5, 5),
						new PacingAlertRuleGapPp(true, true, 3),
						new PacingAlertRuleSpend(true, true, 90, 100),
						new PacingAlertRuleBase(true, true),
						new PacingAlertRuleDays(true, true, 2),
						new PacingAlertRuleThresholdPct(true, true, 10)),
				new PacingNotifyMetrics(true),
				true,
				"plan");

		// When:
		PacingNotifySettingsV1 result = mapper.toV1(settings);

		// Then:
		assertThat(result.getAlerts().getEnabled()).isTrue();
		assertThat(result.getAlerts().getBidFactAbovePlan().getWindow()).isEqualTo(2);
		assertThat(result.getAlerts().getBidFactAbovePlan().getThresholdPct()).isEqualTo(5);
		assertThat(result.getAlerts().getDataGap().getGapDays()).isEqualTo(1);
		assertThat(result.getAlerts().getCtrBelowTarget().getFactor()).isEqualTo(0.7);
		assertThat(result.getAlerts().getVcrBelowTarget().getFactor()).isEqualTo(0.7);
		assertThat(result.getAlerts().getCtrAboveTarget().getFactor()).isEqualTo(2.0);
		assertThat(result.getAlerts().getVcrOver100().getEnabled()).isTrue();
		assertThat(result.getAlerts().getNoImpressionsYet().getSlack()).isTrue();
		assertThat(result.getAlerts().getPacingOffPace().getLow()).isEqualTo(-5);
		assertThat(result.getAlerts().getPacingOffPace().getHigh()).isEqualTo(5);
		assertThat(result.getAlerts().getMarginBelowTarget().getGapPp()).isEqualTo(3);
		assertThat(result.getAlerts().getSpendOverspend().getWarnPct()).isEqualTo(90);
		assertThat(result.getAlerts().getSpendOverspend().getBadPct()).isEqualTo(100);
		assertThat(result.getAlerts().getDspForecastOverspend().getEnabled()).isTrue();
		assertThat(result.getAlerts().getStaleData().getDays()).isEqualTo(2);
		assertThat(result.getAlerts().getRateCostAbovePlan().getThresholdPct()).isEqualTo(10);
		assertThat(result.getMetrics().getVcr()).isTrue();
		assertThat(result.getHidePaused()).isTrue();
		assertThat(result.getSummaryProjection()).isEqualTo(PacingSummaryProjectionV1.PLAN);
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
	void shouldDegradeMalformedFlightDatesToNullRatherThanFailTest() {
		// Given: a defensive rule shared with PacingContractMapper's own date parsing
		PacingDashboardCampaign campaign =
				new PacingDashboardCampaign(
						"slug", "p1", "Name", "not-a-date", "", "USD", 1.0, "Live", null, null, null, null);
		PacingDashboardData data = new PacingDashboardData(
				campaign, Map.of(), List.of(), null,
				// types / availableSplits / availableMetrics / conversionTags - the four the moved
				// widget renderer reads; unset here because these cases are about the other fields.
				null, null, null, null, null, null, null, null, null, Map.of(), Map.of(), null, null, null, null,
				null, List.of());

		// When:
		PacingDashboardV1 result = mapper.toV1(data, null, false);

		// Then:
		// Null stays null rather than flattening to an empty map, unlike display and
		// aggregate: those are configuration, where "nothing chosen" and "{}" mean the
		// same thing, while this is measurement. An empty bag would let a widget draw
		// confident zeroes for figures Pacing could not derive at all.
		assertThat(result.getMetrics()).isNull();
		assertThat(result.getCampaign().getStartDate()).isNull();
		assertThat(result.getCampaign().getEndDate()).isNull();
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
				"Azat Nabiev", "2026-08-01", "2026-08-02", 3, true, true, 5);

		// When:
		PacingLibraryEntryV1 v1 = mapper.toV1(entry);
		PacingLibraryListResponseV1 listV1 = mapper.toListV1(List.of(entry));

		// Then:
		assertThat(v1.getId()).isEqualTo("e1");
		assertThat(v1.getKind()).isEqualTo(PacingLibraryKindV1.WIDGET);
		assertThat(v1.getOwnerName()).isEqualTo("Azat Nabiev");
		assertThat(v1.getUsage()).isEqualTo(5);
		assertThat(listV1.getEntries()).hasSize(1);
		assertThat(listV1.getEntries().get(0).getId()).isEqualTo("e1");
	}

	@Test
	void shouldFlattenNullCampaignLinksToEmptyListTest() {
		// Given: a pacing whose campaign_links was never written. "Never written" and "none kept"
		// are the same answer to a reader, so null flattens - unlike the payload's measurement
		// fields, whose absence carries meaning.
		PacingDashboardCampaign campaign = new PacingDashboardCampaign(
				"slug", "p1", "Name", "2026-08-01", "2026-09-30", "USD", 1.0, "Live", null, "", null, null);
		PacingDashboardData data = new PacingDashboardData(
				campaign, Map.of(), List.of(), null,
				// types / availableSplits / availableMetrics / conversionTags - the four the moved
				// widget renderer reads; unset here because these cases are about the other fields.
				null, null, null, null, null, null, null, null, null, Map.of(), Map.of(), null, null, null, null,
				null, List.of());

		// When:
		PacingDashboardV1 result = mapper.toV1(data, null, false);

		// Then:
		assertThat(result.getCampaign().getLinks()).isEmpty();
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
	void thirdPartyBecomesAnEmptyListWhileMappingsV3KeepsItsNull() {
		// The asymmetry is deliberate. A CM360 widget reads `thirdParty` to decide whether to ask for
		// rows at all, so a length check must always be safe. `mappingsV3` answers a different
		// question: null means the pacing predates the v3 mapping model, an empty list means it was
		// migrated and nothing is mapped yet, and the compare screens show a different thing for each.
		PacingDashboardData data = dashboardDataWith(null, null);

		PacingDashboardV1 result = mapper.toV1(data, null, true);

		assertThat(result.getThirdParty()).isEmpty();
		assertThat(result.getMappingsV3()).isNull();
	}

	@Test
	void thirdPartyAndMappingsV3RideThroughUntouched() {
		List<Map<String, Object>> blocks = List.of(Map.of("type", "cm360", "campaigns", List.of("Spring Sale")));
		List<Map<String, Object>> mappings = List.of(Map.of("id", "m1"));
		PacingDashboardData data = dashboardDataWith(blocks, mappings);

		PacingDashboardV1 result = mapper.toV1(data, null, true);

		assertThat(result.getThirdParty()).isEqualTo(blocks);
		assertThat(result.getMappingsV3()).isEqualTo(mappings);
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

	/**
	 * A dashboard payload that differs only in its two CM360 fields - every other slot is the
	 * minimum the mapper needs, so a failure above points at the field under test.
	 *
	 * @param thirdParty the configured CM360 blocks, or null
	 * @param mappingsV3 the v3 mapping entities, or null
	 * @return the payload to map
	 */
	PacingDashboardData dashboardDataWith(
			List<Map<String, Object>> thirdParty, List<Map<String, Object>> mappingsV3) {
		return new PacingDashboardData(
				new PacingDashboardCampaign("nike-ss26", "p1", "Nike SS26", "2026-08-01", "2026-09-30",
						"USD", 1.0, "Live", null, null, List.of(), false),
				Map.of(), List.of(), "2026-08-05",
				null, null, null, null, null, null, null,
				thirdParty, mappingsV3,
				null, null, null, null, null, null, null, List.of());
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
}
