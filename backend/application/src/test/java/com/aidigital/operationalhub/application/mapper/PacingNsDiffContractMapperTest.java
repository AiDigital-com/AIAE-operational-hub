package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffFieldChangeV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffReportV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffSummaryV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffCounts;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffCoveredBy;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffFieldChange;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffForeignCampaign;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffLineItemFields;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffMissingInNetsuite;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffMissingInPacing;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffOwnerMismatch;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffReport;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffSummary;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link PacingNsDiffContractMapper}.
 */
class PacingNsDiffContractMapperTest {

	private final PacingNsDiffContractMapper mapper = new PacingNsDiffContractMapper();

	@Test
	void shouldMapFullReportWithAllSixClassesTest() {
		// Given: one entry per class, the shape a real diff with something in every bucket has
		PacingNsDiffCounts counts = new PacingNsDiffCounts(1, 1, 1, 1, 1, 1);
		PacingNsDiffFieldChange stringField =
				new PacingNsDiffFieldChange("channel", "Display", "Video", null, null, null);
		PacingNsDiffFieldChange dateField =
				new PacingNsDiffFieldChange("flight_start", "2026-05-01", "2026-05-03", "override", null, null);
		PacingNsDiffFieldChange spendField =
				new PacingNsDiffFieldChange("target_spend", 7000.0, 7500.0, null, 7000.0, 7500.0);
		PacingNsDiffReport report = new PacingNsDiffReport(
				true, "p1", "nike-ss26",
				List.of("missing_in_netsuite", "missing_in_pacing", "field_diff", "plan_diff", "foreign_campaign", "owner_diff"),
				counts, false, List.of("manual-1"),
				List.of(new PacingNsDiffMissingInNetsuite("100", "Display", 5000.0, 700000.0)),
				List.of(new PacingNsDiffMissingInPacing(
						"456", "C1", "Spring Push", "3854", "Display", "CPM", 7000.0, 1000000.0,
						"2026-05-01", "2026-05-31", "NS desc",
						new PacingNsDiffCoveredBy("p2", "Other Pacing", "other-slug", "Live"))),
				List.of(new PacingNsDiffLineItemFields("123", List.of(stringField, dateField))),
				List.of(new PacingNsDiffLineItemFields("123", List.of(spendField))),
				List.of(new PacingNsDiffForeignCampaign("123", "C1", "C2", "Other Campaign", false)),
				List.of(new PacingNsDiffOwnerMismatch("C1", "Spring Push", "Ana Ruiz", "Someone Else")));

		// When:
		PacingNsDiffReportV1 v1 = mapper.toV1(report);

		// Then:
		assertThat(v1.getPacingId()).isEqualTo("p1");
		assertThat(v1.getDashSlug()).isEqualTo("nike-ss26");
		assertThat(v1.getInSync()).isFalse();
		assertThat(v1.getNotCheckedLineItems()).containsExactly("manual-1");
		assertThat(v1.getCounts().getMissingInPacing()).isEqualTo(1);
		assertThat(v1.getMissingInNetsuite()).hasSize(1);
		assertThat(v1.getMissingInNetsuite().get(0).getTargetImpressions()).isEqualTo(700000.0);
		assertThat(v1.getMissingInPacing()).hasSize(1);
		assertThat(v1.getMissingInPacing().get(0).getCampaignName()).isEqualTo("Spring Push");
		assertThat(v1.getMissingInPacing().get(0).getFlightStart()).isEqualTo(LocalDate.of(2026, 5, 1));
		// §13 follow-up: the OTHER pacing already covering this line item is named, not filtered out
		assertThat(v1.getMissingInPacing().get(0).getCoveredBy().getPacingName()).isEqualTo("Other Pacing");
		assertThat(v1.getMissingInPacing().get(0).getCoveredBy().getDashSlug()).isEqualTo("other-slug");
		// field_diff: a plain string field alongside a flight-date field carrying `source`
		assertThat(v1.getFieldDiff()).hasSize(1);
		assertThat(v1.getFieldDiff().get(0).getFields()).hasSize(2);
		assertThat(v1.getFieldDiff().get(0).getFields().get(0).getPacing()).isEqualTo("Display");
		assertThat(v1.getFieldDiff().get(0).getFields().get(0).getSource()).isNull();
		assertThat(v1.getFieldDiff().get(0).getFields().get(1).getSource())
				.isEqualTo(PacingNsDiffFieldChangeV1.SourceEnum.OVERRIDE);
		// plan_diff: target_spend carries both the USD and native-currency figures
		assertThat(v1.getPlanDiff().get(0).getFields().get(0).getPacing()).isEqualTo(7000.0);
		assertThat(v1.getPlanDiff().get(0).getFields().get(0).getPacingNative()).isEqualTo(7000.0);
		assertThat(v1.getPlanDiff().get(0).getFields().get(0).getNetsuiteNative()).isEqualTo(7500.0);
		assertThat(v1.getForeignCampaign()).hasSize(1);
		assertThat(v1.getForeignCampaign().get(0).getInPacingCampaignSet()).isFalse();
		assertThat(v1.getOwnerDiff()).hasSize(1);
		assertThat(v1.getOwnerDiff().get(0).getMpoTeamLead()).isEqualTo("Someone Else");
	}

