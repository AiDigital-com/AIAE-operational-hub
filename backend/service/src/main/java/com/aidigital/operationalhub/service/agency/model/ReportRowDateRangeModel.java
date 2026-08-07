package com.aidigital.operationalhub.service.agency.model;

/**
 * An inclusive delivery-date window to narrow a report-rows read to.
 *
 * <p>Separate from {@link ReportRowFilterModel} because it is a different shape, not a different
 * column: every other dimension is filtered by naming the values to keep, which suits a picker with a
 * few dozen options. Dates do not — a quarter is ninety checkboxes, and the distinct-value list a
 * picker would draw from is capped server-side, so on a long campaign it could not even offer them
 * all. A range asks for two bounds instead and stays exact however long the flight is.
 *
 * <p>Either bound may be {@code null} for an open-ended window. Both {@code null} matches everything,
 * which is the same as no range at all.
 *
 * @param from the inclusive first delivery date as {@code yyyy-MM-dd}, or {@code null}
 * @param to   the inclusive last delivery date as {@code yyyy-MM-dd}, or {@code null}
 */
public record ReportRowDateRangeModel(String from, String to) {

	/**
	 * The empty window - no narrowing at all.
	 *
	 * @return a range with both bounds unset
	 */
	public static ReportRowDateRangeModel none() {
		return new ReportRowDateRangeModel(null, null);
	}

	/**
	 * Whether this window narrows anything.
	 *
	 * @return {@code true} when at least one bound is set
	 */
	public boolean isPresent() {
		return from != null || to != null;
	}
}
