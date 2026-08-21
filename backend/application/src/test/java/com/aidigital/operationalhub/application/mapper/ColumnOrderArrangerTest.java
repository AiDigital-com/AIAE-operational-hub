package com.aidigital.operationalhub.application.mapper;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ColumnOrderArranger}.
 */
class ColumnOrderArrangerTest {

	private final ColumnOrderArranger arranger = new ColumnOrderArranger();

	@Test
	void shouldArrangeSelectedColumnsByColumnOrderTest() {
		// Given:
		List<String> selected = List.of("date", "line_item_id", "impressions", "spend");
		List<String> columnOrder = List.of("impressions", "date", "spend", "line_item_id");

		// When:
		List<String> arranged = arranger.arrange(selected, columnOrder);

		// Then:
		assertThat(arranged).containsExactly("impressions", "date", "spend", "line_item_id");
	}

	@Test
	void shouldKeepSelectedIdAtDefaultPlaceWhenAbsentFromColumnOrderTest() {
		// Given: "spend" is selected but never appears in columnOrder
		List<String> selected = List.of("date", "line_item_id", "impressions", "spend");
		List<String> columnOrder = List.of("line_item_id", "date", "impressions");

		// When:
		List<String> arranged = arranger.arrange(selected, columnOrder);

		// Then: "spend" is appended at the end, in its default relative place
		assertThat(arranged).containsExactly("line_item_id", "date", "impressions", "spend");
	}

	@Test
	void shouldDropUnselectedIdPresentInColumnOrderTest() {
		// Given: "clicks" appears in columnOrder but is not selected
		List<String> selected = List.of("date", "impressions");
		List<String> columnOrder = List.of("clicks", "impressions", "date");

		// When:
		List<String> arranged = arranger.arrange(selected, columnOrder);

		// Then: "clicks" never resurfaces
		assertThat(arranged).containsExactly("impressions", "date");
	}

	@Test
	void shouldReturnSelectedUnchangedWhenColumnOrderIsNullTest() {
		// Given:
		List<String> selected = List.of("date", "impressions", "spend");

		// When:
		List<String> arranged = arranger.arrange(selected, null);

		// Then:
		assertThat(arranged).containsExactly("date", "impressions", "spend");
	}

	@Test
	void shouldReturnSelectedUnchangedWhenColumnOrderIsEmptyTest() {
		// Given:
		List<String> selected = List.of("date", "impressions", "spend");

		// When:
		List<String> arranged = arranger.arrange(selected, List.of());

		// Then:
		assertThat(arranged).containsExactly("date", "impressions", "spend");
	}

	@Test
	void shouldDeduplicateRepeatedIdInColumnOrderTest() {
		// Given: columnOrder mentions "date" twice
		List<String> selected = List.of("date", "impressions");
		List<String> columnOrder = List.of("date", "date", "impressions");

		// When:
		List<String> arranged = arranger.arrange(selected, columnOrder);

		// Then:
		assertThat(arranged).containsExactly("date", "impressions");
	}
}
