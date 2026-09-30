package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignRefV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDelegationRefV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingKpiTargetV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLineItemHealthV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingListResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRecentDayV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRowV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingScopeV1;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlert;
import com.aidigital.operationalhub.application.api.v1.generated.model.AssignableOwnerListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AssignableOwnerV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignRef;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDelegationRef;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingKpiTarget;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLineItemHealth;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRecentDay;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.rbac.model.AssignableOwner;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingHealth;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRow;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * Bridges the service-layer {@link PacingEntitlement} (RBAC domain) and the Pacing HTTP client's
 * transport-level {@link HubAssertion} to the generated {@code /api/v1/pacing/pacings} contract.
 */
@Component
@RequiredArgsConstructor
public class PacingContractMapper {

	private final PacingNsDiffContractMapper nsDiffMapper;

	/**
	 * Builds the transport-level assertion request the Pacing client signs and sends.
	 *
	 * @param user        the current user, for the asserted email
	 * @param entitlement the resolved Pacing entitlement
	 * @return the assertion to sign
	 */
	public HubAssertion toAssertion(CurrentUserModel user, PacingEntitlement entitlement) {
		PacingScope scope = entitlement.scope();
		return new HubAssertion(user.email(), scope.kind(), scope.ids(), entitlement.canCreate());
	}

	/**
	 * Builds the {@code GET /api/v1/pacing/pacings} response from the resolved entitlement and the rows
	 * Pacing returned, without any Hub-side campaign enrichment — the campaign-tab list (§5) uses
	 * this: its rows are already scoped to one campaign the caller opened, so resolving agencies
	 * again would buy nothing.
	 *
	 * @param entitlement the resolved Pacing entitlement (surfaced back so a caller can see why)
	 * @param pacings     the pacings Pacing returned
	 * @return the generated {@link PacingListResponseV1}
	 */
	public PacingListResponseV1 toV1(PacingEntitlement entitlement, List<PacingRow> pacings) {
		return toV1(entitlement, pacings, Map.of());
	}

	/**
	 * Builds the {@code GET /api/v1/pacing/pacings} response, attaching the Hub-resolved agency and
	 * client to every campaign reference the given map can answer for — what the Overview's agency
	 * filter runs on. A campaign absent from the map (unknown id, or outside the caller's agency
	 * visibility) maps with those fields absent, never invented.
	 *
	 * @param entitlement   the resolved Pacing entitlement (surfaced back so a caller can see why)
	 * @param pacings       the pacings Pacing returned
	 * @param campaignsById the Hub's own campaigns by NetSuite campaign id, resolved in one bulk
	 *                      lookup by the controller; may be empty
	 * @return the generated {@link PacingListResponseV1}, shaped for the Overview screen (§4)
	 */
	public PacingListResponseV1 toV1(
			PacingEntitlement entitlement, List<PacingRow> pacings, Map<Long, CampaignModel> campaignsById) {
		List<PacingRowV1> rows = pacings.stream().map(row -> toRowV1(row, campaignsById)).toList();
		return new PacingListResponseV1().scope(toScopeV1(entitlement)).pacings(rows);
	}

	/**
	 * Maps the resolved entitlement onto the contract's scope shape.
	 *
	 * @param entitlement the resolved Pacing entitlement
	 * @return the contract shape
	 */
	PacingScopeV1 toScopeV1(PacingEntitlement entitlement) {
		PacingScope scope = entitlement.scope();
		return new PacingScopeV1()
				.kind(PacingScopeV1.KindEnum.fromValue(scope.kind()))
				.ids(scope.ids())
				.canCreate(entitlement.canCreate());
	}

