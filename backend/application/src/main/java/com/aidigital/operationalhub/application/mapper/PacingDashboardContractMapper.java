package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertRuleBaseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertRuleFactorV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertRuleWindowThresholdV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertsConfigV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCampaignLinksUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDataSettingsUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingJournalEntryV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryEntryV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryKindV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryListResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryVisibilityV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNotifySettingsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRefreshStatusV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyData;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingMappingSuggestedDimension;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingMappingSuggestedValue;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceBinding;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceGroup;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceRead;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceSuggestions;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceValue;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceValues;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSheetProbe;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSheetTab;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingMappingSuggestions;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyCampaign;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyCampaigns;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyStatus;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingThirdPartyDataV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingMappingSuggestedDimensionV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingMappingSuggestedValueV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDimSourceBindingV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDimSourceGroupV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDimSourceReadV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDimSourceSuggestionsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDimSourceValueV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDimSourceValuesV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingSheetProbeV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingSheetTabV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingMappingSuggestionsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingThirdPartyCampaignV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingThirdPartyCampaignsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingThirdPartyStatusV1;
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
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDataSettings;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSheetSourceInstruction;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingJournalEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibraryEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNotifyMetrics;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNotifySettings;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshStatus;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * Bridges the Pacing HTTP client's transport-level models to the generated
 * {@code /api/v1/pacing/dashboards/*} and {@code /api/v1/pacing/library/*} contracts (§6 of the
 * migration plan) - every one of them except the dashboard body itself, which since 2026-10-29
 * (DASHBOARD-DATA-PASSTHROUGH-PLAN) is copied through to the browser unparsed and reshaped there
 * by {@code features/pacing-dashboard/wire.ts}, a one-to-one port of what used to be this class's
 * {@code toV1(PacingDashboardData, ...)}. The write directions (data settings, notify settings,
 * campaign links) and the journal write responses stay here.
 *
 * <p>A library entry's {@code definition} passes through opaquely - this mapper never inspects its
 * internal shape, matching §6's "service logic: None."
 */
@Component
public class PacingDashboardContractMapper {

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
				body.getCoefEnabled(),
				body.getNetEnabled(),
				body.getPrimaryCvEnabled(),
				// The wrapper, not its contents, is what says "the caller touched this". An absent
				// wrapper leaves the stored list alone; `entries: []` clears it, and has to survive as
				// an empty list rather than collapsing back into "absent".
				body.getDimSources() == null ? null : body.getDimSources().getEntries(),
				// Absent means "leave the stored names alone" - the screen sends this only when this
				// session changed them, so a drawer opened before a teammate's edit cannot wipe it.
				body.getValueLabels(),
				// Three states, carried by the WRAPPER rather than by the value: no wrapper means "leave
				// the stored source alone", a wrapper with an entry replaces it, and a wrapper with a null
				// entry disconnects it. A bare nullable field could not say the third thing - the Hub omits
				// nulls on the wire, so "disconnect" would arrive as "leave it".
				body.getSheet() == null
						? null
						: new PacingSheetSourceInstruction(body.getSheet().getEntry()),
				body.getDeliveryTab(),
				body.getLensContext());
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

	/**
	 * Reads a campaign-links save request into the external-services model (§16, US-140/141).
	 * Shape-only: validation (scheme, lengths, the Asana rule) belongs to
	 * {@code CampaignLinksValidator}, which runs on THIS method's output so the model it clears is
	 * exactly the model the client sends.
	 *
	 * @param body the request body
	 * @return every link the pacing should keep, in the order the caller sent
	 */
	public List<PacingCampaignLink> toCampaignLinks(PacingCampaignLinksUpdateV1 body) {
		return body.getLinks().stream()
				.map(link -> new PacingCampaignLink(link.getName(), link.getUrl()))
				.toList();
	}

	/**
	 * Builds the journal array the three {@code pacingJournal} write endpoints answer with (§15,
	 * US-139), computing each entry's {@code canEdit} from the caller's own identity rather than
	 * forwarding Pacing's raw author id.
	 *
	 * <p>The dashboard GET no longer comes through here: since the 2026-10-29 pass-through
	 * (DASHBOARD-DATA-PASSTHROUGH-PLAN) its body is copied to the browser unparsed and
	 * {@code features/pacing-dashboard/wire.ts} applies this same two-line rule there, from
	 * {@code UserV1.pacingUserId}/{@code pacingUnrestricted}. The two copies are held identical by
	 * that side's parity test over real bodies; change the rule here and it must change there.
	 *
	 * @param journal           the journal Pacing returned; null is treated as empty
	 * @param ownPacingUserId   the current user's own Pacing user id, or null if not yet synced
	 * @param unrestrictedScope whether the current user's resolved Pacing scope is unfiltered
	 * @return the generated journal entries, in the same order
	 */
	public List<PacingJournalEntryV1> toJournalV1(
			List<PacingJournalEntry> journal, String ownPacingUserId, boolean unrestrictedScope) {
		if (journal == null) {
			return List.of();
		}
		return journal.stream()
				.map(entry -> toJournalEntryV1(entry, ownPacingUserId, unrestrictedScope))
				.toList();
	}

	/**
	 * Builds one journal entry, per {@link #toJournalV1}.
	 *
	 * @param entry             the entry Pacing returned
	 * @param ownPacingUserId   the current user's own Pacing user id, or null if not yet synced
	 * @param unrestrictedScope whether the current user's resolved Pacing scope is unfiltered
	 * @return the generated {@link PacingJournalEntryV1}
	 */
	PacingJournalEntryV1 toJournalEntryV1(
			PacingJournalEntry entry, String ownPacingUserId, boolean unrestrictedScope) {
		boolean canEdit = unrestrictedScope
				|| (ownPacingUserId != null && ownPacingUserId.equals(entry.userId()));
		return new PacingJournalEntryV1()
				.id(entry.id())
				.ts(entry.ts())
				.msg(entry.msg())
				.uid(entry.uid())
				.editedAt(entry.editedAt())
				.canEdit(canEdit);
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
	 * Builds the body of {@code GET /api/v1/pacing/dashboards/:slug/third-party/status}.
	 *
	 * @param status where the CM360 read stands, as Pacing reported it
	 * @return the generated {@link PacingThirdPartyStatusV1}
	 */
	public PacingThirdPartyStatusV1 toV1(PacingThirdPartyStatus status) {
		return new PacingThirdPartyStatusV1()
				// An unrecognised state is NOT passed through: the enum is the contract a widget
				// switches on, and a value outside it would reach the UI as an unhandled branch. A
				// state we cannot read means we cannot say anything, which is `none`.
				.state(stateOrNone(status.state()))
				.fetchedAt(status.fetchedAt())
				.rowCount(status.rowCount())
				.campaigns(status.campaigns());
	}

	/**
	 * The four states a CM360 read can be in, with anything else read as {@code none}.
	 *
	 * @param state the raw state string from Pacing
	 * @return the matching enum constant, or {@code NONE}
	 */
	PacingThirdPartyStatusV1.StateEnum stateOrNone(String state) {
		if (state == null) {
			return PacingThirdPartyStatusV1.StateEnum.NONE;
		}
		for (PacingThirdPartyStatusV1.StateEnum candidate : PacingThirdPartyStatusV1.StateEnum.values()) {
			if (candidate.getValue().equals(state)) {
				return candidate;
			}
		}
		return PacingThirdPartyStatusV1.StateEnum.NONE;
	}

	/**
	 * Builds the body of {@code GET /api/v1/pacing/dashboards/:slug/third-party/data}.
	 *
	 * <p>Field for field. The rows stay opaque maps: they are ad-server columns that differ per
	 * report and the compare screens read them by name, so naming them here would mean this service
	 * holding an opinion about a file it does not produce.
	 *
	 * @param file the published CM360 file as Pacing wrote it
	 * @return the generated {@link PacingThirdPartyDataV1}
	 */
	public PacingThirdPartyDataV1 toV1(PacingThirdPartyData file) {
		return new PacingThirdPartyDataV1()
				.fetchedAt(file.fetchedAt())
				.campaigns(file.campaigns())
				.groups(file.groups())
				.status(file.status())
				.droppedDupes(file.droppedDupes())
				.rowCount(file.rowCount())
				.rows(file.rows());
	}

	/**
	 * Builds the body of {@code GET /api/v1/pacing/dashboards/:slug/third-party/campaigns}.
	 *
	 * @param campaigns the picker list as Pacing returned it
	 * @return the generated {@link PacingThirdPartyCampaignsV1}
	 */
	public PacingThirdPartyCampaignsV1 toV1(PacingThirdPartyCampaigns campaigns) {
		List<PacingThirdPartyCampaign> list = campaigns.campaigns() == null
				? List.of()
				: campaigns.campaigns();
		return new PacingThirdPartyCampaignsV1()
				.campaigns(list.stream().map(this::toV1).toList())
				.stale(campaigns.stale());
	}

	/**
	 * What a probed spreadsheet holds.
	 *
	 * <p>`ok` becomes `readable` on the way out: callers of this contract ask "can I use this file",
	 * and a field named for the answer is harder to read backwards than one named for the call.
	 *
	 * @param probe the probe as Pacing answered it
	 * @return the generated {@link PacingSheetProbeV1}
	 */
	public PacingSheetProbeV1 toV1(PacingSheetProbe probe) {
		List<PacingSheetTab> tabs = probe.tabs() == null ? List.of() : probe.tabs();
		return new PacingSheetProbeV1()
				.readable(probe.ok())
				.spreadsheetId(probe.spreadsheetId() == null ? "" : probe.spreadsheetId())
				.title(probe.title())
				.shareWith(probe.shareWith())
				.error(probe.error())
				.tabs(tabs.stream().map(this::toV1).toList());
	}

	/**
	 * One tab of a probed spreadsheet.
	 *
	 * <p>Sample cells keep their JSON TYPES, and that is load-bearing rather than tidy. The settings
	 * screen decides whether a column can take the Date role by what the sample holds: a real date
	 * arrives from the spreadsheet as a serial NUMBER (46170 is 2026-05-28) and reads as a date,
	 * while the same value as a STRING is taken for text that merely looks numeric - which is
	 * exactly what "46170 is text, not a date cell" means on that screen. Flattening the sample to
	 * text here made every date column unusable and blocked the save behind it. {@code grid} is the
	 * stringified twin and stays that way: it is for showing the top of the tab, not for judging it.
	 *
	 * @param tab the tab as Pacing described it
	 * @return the generated {@link PacingSheetTabV1}
	 */
	public PacingSheetTabV1 toV1(PacingSheetTab tab) {
		List<List<Object>> sample = tab.sample() == null ? List.of() : tab.sample();
		return new PacingSheetTabV1()
				.sheetId(tab.sheetId())
				.title(tab.title())
				.rowCount(tab.rowCount())
				.colCount(tab.colCount())
				.headerRow(tab.headerRow())
				.headers(tab.headers() == null ? List.of() : tab.headers())
				.sample(sample)
				.grid(tab.grid() == null ? List.of() : tab.grid());
	}

	/**
	 * The distinct values of the columns a mapping asked about.
	 *
	 * @param values the values as Pacing listed them
	 * @return the generated {@link PacingDimSourceValuesV1}
	 */
	public PacingDimSourceValuesV1 toV1(PacingDimSourceValues values) {
		List<PacingDimSourceValue> rows = values.values() == null ? List.of() : values.values();
		return new PacingDimSourceValuesV1()
				.columns(values.columns() == null ? List.of() : values.columns())
				.values(rows.stream().map(this::toV1).toList())
				.truncated(values.truncated())
				.scannedRows(values.scannedRows());
	}

	/**
	 * One distinct value and its row count.
	 *
	 * @param value the value as Pacing listed it
	 * @return the generated {@link PacingDimSourceValueV1}
	 */
	public PacingDimSourceValueV1 toV1(PacingDimSourceValue value) {
		return new PacingDimSourceValueV1()
				.values(value.values() == null ? List.of() : value.values())
				.rows(value.rows());
	}

	/**
	 * A proposal for part of a source's mapping.
	 *
	 * @param suggestions the proposal as Pacing answered it
	 * @return the generated {@link PacingDimSourceSuggestionsV1}
	 */
	public PacingDimSourceSuggestionsV1 toV1(PacingDimSourceSuggestions suggestions) {
		List<PacingDimSourceBinding> bindings =
				suggestions.bindings() == null ? List.of() : suggestions.bindings();
		List<PacingDimSourceGroup> groups = suggestions.groups() == null ? List.of() : suggestions.groups();
		return new PacingDimSourceSuggestionsV1()
				.available(suggestions.available())
				.notice(suggestions.notice())
				.bindings(bindings.stream().map(this::toV1).toList())
				.members(suggestions.members() == null ? List.of() : suggestions.members())
				.groups(groups.stream().map(this::toV1).toList())
				.considered(suggestions.considered());
	}

	/**
	 * One proposed route from a sheet name to a line item.
	 *
	 * @param binding the route as Pacing proposed it
	 * @return the generated {@link PacingDimSourceBindingV1}
	 */
	public PacingDimSourceBindingV1 toV1(PacingDimSourceBinding binding) {
		return new PacingDimSourceBindingV1()
				.value(binding.value())
				.lineItemId(binding.lineItemId());
	}

	/**
	 * One proposed grouping.
	 *
	 * @param group the grouping as Pacing proposed it
	 * @return the generated {@link PacingDimSourceGroupV1}
	 */
	public PacingDimSourceGroupV1 toV1(PacingDimSourceGroup group) {
		return new PacingDimSourceGroupV1()
				.label(group.label())
				.members(group.members() == null ? List.of() : group.members());
	}

	/**
	 * What a re-read of a sheet source produced.
	 *
	 * @param read the outcome as Pacing reported it
	 * @return the generated {@link PacingDimSourceReadV1}
	 */
	public PacingDimSourceReadV1 toV1(PacingDimSourceRead read) {
		return new PacingDimSourceReadV1()
				.sourceId(read.sourceId())
				.rows(read.rows())
				.unboundRows(read.unboundRows())
				.unparsedCells(read.unparsedCells())
				.bytes(read.bytes())
				.coverageHint(read.coverageHint());
	}

	/**
	 * A mapping suggestion set.
	 *
	 * <p>A null dimension list becomes an empty one: the contract makes the field required, and
	 * "nothing proposed" is a real answer the caller must be able to read without a null check. The
	 * notice rides through as-is - it is the only thing a caller can show when the list is empty.
	 *
	 * @param suggestions the proposal as Pacing returned it
	 * @return the generated {@link PacingMappingSuggestionsV1}
	 */
	public PacingMappingSuggestionsV1 toV1(PacingMappingSuggestions suggestions) {
		List<PacingMappingSuggestedDimension> dims = suggestions.dimensions() == null
				? List.of()
				: suggestions.dimensions();
		return new PacingMappingSuggestionsV1()
				.dimensions(dims.stream().map(this::toV1).toList())
				.notice(suggestions.notice());
	}

	/**
	 * One proposed dimension.
	 *
	 * @param dimension the dimension as Pacing proposed it
	 * @return the generated {@link PacingMappingSuggestedDimensionV1}
	 */
	public PacingMappingSuggestedDimensionV1 toV1(PacingMappingSuggestedDimension dimension) {
		List<PacingMappingSuggestedValue> values = dimension.values() == null
				? List.of()
				: dimension.values();
		return new PacingMappingSuggestedDimensionV1()
				.name(dimension.name())
				.values(values.stream().map(this::toV1).toList());
	}

	/**
	 * One proposed value.
	 *
	 * @param value the value as Pacing proposed it
	 * @return the generated {@link PacingMappingSuggestedValueV1}
	 */
	public PacingMappingSuggestedValueV1 toV1(PacingMappingSuggestedValue value) {
		return new PacingMappingSuggestedValueV1()
				.value(value.value())
				.aliases(value.aliases() == null ? List.of() : value.aliases());
	}

	/**
	 * One campaign of the picker list.
	 *
	 * @param campaign the campaign as Pacing returned it
	 * @return the generated {@link PacingThirdPartyCampaignV1}
	 */
	public PacingThirdPartyCampaignV1 toV1(PacingThirdPartyCampaign campaign) {
		return new PacingThirdPartyCampaignV1()
				// The name is NOT normalised: a saved source stores this exact string, and the picker's
				// display transform is lossy, so what round-trips has to be the untouched spelling.
				.name(campaign.name())
				.report(campaign.report())
				.lastSeen(campaign.lastSeen())
				.imp(campaign.imp());
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
				// An answer from a Pacing that predates the column carries none: it is shared.
				.visibility(PacingLibraryVisibilityV1.fromValue(
						entry.visibility() == null ? "team" : entry.visibility()))
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
