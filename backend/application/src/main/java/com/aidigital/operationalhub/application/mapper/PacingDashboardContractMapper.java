package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDashboardCampaignV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDashboardV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDataSettingsUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingJournalEntryV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryEntryV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryKindV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryListResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLineItemPlanV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingPauseIntervalV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRefreshStatusV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDashboardCampaign;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDashboardData;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDataSettings;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingJournalEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibraryEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLineItemPlan;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingPauseInterval;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshStatus;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;

/**
 * Bridges the Pacing HTTP client's transport-level dashboard/library models to the generated
 * {@code /api/v1/pacing/dashboards/*} and {@code /api/v1/pacing/library/*} contracts (§6 of the
 * migration plan).
 *
 * <p>{@code display}/{@code aggregate}/a library entry's {@code definition} pass through opaquely -
 * this mapper never inspects their internal shape, matching §6's "service logic: None."
 */
@Component
public class PacingDashboardContractMapper {

	/**
	 * Builds the {@code GET /api/v1/pacing/dashboards/{slug}} response.
	 *
	 * @param data the dashboard payload Pacing returned
	 * @return the generated {@link PacingDashboardV1}
	 */
	public PacingDashboardV1 toV1(PacingDashboardData data) {
		return new PacingDashboardV1()
				.campaign(toCampaignV1(data.campaign()))
				.planByLineItem(toPlanByLineItemV1(data.planByLineItem()))
				.factsDaily(data.factsDaily() == null ? List.of() : data.factsDaily())
				.asOf(data.asOf())
				.display(data.display() == null ? Map.of() : data.display())
				.aggregate(data.aggregate() == null ? Map.of() : data.aggregate())
				// Null is NOT flattened to an empty map, unlike display/aggregate above. Those two
				// are configuration - "no widgets chosen" and "{}" mean the same thing to a reader.
				// This one is measurement: absent means Pacing could not derive the figures, and a
				// widget must say so rather than draw an empty map's worth of confident zeroes.
				.capabilities(data.capabilities())
				.metrics(data.metrics())
				.libraryEntries(data.libraryEntries())
				// Null stays null for `metrics`' reason, not display's: a pacing that has never had
				// these settings written is not a pacing whose source is "". The panel shows Pacing's
				// own defaults for an absent namespace, and an empty map would be indistinguishable
				// from a namespace that exists and happens to be empty.
				.data(data.data())
				.journal(toJournalV1(data.journal()));
	}

	/**
	 * Reads a data-settings save request into the external-services model.
	 *
	 * <p>Null in, null out, deliberately: the request's optional fields are optional all the way down,
	 * and Pacing writes only the keys it receives. Defaulting an absent field here - to
	 * {@code platform_mart}, to {@code false} - would turn "the caller did not touch this" into "set
	 * it to the default", which on the BigQuery source means silently moving a corrected pacing back
	 * onto the raw feed.
	 *
	 * @param body the request body
	 * @return the settings to forward to Pacing
	 */
	public PacingDataSettings toDataSettings(PacingDataSettingsUpdateV1 body) {
		return new PacingDataSettings(
				body.getSource() == null ? null : body.getSource().getValue(),
				body.getFetchCreatives(),
				body.getFetchConversions(),
				// The wrapper, not its contents, is what says "the caller touched this". An absent
				// wrapper leaves the stored list alone; `entries: []` clears it, and has to survive as
				// an empty list rather than collapsing back into "absent".
				body.getDimSources() == null ? null : body.getDimSources().getEntries());
	}

	private PacingDashboardCampaignV1 toCampaignV1(PacingDashboardCampaign campaign) {
		if (campaign == null) {
			return new PacingDashboardCampaignV1();
		}
		// Pacing's own field is called `id`, but it is in fact the dash_slug - renamed here so the Hub
		// contract never confuses it with the pacing's real id (see PacingDashboardCampaign's javadoc).
		return new PacingDashboardCampaignV1()
				.slug(campaign.id())
				.pacingId(campaign.pacingId())
				.name(campaign.name())
				.startDate(parseDate(campaign.startDate()))
				.endDate(parseDate(campaign.endDate()))
				.currency(campaign.currency())
				.status(campaign.status())
				.orderNumber(campaign.orderNumber());
	}