	/**
	 * Maps one pacing row onto the contract, flattening the health object's row-level figures and
	 * carrying the per-line-item breakdown through for the Overview's expanded rows.
	 *
	 * @param row           the row from Pacing
	 * @param campaignsById the Hub's own campaigns by id, for agency/client enrichment; may be empty
	 * @return the contract shape
	 */
	PacingRowV1 toRowV1(PacingRow row, Map<Long, CampaignModel> campaignsById) {
		PacingHealth health = row.health();
		PacingRowV1 v1 = new PacingRowV1()
				.id(row.pacingId())
				.dashSlug(row.dashSlug())
				.name(row.pacingName())
				.status(row.status() == null ? null : PacingRowV1.StatusEnum.fromValue(row.status()))
				.ownerName(row.ownerName())
				.ownerId(row.ownerId())
				.client(row.client())
				.agency(row.agency())
				.delegatedFrom(toDelegationRefV1(row.delegatedFrom()))
				.delegatedTo(row.delegatedTo() == null
						? null
						: row.delegatedTo().stream().map(this::toDelegationRefV1).toList())
				.flightStart(parseDate(row.flightStart()))
				.flightEnd(parseDate(row.flightEnd()))
				.lineItemCount(row.lineItemCount() == null ? 0 : row.lineItemCount())
				.createdAt(parseDateTime(row.createdAt()))
				.campaigns(toCampaignRefsV1(row.campaigns(), campaignsById))
				// Explicitly null (not left at the generated model's default empty list) when health
				// was not computed: "no breakdown" and "a breakdown of zero line items" must stay
				// distinguishable on the wire.
				.lineItems(health == null || health.lineItems() == null
						? null
						: health.lineItems().stream().map(this::toLineItemHealthV1).toList())
				.liNames(row.liNames())
				.liDesc(row.liDesc())
				.alerts(health == null || health.alerts() == null
						? List.of()
						: health.alerts().stream().map(this::toAlertV1).toList())
				.nsDiffSummary(nsDiffMapper.toNsDiffSummaryV1(row.nsDiffSummary()));
		if (health != null) {
			v1.marginActualPct(health.marginActual())
					.marginTargetPct(health.marginTarget())
					.pacingDeviationPct(health.pacingPp())
					.budgetTotal(health.budgetTotal())
					.liCount(health.liCount())
					.daysRemaining(health.daysRemaining())
					.periodScope(health.periodScope())
					.periodScopeState(health.periodScopeState())
					.periodLabel(health.periodLabel())
					.paceStatus(health.status() == null ? null : PacingRowV1.PaceStatusEnum.fromValue(health.status()));
		}
		return v1;
	}

	/**
	 * Maps a row's campaign references, enriching each with the Hub-resolved agency/client where the
	 * bulk lookup answered.
	 *
	 * @param refs          the campaign references from Pacing; null when resolution never ran
	 * @param campaignsById the Hub's own campaigns by id; may be empty
	 * @return the contract shapes, or null when {@code refs} is null
	 */
	List<CampaignRefV1> toCampaignRefsV1(List<PacingCampaignRef> refs, Map<Long, CampaignModel> campaignsById) {
		return refs == null ? null : refs.stream().map(ref -> toCampaignRefV1(ref, campaignsById)).toList();
	}

	/**
	 * Maps one campaign reference onto the contract, including the NetSuite team lead (§11, US-132)
	 * that the Overview shows beside the pacing's own owner. Passed through as Pacing sent it: the
	 * comparison between the two is a name match this side must not second-guess by normalising,
	 * trimming or case-folding - a lead whose name carries a diacritic would stop matching the
	 * person it names.
	 *
	 * <p>The agency/client trio is the one Hub-side addition: Pacing's campaign ids are NetSuite
	 * campaign ids — the same id space as the Hub's own campaigns — so a resolved campaign brings its
	 * agency id (what the Overview's agency filter selects by), its agency name and its client name.
	 * An unresolved id leaves all three absent.
	 *
	 * @param ref           the campaign reference from Pacing
	 * @param campaignsById the Hub's own campaigns by id; may be empty
	 * @return the contract shape
	 */
	CampaignRefV1 toCampaignRefV1(PacingCampaignRef ref, Map<Long, CampaignModel> campaignsById) {
		CampaignRefV1 v1 = new CampaignRefV1().id(ref.id()).name(ref.name()).mpoTeamLead(ref.mpoTeamLead());
		Long campaignId = parseCampaignId(ref.id());
		// The null check matters beyond readability: Map.of()-built maps throw on get(null).
		CampaignModel campaign = campaignId == null ? null : campaignsById.get(campaignId);
		if (campaign != null) {
			v1.agencyId(campaign.agencyId()).agencyName(campaign.agencyName()).clientName(campaign.clientName());
		}
		return v1;
	}

	/**
	 * Parses a Pacing campaign id — a NetSuite campaign id serialized as a string — for the bulk-map
	 * lookup. Null for a non-numeric id, which then simply resolves to nothing.
	 *
	 * @param id the campaign id string from Pacing, or null
	 * @return the numeric id, or null when it is not one
	 */
	public Long parseCampaignId(String id) {
		if (id == null || id.isBlank()) {
			return null;
		}
		try {
			return Long.parseLong(id.trim());
		} catch (NumberFormatException ex) {
			return null;
		}
	}

	/**
	 * Maps one delegation decoration onto the contract.
	 *
	 * @param ref the delegation reference from Pacing, or null
	 * @return the contract shape, or null when {@code ref} is null
	 */
	PacingDelegationRefV1 toDelegationRefV1(PacingDelegationRef ref) {
		return ref == null ? null : new PacingDelegationRefV1().name(ref.name()).expiresAt(parseDate(ref.expiresAt()));
	}

