package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCampaignLinkV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCreateDataV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCreateLineItemV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCreateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCreateResultV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDraftLineItemV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDraftV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingInUseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingInsertionOrderV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignLink;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateData;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateLineItem;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateOptions;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingInUseEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingInsertionOrder;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingKpiSource;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingMrgSource;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingValidateLineItem;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingValidateResult;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Bridges Pacing's validate/create wire shapes and the generated {@code /api/v1/campaigns/{id}
 * /pacing-draft} and {@code POST /api/v1/pacing/pacings} contracts (§8 of the migration plan,
 * US-121/122/123/124).
 *
 * <p>Every mapping here is a straight field copy or rename - never an arithmetic transform. In
 * particular {@link PacingDraftLineItemV1#getTargetImpressions()} is copied verbatim from
 * {@link PacingValidateLineItem#plannedUnits()} (US-124's pre-fill), and
 * {@link PacingDraftLineItemV1#getMarginPercent()}/{@code targetCtr}/{@code targetVcr} are unwrapped
 * verbatim from {@code mrg_source}/{@code kpi_source} - none of these is computed, summed or adjusted.
 */
@Component
public class PacingCreateContractMapper {

	/**
	 * Builds the {@code GET /api/v1/campaigns/{id}/pacing-draft} response from Pacing's validate
	 * result.
	 *
	 * @param result the validate result Pacing returned
	 * @return the generated {@link PacingDraftV1}
	 */
	public PacingDraftV1 toDraftV1(PacingValidateResult result) {
		List<PacingDraftLineItemV1> lineItems = result.lineItems() == null
				? List.of()
				: result.lineItems().stream().map(this::toDraftLineItemV1).toList();
		List<PacingInsertionOrderV1> insertionOrders = result.insertionOrders() == null
				? List.of()
				: result.insertionOrders().stream().map(this::toInsertionOrderV1).toList();
		return new PacingDraftV1()
				.ok(result.ok())
				.error(result.error())
				.client(result.client())
				.agency(result.agency())
				.campaign(result.campaign())
				.orderNumber(result.orderNumber())
				.orderNumbers(result.orderNumbers())
				.lineItems(lineItems)
				.insertionOrders(insertionOrders)
				.notFoundIds(result.notFoundIds())
				.warnings(result.warnings())
				.netHint(result.netHint() == null ? null
						: new com.aidigital.operationalhub.application.api.v1.generated.model.PacingNetHintV1()
								.count(result.netHint().count()))
				.inUse(toInUseV1(result.inUse()));
	}

	/**
	 * Maps one insertion order verbatim (§8, US-122) - a straight field copy/rename, same as
	 * {@link #toDraftLineItemV1}; nothing here sums, mins or maxes over the order's line items.
	 *
	 * @param order the insertion order Pacing returned
	 * @return the generated {@link PacingInsertionOrderV1}
	 */
	private PacingInsertionOrderV1 toInsertionOrderV1(PacingInsertionOrder order) {
		return new PacingInsertionOrderV1()
				.orderId(order.orderId())
				.orderNumber(order.orderNumber())
				.orderName(order.orderName())
				.orderBudget(order.orderBudget())
				.orderStartDate(parseDate(order.orderStartDate()))
				.orderEndDate(parseDate(order.orderEndDate()))
				.orderStatus(order.orderStatus());
	}

	/**
	 * Maps one NetSuite line item verbatim (§8/§9) - reused by {@code PacingPlanContractMapper} for
	 * US-126's two "add line item" candidate lists (the campaign-scoped picker and the by-id lookup),
	 * which are the exact same wire shape as this one's own draft line items.
	 *
	 * @param li the line item Pacing returned
	 * @return the generated {@link PacingDraftLineItemV1}
	 */
	public PacingDraftLineItemV1 toDraftLineItemV1(PacingValidateLineItem li) {
		PacingMrgSource mrg = li.mrgSource();
		PacingKpiSource kpi = li.kpiSource();
		return new PacingDraftLineItemV1()
				.lineItemId(li.lineItemId())
				.channel(li.channel())
				.flightStart(parseDate(li.flightStart()))
				.flightEnd(parseDate(li.flightEnd()))
				.rateType(li.rateType())
				.description(li.description())
				.nativeBudget(li.nativeBudget())
				.budgetTotal(li.budgetTotal())
				.currency(li.currency())
				.exchangeRate(li.exchangeRate())
				.converted(li.converted())
				.plannedUnits(li.plannedUnits())
				// US-124 pre-fill: target_impressions FROM planned_units, verbatim - a rename, not a
				// computation. The two stay distinct fields on the wire (plannedUnits is still carried
				// above) so the create form can show NetSuite's own reference figure alongside the
				// editable plan value it seeded, per the migration plan's explicit warning that these
				// must never be merged into one field.
				.targetImpressions(li.plannedUnits())
				.marginPercent(mrg == null ? null : mrg.value())
				.targetCtr(kpi == null ? null : kpi.ctr())
				.targetVcr(kpi == null ? null : kpi.vcr())
				.campaignId(li.campaignId())
				.campaignName(li.campaignName())
				.orderNumber(li.orderNumber())
				.mpoTeamLead(li.mpoTeamLead())
				.nsNetRatio(li.nsNetRatio());
	}

	private Map<String, PacingInUseV1> toInUseV1(Map<String, PacingInUseEntry> inUse) {
		if (inUse == null) {
			return Map.of();
		}
		return inUse.entrySet().stream().collect(Collectors.toMap(
				Map.Entry::getKey,
				entry -> {
					PacingInUseEntry value = entry.getValue();
					return new PacingInUseV1()
							.pacingId(value.pacingId())
							.pacingName(value.pacingName())
							.dashSlug(value.dashSlug())
							.status(value.status());
				}));
	}

	/**
	 * Converts one requested line item (already carrying the caller's plan edits) into the
	 * external-services input the Pacing client sends on - a straight field copy.
	 *
	 * @param li the requested line item
	 * @return the external-services line item to submit
	 */
	public PacingCreateLineItem toCreateLineItem(PacingCreateLineItemV1 li) {
		return new PacingCreateLineItem(
				li.getLineItemId(),
				li.getChannel(),
				formatDate(li.getFlightStart()),
				formatDate(li.getFlightEnd()),
				li.getRateType(),
				li.getDescription(),
				li.getNativeBudget(),
				li.getCurrency(),
				li.getExchangeRate(),
				li.getCampaignId(),
				li.getCampaignName(),
				li.getOrderNumber(),
				li.getMpoTeamLead(),
				li.getTargetImpressions(),
				li.getMarginPercent(),
				li.getTargetCtr(),
				li.getTargetVcr(),
				li.getCostCoef(),
				li.getNetRatio(),
				li.getNetRatioLocked(),
				li.getNsNetRatio());
	}

	/**
	 * Collects the optional create-time extras off the request body into the external-services input
	 * - a straight field copy/rename; nulls stay null (the Pacing client omits the matching wire keys,
	 * which is how an untouched setting stays untouched).
	 *
	 * @param body the create request
	 * @return the optional extras to submit alongside the line items
	 */
	public PacingCreateOptions toCreateOptions(PacingCreateV1 body) {
		// Empty lists become null: the generated model initializes an absent array property to an
		// empty list (the exact trap PacingDimSourcesV1's contract note documents), and a null here
		// is what makes the Pacing client OMIT the wire key - "no pinned order" / "no links" must
		// not travel as `[]`.
		return new PacingCreateOptions(
				emptyToNull(body.getCampaigns()),
				body.getClient(),
				body.getAgency(),
				toCreateData(body.getData()),
				body.getRate(),
				body.getRateLocked(),
				toCampaignLinks(emptyToNull(body.getCampaignLinks())),
				body.getCampaignNotes());
	}

	/**
	 * Degrades an absent-or-empty generated list to null, so the outbound NON_NULL body omits its key.
	 *
	 * @param list the generated model's list property
	 * @param <T>  the element type
	 * @return the list, or null when it is null or empty
	 */
	<T> List<T> emptyToNull(List<T> list) {
		return list == null || list.isEmpty() ? null : list;
	}

	/**
	 * Maps the create body's {@code data} namespace verbatim; the enum source becomes its wire string.
	 *
	 * @param data the request's data settings, or null when the caller sent none
	 * @return the external-services data settings, or null to omit the key
	 */
	PacingCreateData toCreateData(PacingCreateDataV1 data) {
		if (data == null) {
			return null;
		}
		return new PacingCreateData(
				data.getSource() == null ? null : data.getSource().getValue(),
				data.getFetchCreatives(),
				data.getFetchConversions(),
				data.getCoefEnabled(),
				data.getNetEnabled());
	}

	/**
	 * Maps the create body's campaign links verbatim (name/URL pairs, §16's create-time seed).
	 *
	 * @param links the request's links, or null when the caller sent none
	 * @return the external-services links, or null to omit the key
	 */
	List<PacingCampaignLink> toCampaignLinks(List<PacingCampaignLinkV1> links) {
		if (links == null) {
			return null;
		}
		return links.stream().map(link -> new PacingCampaignLink(link.getName(), link.getUrl())).toList();
	}

	/**
	 * Builds the {@code POST /api/v1/pacing/pacings} success response.
	 *
	 * @param result the new pacing's identifiers
	 * @return the generated {@link PacingCreateResultV1}
	 */
	public PacingCreateResultV1 toCreateResultV1(PacingCreateResult result) {
		return new PacingCreateResultV1().pacingId(result.pacingId()).dashSlug(result.dashSlug());
	}

	/**
	 * Parses a Pacing {@code YYYY-MM-DD} date string, same degrade-to-null rule as
	 * {@link PacingContractMapper#parseDate}.
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

	/**
	 * Formats a {@link LocalDate} back to Pacing's {@code YYYY-MM-DD} wire format; null stays null.
	 *
	 * @param value the date, or null
	 * @return the formatted date string, or null
	 */
	private String formatDate(LocalDate value) {
		return value == null ? null : value.toString();
	}
}
