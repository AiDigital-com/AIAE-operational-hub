package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.model.AdjustmentRowModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.instancio.Select.field;

/**
 * Unit tests for {@link AdjustedMetricsMarker} - the server-side derivation that replaced the
 * client-supplied {@code adjusted_metrics} marker on the inline-edit path.
 */
class AdjustedMetricsMarkerTest {

	private final AdjustedMetricsMarker marker = new AdjustedMetricsMarker();

	@Test
	void shouldDeriveFromNonNullMetricsOnlyTest() {
		// Given: only impressions and spend carry a value, every other metric is left null
		AdjustmentRowModel adjustment = Instancio.of(AdjustmentRowModel.class)
				.set(field(AdjustmentRowModel::impressions), 1000L)
				.set(field(AdjustmentRowModel::spend), 56.7)
				.set(field(AdjustmentRowModel::clicks), null)
				.set(field(AdjustmentRowModel::starts), null)
				.set(field(AdjustmentRowModel::firstQuartiles), null)
				.set(field(AdjustmentRowModel::midpoints), null)
				.set(field(AdjustmentRowModel::thirdQuartiles), null)
				.set(field(AdjustmentRowModel::completes), null)
				.set(field(AdjustmentRowModel::dynamicCost), null)
				.set(field(AdjustmentRowModel::linkClicks), null)
				.create();

		// When:
		String result = marker.derive(adjustment);

		// Then:
		assertThat(result).isEqualTo("impressions,spend");
	}

	@Test
	void shouldPreserveCanonicalOrderRegardlessOfWhichSubsetIsSetTest() {
		// Given: set out of canonical order (dynamic_cost, then clicks, then impressions)
		AdjustmentRowModel adjustment = Instancio.of(AdjustmentRowModel.class)
				.set(field(AdjustmentRowModel::dynamicCost), 12.5)
				.set(field(AdjustmentRowModel::clicks), 40L)
				.set(field(AdjustmentRowModel::impressions), 900L)
				.set(field(AdjustmentRowModel::spend), null)
				.set(field(AdjustmentRowModel::starts), null)
				.set(field(AdjustmentRowModel::firstQuartiles), null)
				.set(field(AdjustmentRowModel::midpoints), null)
				.set(field(AdjustmentRowModel::thirdQuartiles), null)
				.set(field(AdjustmentRowModel::completes), null)
				.set(field(AdjustmentRowModel::linkClicks), null)
				.create();

		// When:
		String result = marker.derive(adjustment);

		// Then: canonical column order, not assignment order
		assertThat(result).isEqualTo("impressions,clicks,dynamic_cost");
	}

	@Test
	void shouldReturnEmptyWhenNoMetricIsSetTest() {
		// Given: every stored metric component is null
		AdjustmentRowModel adjustment = Instancio.of(AdjustmentRowModel.class)
				.set(field(AdjustmentRowModel::impressions), null)
				.set(field(AdjustmentRowModel::clicks), null)
				.set(field(AdjustmentRowModel::spend), null)
				.set(field(AdjustmentRowModel::starts), null)
				.set(field(AdjustmentRowModel::firstQuartiles), null)
				.set(field(AdjustmentRowModel::midpoints), null)
				.set(field(AdjustmentRowModel::thirdQuartiles), null)
				.set(field(AdjustmentRowModel::completes), null)
				.set(field(AdjustmentRowModel::dynamicCost), null)
				.set(field(AdjustmentRowModel::linkClicks), null)
				.create();

		// When:
		String result = marker.derive(adjustment);

		// Then:
		assertThat(result).isEmpty();
	}

	@Test
	void shouldDeriveASingleMetricMarkerTest() {
		// Given: only link_clicks carries a value
		AdjustmentRowModel adjustment = Instancio.of(AdjustmentRowModel.class)
				.set(field(AdjustmentRowModel::linkClicks), 25L)
				.set(field(AdjustmentRowModel::impressions), null)
				.set(field(AdjustmentRowModel::clicks), null)
				.set(field(AdjustmentRowModel::spend), null)
				.set(field(AdjustmentRowModel::starts), null)
				.set(field(AdjustmentRowModel::firstQuartiles), null)
				.set(field(AdjustmentRowModel::midpoints), null)
				.set(field(AdjustmentRowModel::thirdQuartiles), null)
				.set(field(AdjustmentRowModel::completes), null)
				.set(field(AdjustmentRowModel::dynamicCost), null)
				.create();

		// When:
		String result = marker.derive(adjustment);

		// Then:
		assertThat(result).isEqualTo("link_clicks");
	}
}
