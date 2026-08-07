package com.aidigital.operationalhub.service.common.search;

import java.util.List;

/**
 * Generic, paginated search criteria shared by all searchable collections.
 *
 * @param filters    the filters applied additively (AND); never {@code null}, may be empty
 * @param sort       the sort directive, or {@code null} for the entity's default ordering
 * @param pageNumber the one-based page number to return
 * @param pageSize   the maximum number of items per page
 * @param <F>        the per-entity searchable field type
 */
public record SearchCriteria<F extends SearchableField>(
		List<FilterCriterion<F>> filters, SortCriterion<F> sort, int pageNumber, int pageSize) {

	/**
	 * Returns the zero-based offset of the first row on the requested page.
	 *
	 * @return the row offset derived from {@code pageNumber} and {@code pageSize}
	 */
	public int offset() {
		return (pageNumber - 1) * pageSize;
	}
}
