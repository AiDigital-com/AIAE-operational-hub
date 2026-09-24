package com.aidigital.operationalhub.application.mapper;

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
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDashboardCampaignV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDashboardV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDataSettingsUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingJournalEntryV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryEntryV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryKindV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryListResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLineItemPlanV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNotifyMetricsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNotifySettingsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingPauseIntervalV1;
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
				.notify(data.notifySettings() == null ? null : toV1(data.notifySettings()))
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

	/**
	 * Builds the {@code notify} field of the {@code GET /api/v1/pacing/dashboards/{slug}} response
	 * (§14 of the migration plan).
	 *
	 * @param settings the alert configuration Pacing returned
	 * @return the generated {@link PacingNotifySettingsV1}
	 */
	public PacingNotifySettingsV1 toV1(PacingNotifySettings settings) {
		return new PacingNotifySettingsV1()
				.alerts(toV1(settings.alerts()))
				.metrics(new PacingNotifyMetricsV1().vcr(settings.metrics().vcr()))
				.hidePaused(settings.hidePaused())
				.summaryProjection(PacingSummaryProjectionV1.fromValue(settings.summaryProjection()));
	}

	/**
	 * Reads a {@code POST /api/v1/pacing/dashboards/{slug}/notify-settings} request into the
	 * external-services model (§14 of the migration plan).
	 *
	 * <p>Unlike {@link #toDataSettings}, every field is required by the generated request type - this
	 * is a whole-object replace, not a partial patch (see {@link PacingNotifySettings}'s javadoc), so
	 * there is no "absent means untouched" case to preserve here.
	 *
	 * @param body the request body
	 * @return the alert configuration to forward to Pacing
	 */
	public PacingNotifySettings toNotifySettings(PacingNotifySettingsV1 body) {
		return new PacingNotifySettings(
				toAlertsConfig(body.getAlerts()),
				new PacingNotifyMetrics(body.getMetrics().getVcr()),
				body.getHidePaused(),
				body.getSummaryProjection().getValue());
	}

	/**
	 * Maps the 13-detector alert configuration, plus its master Slack switch, to the generated shape.
	 *
	 * @param alerts the alert configuration Pacing returned
	 * @return the generated {@link PacingAlertsConfigV1}
	 */
	PacingAlertsConfigV1 toV1(PacingAlertsConfig alerts) {
		return new PacingAlertsConfigV1()
				.enabled(alerts.enabled())
				.bidFactAbovePlan(toV1(alerts.bidFactAbovePlan()))
				.dataGap(new PacingAlertRuleGapDaysV1()
						.enabled(alerts.dataGap().enabled()).slack(alerts.dataGap().slack())
						.gapDays(alerts.dataGap().gapDays()))
				.ctrBelowTarget(toV1(alerts.ctrBelowTarget()))
				.vcrBelowTarget(toV1(alerts.vcrBelowTarget()))
				.ctrAboveTarget(toV1(alerts.ctrAboveTarget()))
				.vcrOver100(toV1(alerts.vcrOver100()))
				.noImpressionsYet(toV1(alerts.noImpressionsYet()))
				.pacingOffPace(new PacingAlertRuleBandV1()
						.enabled(alerts.pacingOffPace().enabled()).slack(alerts.pacingOffPace().slack())
						.low(alerts.pacingOffPace().low()).high(alerts.pacingOffPace().high()))
				.marginBelowTarget(new PacingAlertRuleGapPpV1()
						.enabled(alerts.marginBelowTarget().enabled()).slack(alerts.marginBelowTarget().slack())
						.gapPp(alerts.marginBelowTarget().gapPp()))
				.spendOverspend(new PacingAlertRuleSpendV1()
						.enabled(alerts.spendOverspend().enabled()).slack(alerts.spendOverspend().slack())
						.warnPct(alerts.spendOverspend().warnPct()).badPct(alerts.spendOverspend().badPct()))
				.dspForecastOverspend(toV1(alerts.dspForecastOverspend()))
				.staleData(new PacingAlertRuleDaysV1()
						.enabled(alerts.staleData().enabled()).slack(alerts.staleData().slack())
						.days(alerts.staleData().days()))
				.rateCostAbovePlan(new PacingAlertRuleThresholdPctV1()
						.enabled(alerts.rateCostAbovePlan().enabled()).slack(alerts.rateCostAbovePlan().slack())
						.thresholdPct(alerts.rateCostAbovePlan().thresholdPct()));
	}

	/**
	 * Maps a threshold-less detector (no threshold field beyond enabled/slack).
	 *
	 * @param rule the detector's stored configuration
	 * @return the generated {@link PacingAlertRuleBaseV1}
	 */
	PacingAlertRuleBaseV1 toV1(PacingAlertRuleBase rule) {
		return new PacingAlertRuleBaseV1().enabled(rule.enabled()).slack(rule.slack());
	}

	/**
	 * Maps a factor-of-target detector ({@code ctr_below_target}, {@code vcr_below_target},
	 * {@code ctr_above_target}).
	 *
	 * @param rule the detector's stored configuration
	 * @return the generated {@link PacingAlertRuleFactorV1}
	 */
	PacingAlertRuleFactorV1 toV1(PacingAlertRuleFactor rule) {
		return new PacingAlertRuleFactorV1().enabled(rule.enabled()).slack(rule.slack()).factor(rule.factor());
	}

	/**
	 * Maps the Bid Fact above plan detector, the only one with both a window and a threshold.
	 *
	 * @param rule the detector's stored configuration
	 * @return the generated {@link PacingAlertRuleWindowThresholdV1}
	 */
	PacingAlertRuleWindowThresholdV1 toV1(PacingAlertRuleWindowThreshold rule) {
		return new PacingAlertRuleWindowThresholdV1()
				.enabled(rule.enabled()).slack(rule.slack())
				.window(rule.window()).thresholdPct(rule.thresholdPct());
	}

	/**
	 * Reads the generated alert-configuration request shape into the external-services model.
	 *
	 * @param v1 the request's alert configuration
	 * @return the alert configuration to forward to Pacing
	 */
	PacingAlertsConfig toAlertsConfig(PacingAlertsConfigV1 v1) {
		return new PacingAlertsConfig(
				v1.getEnabled(),
				toWindowThreshold(v1.getBidFactAbovePlan()),
				new PacingAlertRuleGapDays(
						v1.getDataGap().getEnabled(), v1.getDataGap().getSlack(), v1.getDataGap().getGapDays()),
				toFactor(v1.getCtrBelowTarget()),
				toFactor(v1.getVcrBelowTarget()),
				toFactor(v1.getCtrAboveTarget()),
				toBase(v1.getVcrOver100()),
				toBase(v1.getNoImpressionsYet()),
				new PacingAlertRuleBand(
						v1.getPacingOffPace().getEnabled(), v1.getPacingOffPace().getSlack(),
						v1.getPacingOffPace().getLow(), v1.getPacingOffPace().getHigh()),
				new PacingAlertRuleGapPp(
						v1.getMarginBelowTarget().getEnabled(), v1.getMarginBelowTarget().getSlack(),
						v1.getMarginBelowTarget().getGapPp()),
				new PacingAlertRuleSpend(
						v1.getSpendOverspend().getEnabled(), v1.getSpendOverspend().getSlack(),
						v1.getSpendOverspend().getWarnPct(), v1.getSpendOverspend().getBadPct()),
				toBase(v1.getDspForecastOverspend()),
				new PacingAlertRuleDays(
						v1.getStaleData().getEnabled(), v1.getStaleData().getSlack(), v1.getStaleData().getDays()),
				new PacingAlertRuleThresholdPct(
						v1.getRateCostAbovePlan().getEnabled(), v1.getRateCostAbovePlan().getSlack(),
						v1.getRateCostAbovePlan().getThresholdPct()));
	}

	/**
	 * Reads a threshold-less detector's request shape into the external-services model.
	 *
	 * @param v1 the detector's request shape
	 * @return the detector configuration to forward to Pacing
	 */
	PacingAlertRuleBase toBase(PacingAlertRuleBaseV1 v1) {
		return new PacingAlertRuleBase(v1.getEnabled(), v1.getSlack());
	}

	/**
	 * Reads a factor-of-target detector's request shape into the external-services model.
	 *
	 * @param v1 the detector's request shape
	 * @return the detector configuration to forward to Pacing
	 */
	PacingAlertRuleFactor toFactor(PacingAlertRuleFactorV1 v1) {
		return new PacingAlertRuleFactor(v1.getEnabled(), v1.getSlack(), v1.getFactor());
	}

	/**
	 * Reads the Bid Fact above plan detector's request shape into the external-services model.
	 *
	 * @param v1 the detector's request shape
	 * @return the detector configuration to forward to Pacing
	 */
	PacingAlertRuleWindowThreshold toWindowThreshold(PacingAlertRuleWindowThresholdV1 v1) {
		return new PacingAlertRuleWindowThreshold(v1.getEnabled(), v1.getSlack(), v1.getWindow(), v1.getThresholdPct());
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
