package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignRefV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAlertV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDelegationRefV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingKpiTargetV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLineItemHealthV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingListResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRowV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingScopeV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffCountsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffSummaryV1;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlert;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignRef;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDelegationRef;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingHealth;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingKpiTarget;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLineItemHealth;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffCounts;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffSummary;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRecentDay;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRow;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

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
				"p1", "Nike SS26 Display", "Live", "2026-08-01", "2026-09-30", "Azat Nabiev",
				"11111111-2222-3333-4444-555555555555", 3, "Nike", "Initiative",
				List.of(new PacingCampaignRef("310739", "Nike SS26", "Daria Feofanova"),
						new PacingCampaignRef("CAMP-OTHER", "Other", null)),
				new PacingHealth("over", 12.3, 18.5, 25.0, 50000.0, 3, 14, true, "in_period", "Sep 2026",
						List.of(),
						List.of(new PacingAlert("pacing_off_pace", "critical", "Pacing +48.4pp", null, null, null, null))),
				"nike-ss26-display", "2026-07-15T09:30:00.000Z",
				List.of(new PacingDelegationRef("Bob Petrov", "2026-10-15")),
				new PacingDelegationRef("Daria Feofanova", "2026-10-01"),
				Map.of("599888", "Prospecting"), Map.of("599888", "NW | Native Display"),
				// §13: the nightly ns-diff summary rides along on the row, mapped straight through by
				// the dedicated PacingNsDiffContractMapper this class delegates to.
				new PacingNsDiffSummary(
						new PacingNsDiffCounts(0, 1, 2, 0, 0, 1), false, "2026-09-21T02:30:00.000Z"));
		// Hub-resolved campaign identities: 310739 answers, CAMP-OTHER does not.
		Map<Long, CampaignModel> campaignsById = Map.of(
				310739L,
				new CampaignModel(310739L, "Nike SS26", 7L, "Nike Inc", 42L, "Initiative Media",
						null, null, null, null, null, null, null));

		// When:
		PacingListResponseV1 response = mapper.toV1(entitlement, List.of(row), campaignsById);

		// Then:
		assertThat(response.getPacings()).hasSize(1);
		PacingRowV1 v1 = response.getPacings().get(0);
		assertThat(v1.getId()).isEqualTo("p1");
		assertThat(v1.getName()).isEqualTo("Nike SS26 Display");
		assertThat(v1.getStatus()).isEqualTo(PacingRowV1.StatusEnum.LIVE);
		assertThat(v1.getOwnerName()).isEqualTo("Azat Nabiev");
		assertThat(v1.getOwnerId()).isEqualTo("11111111-2222-3333-4444-555555555555");
		assertThat(v1.getClient()).isEqualTo("Nike");
		assertThat(v1.getAgency()).isEqualTo("Initiative");
		assertThat(v1.getFlightStart()).isEqualTo(LocalDate.of(2026, 8, 1));
		assertThat(v1.getFlightEnd()).isEqualTo(LocalDate.of(2026, 9, 30));
		assertThat(v1.getLineItemCount()).isEqualTo(3);
		assertThat(v1.getCreatedAt()).isEqualTo(LocalDateTime.of(2026, 7, 15, 9, 30, 0));
		// §11: the NetSuite team lead rides along so the Overview can show it beside the
		// pacing's own owner without a second call, and stays null where NetSuite names none.
		// The agency/client trio is the Hub's own enrichment: attached where the bulk lookup
		// answered, left absent (never invented) where it did not.
		assertThat(v1.getCampaigns()).containsExactly(
				new CampaignRefV1().id("310739").name("Nike SS26").mpoTeamLead("Daria Feofanova")
						.agencyId(42L).agencyName("Initiative Media").clientName("Nike Inc"),
				new CampaignRefV1().id("CAMP-OTHER").name("Other").mpoTeamLead(null));
		assertThat(v1.getMarginActualPct()).isEqualTo(18.5);
		assertThat(v1.getMarginTargetPct()).isEqualTo(25.0);
		assertThat(v1.getPacingDeviationPct()).isEqualTo(12.3);
		assertThat(v1.getBudgetTotal()).isEqualTo(50000.0);
		assertThat(v1.getPaceStatus()).isEqualTo(PacingRowV1.PaceStatusEnum.OVER);
		// Health extras for the owner-grouped Overview: LI count, countdown, period-scope badge.
		assertThat(v1.getLiCount()).isEqualTo(3);
		assertThat(v1.getDaysRemaining()).isEqualTo(14);
		assertThat(v1.getPeriodScope()).isTrue();
		assertThat(v1.getPeriodScopeState()).isEqualTo("in_period");
		assertThat(v1.getPeriodLabel()).isEqualTo("Sep 2026");
		assertThat(v1.getLineItems()).isEmpty();
		// §12: delegation decoration - who this row went to, who it came from.
		assertThat(v1.getDelegatedTo()).containsExactly(
				new PacingDelegationRefV1().name("Bob Petrov").expiresAt(LocalDate.of(2026, 10, 15)));
		assertThat(v1.getDelegatedFrom())
				.isEqualTo(new PacingDelegationRefV1().name("Daria Feofanova").expiresAt(LocalDate.of(2026, 10, 1)));
		// Per-LI display labels for the expanded rows.
		assertThat(v1.getLiNames()).containsEntry("599888", "Prospecting");
		assertThat(v1.getLiDesc()).containsEntry("599888", "NW | Native Display");
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
	void shouldMapLineItemHealthWithRecentDaysAndKpisTest() {
		// Given: one line item with a recent day and a KPI target - the expanded Overview row's data.
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), false);
		PacingRecentDay day = new PacingRecentDay(
				"2026-09-28", 1000.0, 12.5, 10.0, 5.0, 1.0, 0.5, 12.5, 10.0, 900.0,
				"CPM", 1000.0, 900.0, 950.0, 12.5, 10.0);
		PacingLineItemHealth li = new PacingLineItemHealth(
				"599888", "Display", "CPM", "2026-08-01", "2026-09-30", 5000.0,
				22.5, 25.0, -7.2, false, false,
				List.of(day), List.of(new PacingKpiTarget("CTR", 0.12, 0.7, 2.0)));
		PacingRow row = new PacingRow(
				"p1", "X", "Live", null, null, null, null, 1, null, null, null,
				new PacingHealth("under", -7.2, 22.5, 25.0, 5000.0, 1, 2, null, null, null, List.of(li), List.of()),
				null, null, null, null, null, null, null);

		// When:
		PacingRowV1 v1 = mapper.toV1(entitlement, List.of(row)).getPacings().get(0);

		// Then: the whole breakdown is passed through - nothing recomputed, nothing dropped.
		assertThat(v1.getLineItems()).containsExactly(
				new PacingLineItemHealthV1()
						.lineItemId("599888").channel("Display").rateType("CPM")
						.flightStart(LocalDate.of(2026, 8, 1)).flightEnd(LocalDate.of(2026, 9, 30))
						.budget(5000.0).marginActualPct(22.5).marginTargetPct(25.0)
						.pacingIndex(-7.2).isPaused(false).costCoef(false)
						.recent(List.of(new com.aidigital.operationalhub.application.api.v1.generated.model.PacingRecentDayV1()
								.date(LocalDate.of(2026, 9, 28))
								.impr(1000.0).spend(12.5).clicks(10.0).completes(5.0)
								.ctr(1.0).vcr(0.5).cpm(12.5).tgtCpm(10.0).tgtImpr(900.0)
								.rateType("CPM").units(1000.0).tgtUnits(900.0).tgtUnitsReforecast(950.0)
								.rate(12.5).tgtRate(10.0)))
						.kpis(List.of(new PacingKpiTargetV1().type("CTR").tgt(0.12).low(0.7).high(2.0))));
	}

	@Test
	void shouldMapNoDataRowWithNullHealthAndCampaignsTest() {
		// Given: a fresh pacing with no line items yet and campaigns not yet resolved - the row must
		// degrade to nulls/empties, not throw, and still round-trip its own scalar fields.
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), false);
		PacingRow row = new PacingRow(
				"p2", "Fresh Pacing", "Live", null, null, "Bob Petrov", null, 0, null, null, null, null,
				null, null, null, null, null, null, null);

		// When:
		PacingRowV1 v1 = mapper.toV1(entitlement, List.of(row)).getPacings().get(0);

		// Then:
		assertThat(v1.getFlightStart()).isNull();
		assertThat(v1.getFlightEnd()).isNull();
		assertThat(v1.getCampaigns()).isNull();
		assertThat(v1.getMarginActualPct()).isNull();
		assertThat(v1.getPaceStatus()).isNull();
		assertThat(v1.getAlerts()).isEmpty();
		assertThat(v1.getOwnerId()).isNull();
		assertThat(v1.getLiCount()).isNull();
		assertThat(v1.getDaysRemaining()).isNull();
		assertThat(v1.getLineItems()).isNull();
		assertThat(v1.getDelegatedFrom()).isNull();
		assertThat(v1.getDelegatedTo()).isNull();
		// §13: absent when the nightly job has never covered this pacing, not a default/empty summary.
		assertThat(v1.getNsDiffSummary()).isNull();
	}

	@Test
	void shouldDegradeAMalformedFlightDateToNullRatherThanThrowTest() {
		// Given:
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), false);
		PacingRow row = new PacingRow(
				"p3", "Bad Dates", "Live", "not-a-date", "", "X", null, 1, null, null, null, null,
				null, null, null, null, null, null, null);

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
				"p4", "Bad Created At", "Live", null, null, "X", null, 1, null, null, null, null,
				null, "not-a-timestamp", null, null, null, null, null);

		// When:
		PacingRowV1 v1 = mapper.toV1(entitlement, List.of(row)).getPacings().get(0);

		// Then:
		assertThat(v1.getCreatedAt()).isNull();
	}

	@Test
	void shouldParseCampaignIdLeniencyTest() {
		// Then: numeric ids (Pacing serializes NetSuite ids as strings) parse; anything else resolves
		// to null so the enrichment lookup simply misses rather than throwing.
		assertThat(mapper.parseCampaignId("310739")).isEqualTo(310739L);
		assertThat(mapper.parseCampaignId(" 310739 ")).isEqualTo(310739L);
		assertThat(mapper.parseCampaignId("CAMP-NIKE")).isNull();
		assertThat(mapper.parseCampaignId("")).isNull();
		assertThat(mapper.parseCampaignId(null)).isNull();
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
