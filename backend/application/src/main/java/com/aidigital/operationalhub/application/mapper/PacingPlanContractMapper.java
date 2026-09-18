package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAddableLineItemsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDraftLineItemV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLineItemPlanUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingPlanUpdateV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAddableLineItems;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLineItemPlanUpdate;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;

/**
 * Bridges Pacing's plan-save/addable-line-items wire shapes and the generated
 * {@code POST /api/v1/pacing/dashboards/{slug}/plan} and
 * {@code GET /api/v1/pacing/dashboards/{slug}/addable-line-items} contracts (§9 of the migration plan,
 * US-125/126/127).
 *
 * <p>Every mapping here is a straight field copy or rename, same discipline as
 * {@link PacingCreateContractMapper}: nothing is summed, prorated or otherwise computed. In
 * particular {@code containers} is forwarded as the opaque {@code List<Map<String, Object>>} the
 * caller sent - this mapper does not open a single container object, since that shape is Pacing's own
 * to parse and validate (container existence, the target-impressions bound against the line item's
 * plan).
 */
@Component
@RequiredArgsConstructor
public class PacingPlanContractMapper {

	private final PacingCreateContractMapper createMapper;

	/**
	 * Converts a full plan save's line items into the external-services shape the Pacing client sends
	 * on - a straight field copy per entry.
	 *
	 * @param body the plan save request
	 * @return the line items to persist, in the same order
	 */
	public List<PacingLineItemPlanUpdate> toPlanUpdateLineItems(PacingPlanUpdateV1 body) {
		return body.getLineItems().stream().map(this::toPlanUpdateLineItem).toList();
	}

	private PacingLineItemPlanUpdate toPlanUpdateLineItem(PacingLineItemPlanUpdateV1 li) {
		return new PacingLineItemPlanUpdate(
				li.getLineItemId(),
				li.getChannel(),
				li.getDescription(),
				li.getCampaignId(),
				li.getCampaignName(),
				li.getOrderNumber(),
				li.getRateType(),
				li.getNativeBudget(),
				li.getTargetImpressions(),
				li.getMarginTargetPct(),
				li.getTargetCtr(),
				li.getTargetVcr(),
				formatDate(li.getFlightStart()),
				formatDate(li.getFlightEnd()),
				li.getContainers());
	}

	/**
	 * Builds the {@code GET /api/v1/pacing/dashboards/{slug}/addable-line-items} response from Pacing's
	 * addable-line-items result. {@code addable} entries reuse
	 * {@link PacingCreateContractMapper#toDraftLineItemV1} verbatim - same wire shape §8's draft line
	 * items already map.
	 *
	 * @param result Pacing's addable-line-items result
	 * @return the generated {@link PacingAddableLineItemsV1}
	 */
	public PacingAddableLineItemsV1 toAddableLineItemsV1(PacingAddableLineItems result) {
		List<PacingDraftLineItemV1> addable = result.addable() == null
				? List.of()
				: result.addable().stream().map(createMapper::toDraftLineItemV1).toList();
		return new PacingAddableLineItemsV1()
				.ok(result.ok())
				.error(result.error())
				.io(result.io())
				.orders(result.orders())
				.addable(addable)
				.alreadyAdded(result.alreadyAdded() == null ? List.of() : result.alreadyAdded())
				.client(result.client())
				.agency(result.agency())
				.warnings(result.warnings())
				.notFoundIds(result.notFoundIds());
	}

	/**
	 * Formats a {@link LocalDate} back to Pacing's {@code YYYY-MM-DD} wire format; null stays null -
	 * same rule as {@link PacingCreateContractMapper#formatDate}, duplicated here rather than shared
	 * because that one is private and this mapper has no other reason to depend on that class's
	 * internals beyond {@code toDraftLineItemV1} above.
	 *
	 * @param value the date, or null
	 * @return the formatted date string, or null
	 */
	private String formatDate(LocalDate value) {
		return value == null ? null : value.toString();
	}
}
