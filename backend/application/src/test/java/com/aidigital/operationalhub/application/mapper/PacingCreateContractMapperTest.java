package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCreateLineItemV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCreateResultV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDraftLineItemV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDraftV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingInUseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingInsertionOrderV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateLineItem;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingInUseEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingInsertionOrder;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingKpiSource;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingMrgSource;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingValidateLineItem;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingValidateResult;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link PacingCreateContractMapper} (§8 of the migration plan, US-121/122/123/124).
 *
 * <p>The tests pinning {@link #shouldPreFillTargetImpressionsVerbatimFromPlannedUnitsTest} and
 * {@link #shouldUnwrapMarginAndKpiSourcesVerbatimTest} exist specifically to prove the mapper does not
 * compute any of these figures - it only copies/renames/unwraps them.
 */
class PacingCreateContractMapperTest {

	private final PacingCreateContractMapper mapper = new PacingCreateContractMapper();

	private PacingValidateLineItem aLineItem() {
		return new PacingValidateLineItem(
				"599852", "DOOH", "2026-03-01", "2026-03-31", "CPM", "Northeast | DOOH TM271064#13",
				20633.4, 20633.4, 1432875.0, "USD", 1.0, false,
				"40539", "2026_Service-Experts_Q1-Media_Southwest", "TM-271064", "Daria Feofanova",
				new PacingMrgSource(15.5), new PacingKpiSource(0.85, null, "tactic"));
	}

	@Test
	void shouldPreFillTargetImpressionsVerbatimFromPlannedUnitsTest() {
		// Given: planned_units (NetSuite's reference figure) and target_impressions (the plan value)
		// are different fields by design - the mapper's whole job for US-124 is copying one into the
		// other, not computing anything.
		PacingValidateResult result = new PacingValidateResult(
				true, null, List.of(aLineItem()), List.of(), "Acme", "MediaCo", "2026_Service-Experts_Q1-Media_Southwest",
				"TM-271064", List.of("TM-271064"), List.of(), List.of(), Map.of());

		// When:
		PacingDraftV1 draft = mapper.toDraftV1(result);

		// Then:
		PacingDraftLineItemV1 li = draft.getLineItems().get(0);
		assertThat(li.getPlannedUnits()).isEqualTo(1432875.0);
		assertThat(li.getTargetImpressions()).isEqualTo(1432875.0);
	}

	@Test
	void shouldUnwrapMarginAndKpiSourcesVerbatimTest() {
		// Given:
		PacingValidateResult result = new PacingValidateResult(
				true, null, List.of(aLineItem()), List.of(), "Acme", "MediaCo", "Campaign",
				"TM-271064", List.of("TM-271064"), List.of(), List.of(), Map.of());

		// When:
		PacingDraftLineItemV1 li = mapper.toDraftV1(result).getLineItems().get(0);

		// Then:
		assertThat(li.getMarginPercent()).isEqualTo(15.5);
		assertThat(li.getTargetCtr()).isEqualTo(0.85);
		assertThat(li.getTargetVcr()).isNull();
	}

	@Test
	void shouldDegradeNullMrgAndKpiSourceToNullPlanValuesTest() {
		// Given: the local database's reference tables are empty, so mrg_source/kpi_source arrive with
		// a null value rather than being absent - and can also legitimately be absent entirely.
		PacingValidateLineItem li = new PacingValidateLineItem(
				"1", "Display", "2026-01-01", "2026-01-31", "CPM", "desc", 100.0, 100.0, 1000.0,
				"USD", 1.0, false, "1", "Campaign", "TM-1", null, new PacingMrgSource(null), null);
		PacingValidateResult result = new PacingValidateResult(
				true, null, List.of(li), List.of(), null, null, null, null, List.of(), List.of(), List.of(), Map.of());

		// When:
		PacingDraftLineItemV1 v1 = mapper.toDraftV1(result).getLineItems().get(0);

		// Then:
		assertThat(v1.getMarginPercent()).isNull();
		assertThat(v1.getTargetCtr()).isNull();
		assertThat(v1.getTargetVcr()).isNull();
	}

	@Test
	void shouldMapFieldsVerbatimIncludingDatesAndCurrencyTest() {
		// Given:
		PacingValidateResult result = new PacingValidateResult(
				true, null, List.of(aLineItem()), List.of(), "Acme", "MediaCo", "Campaign",
				"TM-271064", List.of("TM-271064"), List.of(), List.of(), Map.of());

		// When:
		PacingDraftLineItemV1 li = mapper.toDraftV1(result).getLineItems().get(0);

		// Then:
		assertThat(li.getLineItemId()).isEqualTo("599852");
		assertThat(li.getChannel()).isEqualTo("DOOH");
		assertThat(li.getFlightStart()).isEqualTo(LocalDate.of(2026, 3, 1));
		assertThat(li.getFlightEnd()).isEqualTo(LocalDate.of(2026, 3, 31));
		assertThat(li.getRateType()).isEqualTo("CPM");
		assertThat(li.getNativeBudget()).isEqualTo(20633.4);
		assertThat(li.getBudgetTotal()).isEqualTo(20633.4);
		assertThat(li.getCurrency()).isEqualTo("USD");
		assertThat(li.getConverted()).isFalse();
		assertThat(li.getCampaignId()).isEqualTo("40539");
		assertThat(li.getOrderNumber()).isEqualTo("TM-271064");
	}

	@Test
	void shouldCarryNetSuiteTeamLeadFromValidateThroughToCreateTest() {
		// Given: NetSuite's own answer to who runs this campaign, on the validated line item.
		PacingValidateResult result = new PacingValidateResult(
				true, null, List.of(aLineItem()), List.of(), "Acme", "MediaCo", "Campaign",
				"TM-271064", List.of("TM-271064"), List.of(), List.of(), Map.of());

		// When: it goes out to the create form and comes straight back in the create request.
		PacingDraftLineItemV1 draftLineItem = mapper.toDraftV1(result).getLineItems().get(0);
		PacingCreateLineItem submitted = mapper.toCreateLineItem(
				new PacingCreateLineItemV1().lineItemId("599852").mpoTeamLead(draftLineItem.getMpoTeamLead()));

		// Then: both legs carry it. Without this the new pacing stores no NetSuite lead, so §11's
		// owner-vs-NetSuite comparison is blank on it until the nightly refresh or a manual
		// revalidate fills it in - which is exactly the wait this carry exists to remove.
		assertThat(draftLineItem.getMpoTeamLead()).isEqualTo("Daria Feofanova");
		assertThat(submitted.mpoTeamLead()).isEqualTo("Daria Feofanova");
	}

	@Test
	void shouldMapTopLevelFieldsAndWarningsTest() {
		// Given:
		PacingValidateResult result = new PacingValidateResult(
				true, null, List.of(), List.of(), "Acme", "MediaCo", "2026_Campaign",
				"TM-1", List.of("TM-1", "TM-2"), List.of("904"), List.of("Client mismatch across LIs"),
				Map.of());

		// When:
		PacingDraftV1 draft = mapper.toDraftV1(result);

		// Then:
		assertThat(draft.getOk()).isTrue();
		assertThat(draft.getClient()).isEqualTo("Acme");
		assertThat(draft.getAgency()).isEqualTo("MediaCo");
		assertThat(draft.getCampaign()).isEqualTo("2026_Campaign");
		assertThat(draft.getOrderNumber()).isEqualTo("TM-1");
		assertThat(draft.getOrderNumbers()).containsExactly("TM-1", "TM-2");
		assertThat(draft.getNotFoundIds()).containsExactly("904");
		assertThat(draft.getWarnings()).containsExactly("Client mismatch across LIs");
	}

	@Test
	void shouldMapOkFalseWithErrorAndNoLineItemsTest() {
		// Given: a normal 200 outcome (not thrown) for a campaign Pacing will not let be paced as-is.
		PacingValidateResult result = new PacingValidateResult(
				false, "Mixed currencies across line items (CAD, EUR). A pacing must have one currency.",
				List.of(aLineItem()), List.of(), "Acme", "MediaCo", "Campaign", null, List.of(), List.of(), List.of(), Map.of());

		// When:
		PacingDraftV1 draft = mapper.toDraftV1(result);

		// Then:
		assertThat(draft.getOk()).isFalse();
		assertThat(draft.getError()).contains("Mixed currencies");
		assertThat(draft.getLineItems()).hasSize(1);
	}

	@Test
	void shouldMapInUseEntriesKeyedByLineItemIdTest() {
		// Given:
		Map<String, PacingInUseEntry> inUse =
				Map.of("599852", new PacingInUseEntry("p1", "Existing Pacing", "existing-pacing", "Live"));
		PacingValidateResult result = new PacingValidateResult(
				true, null, List.of(aLineItem()), List.of(), "Acme", "MediaCo", "Campaign", "TM-1", List.of(),
				List.of(), List.of(), inUse);

		// When:
		PacingDraftV1 draft = mapper.toDraftV1(result);

		// Then:
		assertThat(draft.getInUse()).containsKey("599852");
		PacingInUseV1 marked = draft.getInUse().get("599852");
		assertThat(marked.getPacingId()).isEqualTo("p1");
		assertThat(marked.getPacingName()).isEqualTo("Existing Pacing");
		assertThat(marked.getDashSlug()).isEqualTo("existing-pacing");
		assertThat(marked.getStatus()).isEqualTo("Live");
	}

	@Test
	void shouldDegradeNullInUseToEmptyMapTest() {
		// Given: the in-use lookup was skipped or failed on the Pacing side.
		PacingValidateResult result = new PacingValidateResult(
				true, null, List.of(), List.of(), null, null, null, null, List.of(), List.of(), List.of(), null);

		// When / Then:
		assertThat(mapper.toDraftV1(result).getInUse()).isEmpty();
	}

	@Test
	void shouldConvertRequestLineItemToExternalServicesInputVerbatimTest() {
		// Given: a caller-confirmed line item, including plan edits.
		PacingCreateLineItemV1 request = new PacingCreateLineItemV1()
				.lineItemId("599852")
				.channel("DOOH")
				.flightStart(LocalDate.of(2026, 3, 1))
				.flightEnd(LocalDate.of(2026, 3, 31))
				.rateType("CPM")
				.description("Northeast | DOOH TM271064#13")
				.nativeBudget(21000.0)
				.currency("USD")
				.exchangeRate(1.0)
				.campaignId("40539")
				.campaignName("2026_Service-Experts_Q1-Media_Southwest")
				.orderNumber("TM-271064")
				.targetImpressions(1500000.0)
				.marginPercent(18.0)
				.targetCtr(0.9)
				.targetVcr(null);

		// When:
		PacingCreateLineItem li = mapper.toCreateLineItem(request);

		// Then: every field forwarded exactly - the edited budget/impressions/margin/CTR are NOT the
		// same as the draft's pre-filled values above, proving nothing here recomputes them.
		assertThat(li.lineItemId()).isEqualTo("599852");
		assertThat(li.flightStart()).isEqualTo("2026-03-01");
		assertThat(li.flightEnd()).isEqualTo("2026-03-31");
		assertThat(li.nativeBudget()).isEqualTo(21000.0);
		assertThat(li.targetImpressions()).isEqualTo(1500000.0);
		assertThat(li.marginPercent()).isEqualTo(18.0);
		assertThat(li.targetCtr()).isEqualTo(0.9);
		assertThat(li.targetVcr()).isNull();
		assertThat(li.campaignId()).isEqualTo("40539");
		assertThat(li.orderNumber()).isEqualTo("TM-271064");
	}

	@Test
	void shouldMapInsertionOrdersVerbatimTest() {
		// Given: §8 (US-122) - one insertion order verbatim (real order fields, not summed from LIs).
		PacingInsertionOrder order = new PacingInsertionOrder(
				"48000", "TM-271064", null, 250000.0, "2026-01-01", "2026-03-31", "Active");
		PacingValidateResult result = new PacingValidateResult(
				true, null, List.of(aLineItem()), List.of(order), "Acme", "MediaCo", "Campaign",
				"TM-271064", List.of("TM-271064"), List.of(), List.of(), Map.of());

		// When:
		PacingDraftV1 draft = mapper.toDraftV1(result);

		// Then:
		assertThat(draft.getInsertionOrders()).hasSize(1);
		PacingInsertionOrderV1 v1 = draft.getInsertionOrders().get(0);
		assertThat(v1.getOrderId()).isEqualTo("48000");
		assertThat(v1.getOrderNumber()).isEqualTo("TM-271064");
		assertThat(v1.getOrderName()).isNull();
		assertThat(v1.getOrderBudget()).isEqualTo(250000.0);
		assertThat(v1.getOrderStartDate()).isEqualTo(LocalDate.of(2026, 1, 1));
		assertThat(v1.getOrderEndDate()).isEqualTo(LocalDate.of(2026, 3, 31));
		assertThat(v1.getOrderStatus()).isEqualTo("Active");
	}

	@Test
	void shouldDegradeNullInsertionOrdersToEmptyListTest() {
		// Given:
		PacingValidateResult result = new PacingValidateResult(
				true, null, List.of(), null, null, null, null, null, List.of(), List.of(), List.of(), Map.of());

		// When / Then:
		assertThat(mapper.toDraftV1(result).getInsertionOrders()).isEmpty();
	}

	@Test
	void shouldMapCreateResultTest() {
		// Given:
		PacingCreateResult result = new PacingCreateResult("p9", "acme-q1");

		// When:
		PacingCreateResultV1 v1 = mapper.toCreateResultV1(result);

		// Then:
		assertThat(v1.getPacingId()).isEqualTo("p9");
		assertThat(v1.getDashSlug()).isEqualTo("acme-q1");
	}
}
