package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffCountsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffCoveredByV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffFieldChangeV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffForeignCampaignV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffLineItemFieldsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffMissingInNetsuiteV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffMissingInPacingV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffOwnerMismatchV1;
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
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * Bridges the Pacing HTTP client's transport-level NetSuite-diff models to the generated
 * {@code GET /api/v1/pacing/pacings/{pacingId}/ns-diff} contract, and the small nightly-summary
 * shape carried on each {@code PacingRowV1.nsDiffSummary} (§13 of the migration plan, US-136). Its
 * own file, mirroring how {@link PacingDashboardContractMapper} owns the dashboard/library feature
 * area separately from {@link PacingContractMapper}'s pacings-list/assertion concerns.
 */
@Component
public class PacingNsDiffContractMapper {

	/**
	 * Builds the {@code GET /api/v1/pacing/pacings/{pacingId}/ns-diff} response.
	 *
	 * @param report the full diff report Pacing returned
	 * @return the generated {@link PacingNsDiffReportV1}
	 */
	public PacingNsDiffReportV1 toV1(PacingNsDiffReport report) {
		return new PacingNsDiffReportV1()
				.pacingId(report.pacingId())
				.dashSlug(report.dashSlug())
				.classes(report.classes() == null ? List.of() : report.classes())
				.counts(toCountsV1(report.counts()))
				.inSync(report.inSync())
				.notCheckedLineItems(report.notCheckedLineItems())
				.missingInNetsuite(toMissingInNetsuiteListV1(report.missingInNetsuite()))
				.missingInPacing(toMissingInPacingListV1(report.missingInPacing()))
				.fieldDiff(toLineItemFieldsListV1(report.fieldDiff()))
				.planDiff(toLineItemFieldsListV1(report.planDiff()))
				.foreignCampaign(toForeignCampaignListV1(report.foreignCampaign()))
				.ownerDiff(toOwnerMismatchListV1(report.ownerDiff()));
	}

	/**
	 * Builds the nightly-summary shape carried on {@code PacingRowV1.nsDiffSummary}.
	 *
	 * @param summary the summary Pacing rode along on the row, or null when the nightly job has never
	 *                covered this pacing
	 * @return the generated {@link PacingNsDiffSummaryV1}, or null when {@code summary} is null
	 */
	public PacingNsDiffSummaryV1 toNsDiffSummaryV1(PacingNsDiffSummary summary) {
		if (summary == null) {
			return null;
		}
		return new PacingNsDiffSummaryV1()
				.counts(toCountsV1(summary.counts()))
				.inSync(summary.inSync())
				.computedAt(parseDateTime(summary.computedAt()));
	}

	PacingNsDiffCountsV1 toCountsV1(PacingNsDiffCounts counts) {
		if (counts == null) {
			return null;
		}
		return new PacingNsDiffCountsV1()
				.missingInNetsuite(counts.missingInNetsuite())
				.missingInPacing(counts.missingInPacing())
				.fieldDiff(counts.fieldDiff())
				.planDiff(counts.planDiff())
				.foreignCampaign(counts.foreignCampaign())
				.ownerDiff(counts.ownerDiff());
	}

	List<PacingNsDiffMissingInNetsuiteV1> toMissingInNetsuiteListV1(
			List<PacingNsDiffMissingInNetsuite> entries) {
		return entries == null ? List.of() : entries.stream().map(this::toMissingInNetsuiteV1).toList();
	}

	PacingNsDiffMissingInNetsuiteV1 toMissingInNetsuiteV1(PacingNsDiffMissingInNetsuite entry) {
		return new PacingNsDiffMissingInNetsuiteV1()
				.lineItemId(entry.lineItemId())
				.channel(entry.channel())
				.targetSpend(entry.targetSpend())
				.targetImpressions(entry.targetImpressions());
	}

	List<PacingNsDiffMissingInPacingV1> toMissingInPacingListV1(List<PacingNsDiffMissingInPacing> entries) {
		return entries == null ? List.of() : entries.stream().map(this::toMissingInPacingV1).toList();
	}

	PacingNsDiffMissingInPacingV1 toMissingInPacingV1(PacingNsDiffMissingInPacing entry) {
		return new PacingNsDiffMissingInPacingV1()
				.lineItemId(entry.lineItemId())
				.campaignId(entry.campaignId())
				.campaignName(entry.campaignName())
				.orderNumber(entry.orderNumber())
				.channel(entry.channel())
				.rateType(entry.rateType())
				.nativeBudget(entry.nativeBudget())
				.plannedUnits(entry.plannedUnits())
				.flightStart(parseDate(entry.flightStart()))
				.flightEnd(parseDate(entry.flightEnd()))
				.description(entry.description())
				.coveredBy(toCoveredByV1(entry.coveredBy()));
	}

