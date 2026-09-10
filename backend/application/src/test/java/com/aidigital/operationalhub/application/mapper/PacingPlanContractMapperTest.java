package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAddableLineItemsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDraftLineItemV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLineItemPlanUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingPlanUpdateV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAddableLineItems;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLineItemPlanUpdate;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingValidateLineItem;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link PacingPlanContractMapper} (§9 of the migration plan, US-125/126/127).
 *
 * <p>{@link #shouldForwardContainersOpaquelyTest} exists specifically to prove the mapper opens no
 * single container object - it forwards the whole array byte-for-byte, exactly as
 * {@link PacingCreateContractMapper}'s own tests pin verbatim copying elsewhere in the same feature.
 */
class PacingPlanContractMapperTest {

	private final PacingCreateContractMapper createMapper = new PacingCreateContractMapper();
	private final PacingPlanContractMapper mapper = new PacingPlanContractMapper(createMapper);

	@Test
	void shouldMapEveryEditableFieldVerbatimTest() {
		// Given: a straight field copy/rename, same discipline as PacingCreateContractMapper - nothing
		// here is summed, prorated or computed.
		PacingLineItemPlanUpdateV1 li = new PacingLineItemPlanUpdateV1()
				.lineItemId("599852")
				.channel("DOOH")
				.description("Northeast | DOOH")
				.campaignId("40539")
				.campaignName("2026_Campaign")
				.orderNumber("TM-271064")
				.rateType("CPM")
				.nativeBudget(20633.4)
				.targetImpressions(1432875.0)
				.marginTargetPct(15.5)
				.targetCtr(0.85)
				.targetVcr(null)
				.flightStart(LocalDate.of(2026, 3, 1))
				.flightEnd(LocalDate.of(2026, 3, 31));
		PacingPlanUpdateV1 body = new PacingPlanUpdateV1().lineItems(List.of(li));

		// When:
		List<PacingLineItemPlanUpdate> result = mapper.toPlanUpdateLineItems(body);

		// Then:
		assertThat(result).hasSize(1);
		PacingLineItemPlanUpdate mapped = result.get(0);
		assertThat(mapped.lineItemId()).isEqualTo("599852");
		assertThat(mapped.channel()).isEqualTo("DOOH");
		assertThat(mapped.description()).isEqualTo("Northeast | DOOH");
		assertThat(mapped.campaignId()).isEqualTo("40539");
		assertThat(mapped.campaignName()).isEqualTo("2026_Campaign");
		assertThat(mapped.orderNumber()).isEqualTo("TM-271064");
		assertThat(mapped.rateType()).isEqualTo("CPM");
		assertThat(mapped.nativeBudget()).isEqualTo(20633.4);
		assertThat(mapped.targetImpressions()).isEqualTo(1432875.0);
		// marginTargetPct on the wire -> marginPercent internally - a rename, not a computation.
		assertThat(mapped.marginPercent()).isEqualTo(15.5);
		assertThat(mapped.targetCtr()).isEqualTo(0.85);
		assertThat(mapped.targetVcr()).isNull();
		assertThat(mapped.flightStart()).isEqualTo("2026-03-01");
		assertThat(mapped.flightEnd()).isEqualTo("2026-03-31");
	}

	@Test
	void shouldForwardContainersOpaquelyTest() {
		// Given: a container carrying the duplicate-action transport fields (Pacing's own existing
		// mechanism) - the mapper must not touch a single key inside it.
		Map<String, Object> container = Map.of(
				"id", "c2", "name", "February 2026 (copy)", "target_impressions", 110000,
				"__action", "duplicate", "__source_id", "c1", "__scale", 1.1);
		PacingLineItemPlanUpdateV1 li = new PacingLineItemPlanUpdateV1()
				.lineItemId("599852")
				.containers(List.of(container));
		PacingPlanUpdateV1 body = new PacingPlanUpdateV1().lineItems(List.of(li));

		// When:
		List<PacingLineItemPlanUpdate> result = mapper.toPlanUpdateLineItems(body);

		// Then: the exact same map instance/content, untouched.
		assertThat(result.get(0).containers()).containsExactly(container);
	}

	@Test
	void shouldMapAddableLineItemsReusingDraftLineItemMappingTest() {
		// Given: `addable` entries are the same wire shape §8's draft line items already map - this
		// mapper must not re-derive that mapping.
		PacingValidateLineItem candidate = new PacingValidateLineItem(
				"7", "Display", "2026-01-01", "2026-01-31", "CPM", null, 5000.0, 5000.0, 250000.0,
				"USD", 1.0, false, "40539", "2026_Campaign", "TM-271064", null, null);
		PacingAddableLineItems result = new PacingAddableLineItems(
				true, null, "TM-271064", List.of("TM-271064"), List.of(candidate), List.of("599852"),
				"Acme", "MediaCo", List.of(), List.of());

		// When:
		PacingAddableLineItemsV1 v1 = mapper.toAddableLineItemsV1(result);

		// Then:
		assertThat(v1.getOk()).isTrue();
		assertThat(v1.getIo()).isEqualTo("TM-271064");
		assertThat(v1.getAddable()).hasSize(1);
		PacingDraftLineItemV1 mappedCandidate = v1.getAddable().get(0);
		assertThat(mappedCandidate.getLineItemId()).isEqualTo("7");
		assertThat(mappedCandidate.getCampaignId()).isEqualTo("40539");
		assertThat(v1.getAlreadyAdded()).containsExactly("599852");
		assertThat(v1.getClient()).isEqualTo("Acme");
	}

	@Test
	void shouldMapAddableLineItemsOkFalseWithoutThrowingTest() {
		// Given: mixed-currency-style ok:false - the same shape §8's draft carries when Pacing will not
		// let a campaign be paced as-is.
		PacingAddableLineItems result =
				new PacingAddableLineItems(false, "Mixed currencies", null, null, null, null, null, null, null, null);

		// When:
		PacingAddableLineItemsV1 v1 = mapper.toAddableLineItemsV1(result);

		// Then:
		assertThat(v1.getOk()).isFalse();
		assertThat(v1.getError()).isEqualTo("Mixed currencies");
		assertThat(v1.getAddable()).isEmpty();
		assertThat(v1.getAlreadyAdded()).isEmpty();
	}
}
