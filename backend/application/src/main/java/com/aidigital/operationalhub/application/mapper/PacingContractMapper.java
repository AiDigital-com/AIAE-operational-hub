package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignRefV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingListResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRowV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingScopeV1;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlert;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignRef;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingHealth;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRow;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;

/**
 * Bridges the service-layer {@link PacingEntitlement} (RBAC domain) and the Pacing HTTP client's
 * transport-level {@link HubAssertion} to the generated {@code /api/v1/pacing/pacings} contract.
 */
@Component
public class PacingContractMapper {

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
	 * Pacing returned.
	 *
	 * @param entitlement the resolved Pacing entitlement (surfaced back so a caller can see why)
	 * @param pacings     the pacings Pacing returned
	 * @return the generated {@link PacingListResponseV1}, shaped for the Overview screen (§4)
	 */
	public PacingListResponseV1 toV1(PacingEntitlement entitlement, List<PacingRow> pacings) {
		List<PacingRowV1> rows = pacings.stream().map(this::toRowV1).toList();
		return new PacingListResponseV1().scope(toScopeV1(entitlement)).pacings(rows);
	}

	private PacingScopeV1 toScopeV1(PacingEntitlement entitlement) {
		PacingScope scope = entitlement.scope();
		return new PacingScopeV1()
				.kind(PacingScopeV1.KindEnum.fromValue(scope.kind()))
				.ids(scope.ids())
				.canCreate(entitlement.canCreate());
	}

	private PacingRowV1 toRowV1(PacingRow row) {
		PacingHealth health = row.health();
		PacingRowV1 v1 = new PacingRowV1()
				.id(row.pacingId())
				.dashSlug(row.dashSlug())
				.name(row.pacingName())
				.status(row.status() == null ? null : PacingRowV1.StatusEnum.fromValue(row.status()))
				.ownerName(row.ownerName())
				.flightStart(parseDate(row.flightStart()))
				.flightEnd(parseDate(row.flightEnd()))
				.lineItemCount(row.lineItemCount() == null ? 0 : row.lineItemCount())
				.createdAt(parseDateTime(row.createdAt()))
				.campaigns(toCampaignRefsV1(row.campaigns()))
				.alerts(health == null || health.alerts() == null
						? List.of()
						: health.alerts().stream().map(this::toAlertV1).toList());
		if (health != null) {
			v1.marginActualPct(health.marginActual())
					.marginTargetPct(health.marginTarget())
					.pacingDeviationPct(health.pacingPp())
					.budgetTotal(health.budgetTotal())
					.paceStatus(health.status() == null ? null : PacingRowV1.PaceStatusEnum.fromValue(health.status()));
		}
		return v1;
	}

	private List<CampaignRefV1> toCampaignRefsV1(List<PacingCampaignRef> refs) {
		return refs == null ? null : refs.stream().map(this::toCampaignRefV1).toList();
	}

	private CampaignRefV1 toCampaignRefV1(PacingCampaignRef ref) {
		return new CampaignRefV1().id(ref.id()).name(ref.name());
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
