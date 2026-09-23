package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDashboardV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDataSettingsUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDataSourceV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDimSourcesV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryEntryV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryKindV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryListResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRefreshStatusV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDashboardCampaign;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDashboardData;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDataSettings;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingJournalEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibraryEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLineItemPlan;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingPauseInterval;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshStatus;
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
				"nike-ss26", "p1", "Nike SS26", "2026-08-01", "2026-09-30", "USD", "Live", "SO-1");
		PacingLineItemPlan plan = new PacingLineItemPlan(
				"111", "Display", "DV360", "CPM", 5000.0, 1_000_000.0, 20.0, null, null,
				"2026-08-01", "2026-09-30",
				List.of(new PacingPauseInterval("2026-08-10", "2026-08-12")),
				List.of(Map.of("target_impressions", 200_000)), null);
		PacingJournalEntry journal = new PacingJournalEntry("j1", "2026-08-05", "Kicked off", "azat@aidigital.com", null);
		PacingDashboardData data = new PacingDashboardData(
				campaign, Map.of("111", plan), List.of(Map.of("date", "2026-08-01", "impressions", 500)),
				"2026-08-05", Map.of("widgets", List.of()), Map.of("groupBy", "day"), Map.of("contextWidgetSpec", 2),
				Map.of("campaign", Map.of("mA", 42.5)), null,
				Map.of("source", "platform_mart_adjustments_view", "fetch_creatives", true), List.of(journal));

		// When:
		PacingDashboardV1 result = mapper.toV1(data);

		// Then: the "id" field Pacing calls the campaign is renamed to "slug" on this contract
		assertThat(result.getCampaign().getSlug()).isEqualTo("nike-ss26");
		// The metric bag rides through untouched: it is Pacing's arithmetic, and the
		// Hub neither reshapes nor recomputes any of it - margin especially, which is
		// applied server-side and nowhere else.
		assertThat(result.getMetrics()).isEqualTo(Map.of("campaign", Map.of("mA", 42.5)));
		assertThat(result.getCampaign().getPacingId()).isEqualTo("p1");
		assertThat(result.getCampaign().getStartDate()).isEqualTo(LocalDate.of(2026, 8, 1));
		assertThat(result.getPlanByLineItem()).containsKey("111");
		assertThat(result.getPlanByLineItem().get("111").getPlannedImpressions()).isEqualTo(1_000_000.0);
		assertThat(result.getPlanByLineItem().get("111").getPauseIntervals()).hasSize(1);
		assertThat(result.getPlanByLineItem().get("111").getPauseIntervals().get(0).getFrom())
				.isEqualTo(LocalDate.of(2026, 8, 10));
		assertThat(result.getFactsDaily()).hasSize(1);
		assertThat(result.getAsOf()).isEqualTo("2026-08-05");
		assertThat(result.getDisplay()).containsKey("widgets");
		assertThat(result.getAggregate()).containsEntry("groupBy", "day");
		assertThat(result.getLibraryEntries()).isNull();
		// The data namespace rides through whole: the Data panel edits four of its keys and must be
		// able to carry the rest back unchanged.
		assertThat(result.getData())
				.isEqualTo(Map.of("source", "platform_mart_adjustments_view", "fetch_creatives", true));
		assertThat(result.getJournal()).hasSize(1);
		assertThat(result.getJournal().get(0).getMsg()).isEqualTo("Kicked off");
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
	void shouldDegradeMalformedFlightDatesToNullRatherThanFailTest() {
		// Given: a defensive rule shared with PacingContractMapper's own date parsing
		PacingDashboardCampaign campaign =
				new PacingDashboardCampaign("slug", "p1", "Name", "not-a-date", "", "USD", "Live", null);
		PacingDashboardData data = new PacingDashboardData(campaign, Map.of(), List.of(), null, Map.of(), Map.of(), null, null, null, null, List.of());

		// When:
		PacingDashboardV1 result = mapper.toV1(data);

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
}