	/**
	 * Maps one line item's health entry onto the contract — the Overview's expanded row. The recent
	 * days and KPI targets are passed through untouched: the heatmap/sparkline figures were computed
	 * by Pacing's own engine, and the Hub recomputes none of them.
	 *
	 * @param li the line item health entry from Pacing
	 * @return the contract shape
	 */
	PacingLineItemHealthV1 toLineItemHealthV1(PacingLineItemHealth li) {
		return new PacingLineItemHealthV1()
				.lineItemId(li.lineItemId())
				.channel(li.channel())
				.rateType(li.rateType())
				.flightStart(parseDate(li.flightStart()))
				.flightEnd(parseDate(li.flightEnd()))
				.budget(li.budget())
				.marginActualPct(li.marginActualPct())
				.marginTargetPct(li.marginTargetPct())
				.pacingIndex(li.pacingIndex())
				.isPaused(li.isPaused())
				.costCoef(li.costCoef())
				.recent(li.recent() == null ? null : li.recent().stream().map(this::toRecentDayV1).toList())
				.kpis(li.kpis() == null ? null : li.kpis().stream().map(this::toKpiTargetV1).toList());
	}

	/**
	 * Maps one recent delivery day onto the contract, verbatim.
	 *
	 * @param day the day from Pacing
	 * @return the contract shape
	 */
	PacingRecentDayV1 toRecentDayV1(PacingRecentDay day) {
		return new PacingRecentDayV1()
				.date(parseDate(day.date()))
				.impr(day.impr())
				.spend(day.spend())
				.clicks(day.clicks())
				.completes(day.completes())
				.ctr(day.ctr())
				.vcr(day.vcr())
				.cpm(day.cpm())
				.tgtCpm(day.tgtCpm())
				.tgtImpr(day.tgtImpr())
				.rateType(day.rateType())
				.units(day.units())
				.tgtUnits(day.tgtUnits())
				.tgtUnitsReforecast(day.tgtUnitsReforecast())
				.rate(day.rate())
				.tgtRate(day.tgtRate());
	}

	/**
	 * Maps one KPI target onto the contract, verbatim.
	 *
	 * @param kpi the KPI target from Pacing
	 * @return the contract shape
	 */
	PacingKpiTargetV1 toKpiTargetV1(PacingKpiTarget kpi) {
		return new PacingKpiTargetV1().type(kpi.type()).tgt(kpi.tgt()).low(kpi.low()).high(kpi.high());
	}

	/**
	 * Maps the assignable owners onto the contract (§11, US-131).
	 *
	 * @param owners the people the caller may hand a pacing to
	 * @return the contract shape, owners already sorted by the service
	 */
	public AssignableOwnerListV1 toAssignableOwnerListV1(List<AssignableOwner> owners) {
		return new AssignableOwnerListV1().owners(owners.stream().map(this::toAssignableOwnerV1).toList());
	}

	/**
	 * Maps one assignable owner onto the contract.
	 *
	 * @param owner the person
	 * @return the contract shape
	 */
	AssignableOwnerV1 toAssignableOwnerV1(AssignableOwner owner) {
		return new AssignableOwnerV1()
				.pacingUserId(owner.pacingUserId())
				.name(owner.name())
				.email(owner.email());
	}

	private PacingAlertV1 toAlertV1(PacingAlert alert) {
		return new PacingAlertV1()
				.type(alert.type())
				.severity(alert.severity() == null ? null : PacingAlertV1.SeverityEnum.fromValue(alert.severity()))
				.text(alert.text())
				// value/label are Pacing's own split of the same alert into a number and a short
				// description. Passed through untouched: the per-detector formatting rules are
				// there, and re-deriving them here from `text` would be a second copy that drifts.
				.value(alert.value())
				.label(alert.label())
				.liId(alert.liId())
				.name(alert.name());
	}

	/**
	 * Parses a Pacing {@code YYYY-MM-DD} date string. Null/blank stays null (an unresolved flight
	 * date); a malformed value from an external service also degrades to null rather than failing the
	 * whole row.
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
		} catch (java.time.format.DateTimeParseException ex) {
			return null;
		}
	}

	/**
	 * Parses a Pacing {@code created_at} timestamp - an ISO-8601 instant string (e.g.
	 * {@code 2026-07-15T09:30:00.000Z}), unlike the plain {@code YYYY-MM-DD} flight dates
	 * {@link #parseDate} handles. Same degrade-to-null contract: a malformed value from an external
	 * service does not fail the whole row.
	 *
	 * @param value the raw timestamp string from Pacing, or null
	 * @return the parsed timestamp, or null if {@code value} is null/blank/malformed
	 */
	private java.time.LocalDateTime parseDateTime(String value) {
		if (value == null || value.isBlank()) {
			return null;
		}
		try {
			return java.time.OffsetDateTime.parse(value).toLocalDateTime();
		} catch (java.time.format.DateTimeParseException ex) {
			return null;
		}
	}
}