	/**
	 * Maps the OTHER Live pacing a missing_in_pacing entry is already covered by (§13, US-136
	 * follow-up), or null when nobody covers it.
	 *
	 * @param coveredBy the coverage info Pacing returned, or null
	 * @return the contract shape, or null when {@code coveredBy} is null
	 */
	PacingNsDiffCoveredByV1 toCoveredByV1(PacingNsDiffCoveredBy coveredBy) {
		if (coveredBy == null) {
			return null;
		}
		return new PacingNsDiffCoveredByV1()
				.pacingId(coveredBy.pacingId())
				.pacingName(coveredBy.pacingName())
				.dashSlug(coveredBy.dashSlug())
				.status(coveredBy.status());
	}

	List<PacingNsDiffLineItemFieldsV1> toLineItemFieldsListV1(List<PacingNsDiffLineItemFields> entries) {
		return entries == null ? List.of() : entries.stream().map(this::toLineItemFieldsV1).toList();
	}

	PacingNsDiffLineItemFieldsV1 toLineItemFieldsV1(PacingNsDiffLineItemFields entry) {
		PacingNsDiffLineItemFieldsV1 v1 = new PacingNsDiffLineItemFieldsV1().lineItemId(entry.lineItemId());
		if (entry.fields() != null) {
			entry.fields().forEach(field -> v1.addFieldsItem(toFieldChangeV1(field)));
		}
		return v1;
	}

	/**
	 * Maps one changed field, passing {@code pacing}/{@code netsuite}/{@code pacingNative}/
	 * {@code netsuiteNative} through untouched - they are genuinely polymorphic (string or number
	 * depending on {@code field}), so this mapper does not attempt to interpret or reshape them.
	 *
	 * @param change the field change from Pacing
	 * @return the contract shape
	 */
	PacingNsDiffFieldChangeV1 toFieldChangeV1(PacingNsDiffFieldChange change) {
		PacingNsDiffFieldChangeV1.SourceEnum source =
				change.source() == null ? null : PacingNsDiffFieldChangeV1.SourceEnum.fromValue(change.source());
		return new PacingNsDiffFieldChangeV1()
				.field(change.field())
				.pacing(change.pacing())
				.netsuite(change.netsuite())
				.source(source)
				.pacingNative(change.pacingNative())
				.netsuiteNative(change.netsuiteNative());
	}

	List<PacingNsDiffForeignCampaignV1> toForeignCampaignListV1(List<PacingNsDiffForeignCampaign> entries) {
		return entries == null ? List.of() : entries.stream().map(this::toForeignCampaignV1).toList();
	}

	PacingNsDiffForeignCampaignV1 toForeignCampaignV1(PacingNsDiffForeignCampaign entry) {
		return new PacingNsDiffForeignCampaignV1()
				.lineItemId(entry.lineItemId())
				.pacingCampaignId(entry.pacingCampaignId())
				.netsuiteCampaignId(entry.netsuiteCampaignId())
				.netsuiteCampaignName(entry.netsuiteCampaignName())
				.inPacingCampaignSet(entry.inPacingCampaignSet());
	}

	List<PacingNsDiffOwnerMismatchV1> toOwnerMismatchListV1(List<PacingNsDiffOwnerMismatch> entries) {
		return entries == null ? List.of() : entries.stream().map(this::toOwnerMismatchV1).toList();
	}

	PacingNsDiffOwnerMismatchV1 toOwnerMismatchV1(PacingNsDiffOwnerMismatch entry) {
		return new PacingNsDiffOwnerMismatchV1()
				.campaignId(entry.campaignId())
				.campaignName(entry.campaignName())
				.ownerName(entry.ownerName())
				.mpoTeamLead(entry.mpoTeamLead());
	}

	/**
	 * Parses a Pacing {@code YYYY-MM-DD} date string. Null/blank stays null; a malformed value from an
	 * external service also degrades to null rather than failing the whole response - same defensive
	 * rule {@code PacingContractMapper} applies to a pacing row's flight dates.
	 *
	 * @param value the raw date string from Pacing, or null
	 * @return the parsed date, or null if {@code value} is null/blank/malformed
	 */
	LocalDate parseDate(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
		try {
			return LocalDate.parse(value);
		} catch (DateTimeParseException ex) {
			return null;
		}
	}

	/**
	 * Parses Pacing's {@code computed_at} ISO-8601 instant string. Same degrade-to-null contract as
	 * {@link #parseDate}: a malformed value from an external service does not fail the whole response.
	 *
	 * @param value the raw timestamp string from Pacing, or null
	 * @return the parsed timestamp, or null if {@code value} is null/blank/malformed
	 */
	LocalDateTime parseDateTime(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
		try {
			return OffsetDateTime.parse(value).toLocalDateTime();
		} catch (DateTimeParseException ex) {
			return null;
		}
	}
}
