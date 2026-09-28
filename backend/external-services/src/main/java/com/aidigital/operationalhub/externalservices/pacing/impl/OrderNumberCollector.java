package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateLineItem;

import java.util.ArrayList;
import java.util.List;

/**
 * Collects the distinct insertion-order numbers a create request's line items carry, for the
 * {@code insertion_order_id}/{@code order_numbers} pair on {@code POST /api/pacings}.
 *
 * <p>Exists because a pacing created through the Hub never got an IO number at all: the retired
 * SPA's create form sent {@code insertion_order_id} (always, when a validated number existed) and
 * {@code order_numbers} (only for a multi-IO campaign), while the Hub's {@link CreateRequest} sent
 * neither - so {@code config_json.insertion_order_id} stayed unset and the dashboard's
 * "IO number" row never appeared. The numbers were in the request all along, one per line item
 * ({@link PacingCreateLineItem#orderNumber()}, canonical NetSuite spelling straight from the
 * validate/draft flow); this collaborator only gathers them.
 *
 * <p>Numbers pass through VERBATIM: no trimming, no re-casing, no charset filtering. Pacing's
 * create route runs its own shared order-number gate, and a private copy of that gate on this
 * side is exactly the mistake that once dropped every spaced NetSuite number
 * ("SY-Bretts RV-0426") - see the warning beside {@code order_numbers} in Pacing's
 * {@code api-routes.mjs}.
 *
 * <p>A separate collaborator rather than a method on the client, so the ordering/dedup rule is
 * unit-testable without an HTTP transport (repository rule: non-trivial logic lives in a
 * collaborator, never a private bean method).
 */
public class OrderNumberCollector {

	/**
	 * Every distinct non-blank order number across the line items, in order of first appearance.
	 * The caller maps the result onto the wire pair: first entry as {@code insertion_order_id}
	 * whenever the list is non-empty, the whole list as {@code order_numbers} only when it holds
	 * more than one.
	 *
	 * @param lineItems the line items the pacing is created from
	 * @return the distinct order numbers, verbatim and in first-appearance order; empty when no
	 *         line item carries one
	 */
	public List<String> collect(List<PacingCreateLineItem> lineItems) {
		List<String> numbers = new ArrayList<>();
		for (PacingCreateLineItem lineItem : lineItems) {
			String orderNumber = lineItem.orderNumber();
			if (orderNumber != null && !orderNumber.isBlank() && !numbers.contains(orderNumber)) {
				numbers.add(orderNumber);
			}
		}
		return numbers;
	}
}