	private Map<String, PacingLineItemPlanV1> toPlanByLineItemV1(Map<String, PacingLineItemPlan> planByLineItem) {
		if (planByLineItem == null) {
			return Map.of();
		}
		return planByLineItem.entrySet().stream()
				.collect(java.util.stream.Collectors.toMap(
						Map.Entry::getKey, entry -> toLineItemPlanV1(entry.getValue())));
	}

	private PacingLineItemPlanV1 toLineItemPlanV1(PacingLineItemPlan plan) {
		PacingLineItemPlanV1 v1 = new PacingLineItemPlanV1()
				.lineItemId(plan.lineItemId())
				.channel(plan.channel())
				.dsp(plan.dsp())
				.rateType(plan.rateType())
				.clientBudget(plan.clientBudget())
				.plannedImpressions(plan.plannedImpressions())
				.marginTargetPct(plan.marginTargetPct())
				.ctrTargetPct(plan.ctrTargetPct())
				.vcrTargetPct(plan.vcrTargetPct())
				.flightStart(parseDate(plan.flightStart()))
				.flightEnd(parseDate(plan.flightEnd()))
				.containers(plan.containers() == null ? List.of() : plan.containers())
				.nativeBudget(plan.nativeBudget());
		if (plan.pauseIntervals() != null) {
			for (PacingPauseInterval interval : plan.pauseIntervals()) {
				v1.addPauseIntervalsItem(new PacingPauseIntervalV1()
						.from(parseDate(interval.from()))
						.to(parseDate(interval.to())));
			}
		}
		return v1;
	}

	private List<PacingJournalEntryV1> toJournalV1(List<PacingJournalEntry> journal) {
		if (journal == null) {
			return List.of();
		}
		return journal.stream()
				.map(entry -> new PacingJournalEntryV1()
						.id(entry.id())
						.ts(entry.ts())
						.msg(entry.msg())
						.uid(entry.uid())
						.editedAt(entry.editedAt()))
				.toList();
	}

	/**
	 * Builds the {@code GET /api/v1/pacing/dashboards/{slug}/refresh-status} response.
	 *
	 * @param status the refresh status Pacing returned
	 * @return the generated {@link PacingRefreshStatusV1}
	 */
	public PacingRefreshStatusV1 toV1(PacingRefreshStatus status) {
		return new PacingRefreshStatusV1()
				.exists(status.exists())
				.refreshId(status.refreshId())
				.rowCount(status.rowCount() == null ? 0 : status.rowCount())
				.latestDate(parseDate(status.latestDate()));
	}

	/**
	 * Builds one entry of a {@code GET /api/v1/pacing/library} response, or a
	 * {@code POST}/{@code PUT /api/v1/pacing/library[/:id]} success response.
	 *
	 * @param entry the library entry Pacing returned
	 * @return the generated {@link PacingLibraryEntryV1}
	 */
	public PacingLibraryEntryV1 toV1(PacingLibraryEntry entry) {
		return new PacingLibraryEntryV1()
				.id(entry.id())
				.kind(entry.kind() == null ? null : PacingLibraryKindV1.fromValue(entry.kind()))
				.name(entry.name())
				.description(entry.description())
				.definition(entry.definition())
				.ownerName(entry.ownerName())
				.createdAt(entry.createdAt())
				.updatedAt(entry.updatedAt())
				.likes(entry.likes())
				.liked(entry.liked())
				.mine(entry.mine())
				.usage(entry.usage());
	}

	/**
	 * Builds the {@code GET /api/v1/pacing/library} response.
	 *
	 * @param entries the library entries Pacing returned
	 * @return the generated {@link PacingLibraryListResponseV1}
	 */
	public PacingLibraryListResponseV1 toListV1(List<PacingLibraryEntry> entries) {
		return new PacingLibraryListResponseV1().entries(entries.stream().map(this::toV1).toList());
	}

	/**
	 * Parses a Pacing {@code YYYY-MM-DD} date string. Null/blank stays null; a malformed value from an
	 * external service also degrades to null rather than failing the whole response - same defensive
	 * rule {@code PacingContractMapper} applies to a pacing row's flight dates.
	 *
	 * @param value the raw date string from Pacing, or null
	 * @return the parsed date, or null if {@code value} is null/blank/malformed
	 */
	private LocalDate parseDate(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
		try {
			return LocalDate.parse(value);
		} catch (DateTimeParseException ex) {
			return null;
		}
	}
}
