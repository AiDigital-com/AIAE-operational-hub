package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Response of {@code GET /api/dashboards/:slug/addable-line-items} (§9 of the migration plan, US-126):
 * this pacing's own campaign(s)' line items not already on it, fetched live from NetSuite the same way
 * §8's create-draft validate is. {@code addable} entries are the exact same wire shape §8's validate
 * response carries under {@code line_items} - {@link PacingValidateLineItem} deserializes both.
 *
 * @param ok           false when Pacing can read the campaign's line items but will not let them be
 *                     paced as they stand today (currently: more than one non-USD currency among
 *                     them) - {@code error} names why; a normal "nothing to add" answers
 *                     {@code true} with an empty {@code addable}
 * @param error        why {@code ok} is false; null when {@code ok} is true
 * @param io           serialized as {@code io}; the insertion order number candidates were looked up
 *                     from; null when this pacing has no stored insertion order (add-by-id is then the
 *                     only option)
 * @param orders       every distinct order number searched, for a pacing spanning more than one order
 * @param addable      the campaign's line items not yet on this pacing
 * @param alreadyAdded serialized as {@code already_added}; ids of this campaign's line items already
 *                     on the pacing (informational)
 * @param client       advertiser/client name, as NetSuite reports it on these line items
 * @param agency       agency name, as NetSuite reports it on these line items
 * @param warnings     human-readable data-quality notes
 * @param notFoundIds  serialized as {@code notFoundIds}; ids with no NetSuite row
 */
public record PacingAddableLineItems(
		boolean ok,
		String error,
		String io,
		List<String> orders,
		List<PacingValidateLineItem> addable,
		@JsonProperty("already_added") List<String> alreadyAdded,
		String client,
		String agency,
		List<String> warnings,
		List<String> notFoundIds) {
}
