package com.aidigital.operationalhub.application.mapper;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Arranges a list of included column ids by a requested on-screen column order.
 *
 * <p>The requested order decides only where an included column sits, never which columns are
 * included: membership is whatever {@code included} carries. An id named in the requested order that
 * is not in {@code included} is ignored, and an included id left out of the requested order is written
 * after the ones named there, in its own default relative order.
 */
@Component
public class ColumnOrderArranger {

	/**
	 * Arranges the included column ids by their position in the requested column order.
	 *
	 * @param included    the included column ids, in their default order
	 * @param columnOrder the requested on-screen arrangement, or {@code null}/empty for the default order
	 * @return {@code included}, reordered by {@code columnOrder} when one is given; a defensive copy of
	 * {@code included}, unchanged, when {@code columnOrder} is {@code null} or empty
	 */
	public List<String> arrange(List<String> included, List<String> columnOrder) {
		if (columnOrder == null || columnOrder.isEmpty()) {
			return List.copyOf(included);
		}
		Set<String> remaining = new LinkedHashSet<>(included);
		List<String> arranged = new ArrayList<>();
		for (String id : columnOrder) {
			if (remaining.remove(id)) {
				arranged.add(id);
			}
		}
		// Every id left in remaining was never placed by columnOrder - append in its own default order.
		arranged.addAll(remaining);
		return List.copyOf(arranged);
	}
}
