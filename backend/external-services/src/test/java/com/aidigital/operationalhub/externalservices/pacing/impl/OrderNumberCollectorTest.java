package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateLineItem;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link OrderNumberCollector} - the ordering/dedup rule behind the
 * {@code insertion_order_id}/{@code order_numbers} pair on create.
 */
class OrderNumberCollectorTest {

	private final OrderNumberCollector collector = new OrderNumberCollector();

	private PacingCreateLineItem lineItemWithOrder(String lineItemId, String orderNumber) {
		return new PacingCreateLineItem(
				lineItemId, "Display", "2026-03-01", "2026-03-31", "CPM", null, 1000.0, "USD", 1.0,
				"40539", "2026_Campaign", orderNumber, null, 100000.0, 15.5, null, null, null, null, null, null);
	}

	@Test
	void shouldReturnTheSingleNumberOnceWhenEveryLineItemSharesItTest() {
		// Given: the common case - one insertion order behind every line item
		List<PacingCreateLineItem> lineItems = List.of(
				lineItemWithOrder("111", "TM-271064"),
				lineItemWithOrder("222", "TM-271064"),
				lineItemWithOrder("333", "TM-271064"));

		// When:
		List<String> result = collector.collect(lineItems);

		// Then:
		assertThat(result).containsExactly("TM-271064");
	}

	@Test
	void shouldKeepFirstAppearanceOrderAndCollapseDuplicatesTest() {
		// Given: a multi-IO campaign, the first order repeated after the second appears
		List<PacingCreateLineItem> lineItems = List.of(
				lineItemWithOrder("111", "TM-271064"),
				lineItemWithOrder("222", "TM-282075"),
				lineItemWithOrder("333", "TM-271064"),
				lineItemWithOrder("444", "TM-293086"));

		// When:
		List<String> result = collector.collect(lineItems);

		// Then: distinct, and in the order a reader of the line items would meet them
		assertThat(result).containsExactly("TM-271064", "TM-282075", "TM-293086");
	}

	@Test
	void shouldReturnAnEmptyListWhenNoLineItemCarriesANumberTest() {
		// Given: null and blank order numbers only - both mean "no number", never an entry
		List<PacingCreateLineItem> lineItems = List.of(
				lineItemWithOrder("111", null),
				lineItemWithOrder("222", ""),
				lineItemWithOrder("333", "   "));

		// When:
		List<String> result = collector.collect(lineItems);

		// Then:
		assertThat(result).isEmpty();
	}

	@Test
	void shouldPassSpacedAndDashedNumbersThroughVerbatimTest() {
		// Given: the NetSuite spelling that a private sanitizer once destroyed - it must survive
		// exactly as stored, spaces and all; Pacing's own shared gate is the only validator
		List<PacingCreateLineItem> lineItems = List.of(lineItemWithOrder("111", "SY-Bretts RV-0426"));

		// When:
		List<String> result = collector.collect(lineItems);

		// Then: byte-for-byte what the line item carried
		assertThat(result).containsExactly("SY-Bretts RV-0426");
	}
}
