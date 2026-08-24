package com.aidigital.operationalhub.application.mapper;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ColumnOrderArranger}.
 */
class ColumnOrderArrangerTest {

	private final ColumnOrderArranger arranger = new ColumnOrderArranger();

	@Test
	void shouldArrangeIncludedColumnsByColumnOrderTest() {
		// Given: an interleaved order - a metric ("impressions") sitting between two dimensions
		List<String> included = List.of("date", "line_item_id", "impressions", "spend");
		List<String> columnOrder = List.of("line_item_id", "impressions", "date", "spend");

		// When:
		List<String> arranged = arranger.arrange(included, columnOrder);

		// Then:
		assertThat(arranged).containsExactly("line_item_id", "impressions", "date", "spend");
	}

	@Test
	void shouldReturnIncludedUnchangedWhenColumnOrderIsNullTest() {
		// Given:
		List<String> included = List.of("date", "impressions", "spend");

		// When:
		List<String> arranged = arranger.arrange(included, null);

		// Then:
		assertThat(arranged).containsExactly("date", "impressions", "spend");
	}

	@Test
	void shouldReturnIncludedUnchangedWhenColumnOrderIsEmptyTest() {
		// Given:
		List<String> included = List.of("date", "impressions", "spend");

		// When:
		List<String> arranged = arranger.arrange(included, List.of());

		// Then:
		assertThat(arranged).containsExactly("date", "impressions", "spend");
	}

	@Test
	void shouldReturnAnImmutableListWhenColumnOrderIsEmptyTest() {
		// Given: a caller-supplied mutable list, so mutating it afterwards must not affect what was
		// already handed back
		List<String> included = new ArrayList<>(List.of("date", "impressions"));

		// When:
		List<String> arranged = arranger.arrange(included, List.of());
		included.add("spend");

		// Then: the returned list is unaffected by the later mutation of the input
		assertThat(arranged).containsExactly("date", "impressions");
	}

	@Test
	void shouldIgnoreAnIdInColumnOrderThatIsNotIncludedTest() {
		// Given: "clicks" is named in columnOrder but never included
		List<String> included = List.of("date", "impressions");
		List<String> columnOrder = List.of("clicks", "impressions", "date");

		// When:
		List<String> arranged = arranger.arrange(included, columnOrder);

		// Then: "clicks" never resurfaces
		assertThat(arranged).containsExactly("impressions", "date");
	}

	@Test
	void shouldAppendAnIncludedIdLeftOutOfColumnOrderAfterTheNamedOnesTest() {
		// Given: "spend" is included but never named in columnOrder
		List<String> included = List.of("date", "line_item_id", "impressions", "spend");
		List<String> columnOrder = List.of("line_item_id", "date", "impressions");

		// When:
		List<String> arranged = arranger.arrange(included, columnOrder);

		// Then: "spend" lands after the named ones, in its own default relative place
		assertThat(arranged).containsExactly("line_item_id", "date", "impressions", "spend");
	}

	@Test
	void shouldDeduplicateARepeatedIdInColumnOrderTest() {
		// Given: columnOrder names "date" twice
		List<String> included = List.of("date", "impressions");
		List<String> columnOrder = List.of("date", "date", "impressions");

		// When:
		List<String> arranged = arranger.arrange(included, columnOrder);

		// Then:
		assertThat(arranged).containsExactly("date", "impressions");
	}
}
