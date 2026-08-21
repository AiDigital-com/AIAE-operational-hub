package com.aidigital.operationalhub.application.mapper;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Arranges a report's selected export columns by a saved on-screen column order.
 *
 * <p>{@code columnOrder} decides only where a column sits, never which columns exist: membership is
 * whatever {@code selected} carries (the report's own dimensions-then-metrics list). A selected id
 * absent from {@code columnOrder} keeps its default relative place - at the end, in {@code selected}'s
 * own order - and an id present in {@code columnOrder} that is not selected is dropped rather than
 * resurrecting a column nobody asked for.
 */
@Component
public class ColumnOrderArranger {

	/**
	 * Arranges the selected column ids by their position in the saved column order.
	 *
	 * @param selected    the selected column ids, in their default order (dimensions then metrics)
	 * @param columnOrder the saved on-screen arrangement, or {@code null}/empty for the default order
	 * @return {@code selected}, reordered by {@code columnOrder} when one is given; a copy of
	 * {@code selected} unchanged when {@code columnOrder} is {@code null} or empty
	 */
	public List<String> arrange(List<String> selected, List<String> columnOrder) {
		if (columnOrder == null || columnOrder.isEmpty()) {
			return List.copyOf(selected);
		}
		Set<String> selectedIds = new LinkedHashSet<>(selected);
		List<String> arranged = new ArrayList<>();
		for (String id : columnOrder) {
			if (selectedIds.remove(id)) {
				arranged.add(id);
			}
		}
		// Every id left in selectedIds was never placed by columnOrder - append in default order.
		arranged.addAll(selectedIds);
		return List.copyOf(arranged);
	}
}