	@Test
	void shouldMapEmptyClassArraysWhenNothingDifferedTest() {
		// Given: an in-sync pacing - every class array is empty, not null
		PacingNsDiffCounts counts = new PacingNsDiffCounts(0, 0, 0, 0, 0, 0);
		PacingNsDiffReport report = new PacingNsDiffReport(
				true, "p1", "nike-ss26", List.of(), counts, true, null,
				List.of(), List.of(), List.of(), List.of(), List.of(), List.of());

		// When:
		PacingNsDiffReportV1 v1 = mapper.toV1(report);

		// Then:
		assertThat(v1.getInSync()).isTrue();
		assertThat(v1.getNotCheckedLineItems()).isNull();
		assertThat(v1.getMissingInNetsuite()).isEmpty();
		assertThat(v1.getFieldDiff()).isEmpty();
		assertThat(v1.getOwnerDiff()).isEmpty();
	}

	@Test
	void shouldMapNsDiffSummaryTest() {
		// Given: the nightly-summary shape carried on a pacing row
		PacingNsDiffSummary summary = new PacingNsDiffSummary(
				new PacingNsDiffCounts(0, 1, 2, 0, 0, 1), false, "2026-09-21T02:30:00.000Z");

		// When:
		PacingNsDiffSummaryV1 v1 = mapper.toNsDiffSummaryV1(summary);

		// Then:
		assertThat(v1.getInSync()).isFalse();
		assertThat(v1.getComputedAt()).isEqualTo(LocalDateTime.of(2026, 9, 21, 2, 30, 0));
		assertThat(v1.getCounts().getMissingInPacing()).isEqualTo(1);
		assertThat(v1.getCounts().getOwnerDiff()).isEqualTo(1);
	}

	@Test
	void shouldReturnNullSummaryWhenNightlyJobHasNeverCoveredThePacingTest() {
		// When / Then: absent, not a default/empty summary - §13's frozen-value contract only applies
		// once the nightly job has actually run for this pacing at least once
		assertThat(mapper.toNsDiffSummaryV1(null)).isNull();
	}

	@Test
	void shouldDegradeAMalformedComputedAtToNullRatherThanThrowTest() {
		// Given: same degrade-to-null contract PacingContractMapper applies to a malformed created_at
		PacingNsDiffSummary summary = new PacingNsDiffSummary(new PacingNsDiffCounts(0, 0, 0, 0, 0, 0), true, "not-a-timestamp");

		// When:
		PacingNsDiffSummaryV1 v1 = mapper.toNsDiffSummaryV1(summary);

		// Then:
		assertThat(v1.getComputedAt()).isNull();
	}

	@Test
	void shouldDegradeAMalformedFlightDateInMissingInPacingToNullRatherThanThrowTest() {
		// Given:
		PacingNsDiffMissingInPacing entry = new PacingNsDiffMissingInPacing(
				"456", "C1", "Spring Push", "3854", "Display", "CPM", 7000.0, 1000000.0,
				"not-a-date", "", "NS desc", null);
		PacingNsDiffReport report = new PacingNsDiffReport(
				true, "p1", "nike-ss26", List.of(), new PacingNsDiffCounts(0, 1, 0, 0, 0, 0), false, null,
				List.of(), List.of(entry), List.of(), List.of(), List.of(), List.of());

		// When:
		PacingNsDiffReportV1 v1 = mapper.toV1(report);

		// Then:
		assertThat(v1.getMissingInPacing().get(0).getFlightStart()).isNull();
		assertThat(v1.getMissingInPacing().get(0).getFlightEnd()).isNull();
	}

	@Test
	void shouldLeaveCoveredByNullWhenNobodyElseCoversTheLineItemTest() {
		// Given: the common case - most missing_in_pacing entries are genuinely uncovered
		PacingNsDiffMissingInPacing entry = new PacingNsDiffMissingInPacing(
				"456", "C1", "Spring Push", "3854", "Display", "CPM", 7000.0, 1000000.0,
				"2026-05-01", "2026-05-31", "NS desc", null);
		PacingNsDiffReport report = new PacingNsDiffReport(
				true, "p1", "nike-ss26", List.of(), new PacingNsDiffCounts(0, 1, 0, 0, 0, 0), false, null,
				List.of(), List.of(entry), List.of(), List.of(), List.of(), List.of());

		// When:
		PacingNsDiffReportV1 v1 = mapper.toV1(report);

		// Then:
		assertThat(v1.getMissingInPacing().get(0).getCoveredBy()).isNull();
	}
}
