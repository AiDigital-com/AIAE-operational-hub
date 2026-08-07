package com.aidigital.operationalhub.service.agency.model;

import java.util.List;

/**
 * A page of {@link ReportRowModel}s plus full-dataset aggregates ({@link #totals()},
 * {@link #minDate()}/{@link #maxDate()}/{@link #distinctLineItemCount()}) — the aggregates are always
 * computed over every row matching the query, not just {@link #content()}, so a paginated table's
 * totals row and date-range/line-item-count labels stay stable while more pages load.
 *
 * <p>Paging is driven by {@link #hasNext()}, derived from fetching one extra row past
 * {@code pageSize} - not by a page count. {@link #totalRows()} is reported alongside it purely so the
 * table can say how much there is; it rides on the data query as a window function and costs no job of
 * its own, so it is a label rather than a paging mechanism.
 *
 * @param content               the report rows on this page
 * @param pageNumber            the one-based page number returned
 * @param pageSize              the maximum number of items per page
 * @param hasNext               whether at least one more row exists past this page
 * @param totalRows             how many rows the query matches in total - groups, on a grouped read
 * @param totals                metric totals across every matching row
 * @param minDate               the earliest date across every matching row (ISO format), or {@code null}
 * @param maxDate               the latest date across every matching row (ISO format), or {@code null}
 * @param distinctLineItemCount the number of distinct line items across every matching row
 */
public record ReportRowPageModel(
		List<ReportRowModel> content,
		int pageNumber,
		int pageSize,
		boolean hasNext,
		long totalRows,
		ReportRowTotalsModel totals,
		String minDate,
		String maxDate,
		long distinctLineItemCount) {

}
