package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignRefV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingListResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRowV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingScopeV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffCountsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffSummaryV1;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlert;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignRef;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingHealth;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffCounts;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffSummary;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRow;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.instancio.Select.field;

/**
 * Unit tests for {@link PacingContractMapper}.
 */
class PacingContractMapperTest {

	private final PacingContractMapper mapper = new PacingContractMapper(new PacingNsDiffContractMapper());

	@Test
	void shouldBuildAssertionFromUserAndEntitlementTest() {
		// Given:
		CurrentUserModel user = Instancio.of(CurrentUserModel.class)
				.set(field(CurrentUserModel::email), "acting-user@aidigital.com")
				.create();
		PacingEntitlement entitlement =
				new PacingEntitlement(PacingScope.owners(List.of("a@x.com", "b@x.com")), true);

		// When:
		HubAssertion assertion = mapper.toAssertion(user, entitlement);

		// Then:
		assertThat(assertion.email()).isEqualTo("acting-user@aidigital.com");
		assertThat(assertion.scopeKind()).isEqualTo(PacingScope.KIND_OWNERS);
		assertThat(assertion.scopeIds()).containsExactly("a@x.com", "b@x.com");
		assertThat(assertion.canCreate()).isTrue();
	}

	@Test
	void shouldMapFullRowWithCampaignsHealthAndAlertsTest() {
		// Given: a fully populated row - the shape a Live pacing with delivery data actually has.
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), false);
		PacingRow row = new PacingRow(
				"p1", "Nike SS26 Display", "Live", "2026-08-01", "2026-09-30", "Azat Nabiev", 3,
				List.of(new PacingCampaignRef("CAMP-NIKE", "Nike SS26", "Daria Feofanova"),
						new PacingCampaignRef("CAMP-OTHER", "Other", null)),
				new PacingHealth("over", 12.3, 18.5, 25.0, 50000.0,
						List.of(new PacingAlert("pacing_off_pace", "critical", "Pacing +48.4pp", null, null, null, null))),
				"nike-ss26-display", "2026-07-15T09:30:00.000Z",
				// §13: the nightly ns-diff summary rides along on the row, mapped straight through by
				// the dedicated PacingNsDiffContractMapper this class delegates to.
				new PacingNsDiffSummary(
						new PacingNsDiffCounts(0, 1, 2, 0, 0, 1), false, "2026-09-21T02:30:00.000Z"));

		// When:
		PacingListResponseV1 response = mapper.toV1(entitlement, List.of(row));

		// Then:
		assertThat(response.getPacings()).hasSize(1);
		PacingRowV1 v1 = response.getPacings().get(0);
		assertThat(v1.getId()).isEqualTo("p1");
		assertThat(v1.getName()).isEqualTo("Nike SS26 Display");
		assertThat(v1.getStatus()).isEqualTo(PacingRowV1.StatusEnum.LIVE);
		assertThat(v1.getOwnerName()).isEqualTo("Azat Nabiev");
		assertThat(v1.getFlightStart()).isEqualTo(LocalDate.of(2026, 8, 1));
		assertThat(v1.getFlightEnd()).isEqualTo(LocalDate.of(2026, 9, 30));
		assertThat(v1.getLineItemCount()).isEqualTo(3);
		assertThat(v1.getCreatedAt()).isEqualTo(LocalDateTime.of(2026, 7, 15, 9, 30, 0));
		// §11: the NetSuite team lead rides along so the Overview can show it beside the
		// pacing's own owner without a second call, and stays null where NetSuite names none.
		assertThat(v1.getCampaigns()).containsExactly(
				new CampaignRefV1().id("CAMP-NIKE").name("Nike SS26").mpoTeamLead("Daria Feofanova"),
				new CampaignRefV1().id("CAMP-OTHER").name("Other").mpoTeamLead(null));
		assertThat(v1.getMarginActualPct()).isEqualTo(18.5);
		assertThat(v1.getMarginTargetPct()).isEqualTo(25.0);
		assertThat(v1.getPacingDeviationPct()).isEqualTo(12.3);
		assertThat(v1.getBudgetTotal()).isEqualTo(50000.0);
		assertThat(v1.getPaceStatus()).isEqualTo(PacingRowV1.PaceStatusEnum.OVER);
		assertThat(v1.getAlerts()).containsExactly(
				new PacingAlertV1().type("pacing_off_pace").severity(PacingAlertV1.SeverityEnum.CRITICAL).text("Pacing +48.4pp"));
		// §13, US-136: the nightly ns-diff summary is mapped straight through.
		assertThat(v1.getNsDiffSummary()).isEqualTo(
				new PacingNsDiffSummaryV1()
						.counts(new PacingNsDiffCountsV1()
								.missingInNetsuite(0).missingInPacing(1).fieldDiff(2).planDiff(0).foreignCampaign(0).ownerDiff(1))
						.inSync(false)
						.computedAt(LocalDateTime.of(2026, 9, 21, 2, 30, 0)));
	}

	@Test
	void shouldMapNoDataRowWithNullHealthAndCampaignsTest() {
		// Given: a fresh pacing with no line items yet and campaigns not yet resolved - the row must
		// degrade to nulls/empties, not throw, and still round-trip its own scalar fields.
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), false);
		PacingRow row =
				new PacingRow("p2", "Fresh Pacing", "Live", null, null, "Bob Petrov", 0, null, null, null, null, null);

		// When:
		PacingRowV1 v1 = mapper.toV1(entitlement, List.of(row)).getPacings().get(0);

		// Then:
		assertThat(v1.getFlightStart()).isNull();
		assertThat(v1.getFlightEnd()).isNull();
		assertThat(v1.getCampaigns()).isNull();
		assertThat(v1.getMarginActualPct()).isNull();
		assertThat(v1.getPaceStatus()).isNull();
		assertThat(v1.getAlerts()).isEmpty();
		// §13: absent when the nightly job has never covered this pacing, not a default/empty summary.
		assertThat(v1.getNsDiffSummary()).isNull();
	}

	@Test
	void shouldDegradeAMalformedFlightDateToNullRatherThanThrowTest() {
		// Given:
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), false);
		PacingRow row =
				new PacingRow("p3", "Bad Dates", "Live", "not-a-date", "", "X", 1, null, null, null, null, null);

		// When:
		PacingRowV1 v1 = mapper.toV1(entitlement, List.of(row)).getPacings().get(0);

		// Then:
		assertThat(v1.getFlightStart()).isNull();
		assertThat(v1.getFlightEnd()).isNull();
	}

	@Test
	void shouldDegradeAMalformedCreatedAtToNullRatherThanThrowTest() {
		// Given: same degrade-to-null contract as the flight dates above, for the same reason - a
		// malformed value from an external service should not fail the whole row.
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), false);
		PacingRow row = new PacingRow(
				"p4", "Bad Created At", "Live", null, null, "X", 1, null, null, null, "not-a-timestamp", null);

		// When:
		PacingRowV1 v1 = mapper.toV1(entitlement, List.of(row)).getPacings().get(0);

		// Then:
		assertThat(v1.getCreatedAt()).isNull();
	}

	@Test
	void shouldBuildResponseWithScopeAndEmptyPacingsTest() {
		// Given:
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), false);

		// When:
		PacingListResponseV1 response = mapper.toV1(entitlement, List.of());

		// Then:
		assertThat(response.getPacings()).isEmpty();
		PacingScopeV1 scope = response.getScope();
		assertThat(scope.getKind()).isEqualTo(PacingScopeV1.KindEnum.ALL);
		assertThat(scope.getIds()).isEmpty();
		assertThat(scope.getCanCreate()).isFalse();
	}

	@Test
	void shouldMapOwnersScopeKindTest() {
		// Given:
		PacingEntitlement entitlement =
				new PacingEntitlement(PacingScope.owners(List.of("a@x.com")), true);

		// When:
		PacingListResponseV1 response = mapper.toV1(entitlement, List.of());

		// Then:
		assertThat(response.getScope().getKind()).isEqualTo(PacingScopeV1.KindEnum.OWNERS);
		assertThat(response.getScope().getIds()).containsExactly("a@x.com");
		assertThat(response.getScope().getCanCreate()).isTrue();
	}
}
