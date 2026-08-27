package com.aidigital.operationalhub.service.agency;

import com.aidigital.operationalhub.service.agency.bigquery.model.ConstructedEntityLevel;
import com.aidigital.operationalhub.service.agency.model.AdjustmentRowModel;
import com.aidigital.operationalhub.service.agency.model.ConstructedEntity;
import com.aidigital.operationalhub.service.agency.model.ConstructedIdsPreviewModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowDateRangeModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowExportModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowFilterModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowPageModel;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import com.aidigital.operationalhub.service.agency.search.ReportRowSortField;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import org.springframework.data.domain.Page;

import java.util.List;

/**
 * Reads per-day, per-line-item delivery/actuals rows from the op-hub adjustments view, scoped to one
 * campaign.
 *
 * <p>Implementations resolve the campaign (enforcing the user's existing agency visibility) and query
 * the {@code platform_mart_adjustments_view_op_hub} BigQuery view for its rows.
 */
public interface ReportRowService {

	/**
	 * Returns one page of report rows for the given campaign, visible to the given user, plus full
	 * dataset aggregates (totals, date range, distinct line item count) that stay stable across pages.
	 * Sorting is applied database-side (never to only the already-loaded rows), so ordering stays
	 * correct as more pages load.
	 *
	 * @param user       the current user
	 * @param campaignId the campaign id
	 * @param pageNumber the one-based page number to return
	 * @param pageSize   the maximum number of rows per page
	 * @param dimensions the dimensions to group by, in display order - one row per distinct combination,
	 *                   with every metric aggregated over it. Empty returns the raw, ungrouped rows;
	 *                   never {@code null}
	 * @param sort       the requested sort dimension/direction, or {@code null} to sort by date then
	 *                   line item (the default)
	 * @param filters    the requested dimension filters, applied additively (AND); a filter's own values
	 *                   match by OR (IN); never {@code null}, may be empty
	 * @param dateRange  the inclusive delivery-date window; never {@code null}, may be empty
	 * @return the requested page, ordered by the requested sort (or the default) and narrowed by the
	 *         requested filters, plus full-dataset aggregates over that same filtered set - the
	 *         aggregates cover the whole filtered dataset either way, so grouping never changes them
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the campaign is
	 *                                                                          unknown or not visible
	 *                                                                          to the user, or the
	 *                                                                          BigQuery read fails
	 */
	ReportRowPageModel findReportRows(
			CurrentUserModel user, long campaignId, int pageNumber, int pageSize,
			List<ReportRowSortField> dimensions, SortCriterion<ReportRowSortField> sort,
			List<ReportRowFilterModel> filters, ReportRowDateRangeModel dateRange);

	/**
	 * Returns the distinct, non-null values of one dimension for the given campaign, capped at a fixed
	 * size - used to populate a report-rows column's filter picker. Metrics have no stored column to
	 * distinct over, so {@code field} is always one of the filterable dimensions, never a metric.
	 *
	 * @param user       the current user
	 * @param campaignId the campaign id
	 * @param field      the dimension to list distinct values for
	 * @return the dimension's distinct values, in ascending order
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the campaign is
	 *                                                                          unknown or not visible
	 *                                                                          to the user, or the
	 *                                                                          BigQuery read fails
	 */
	List<String> findDistinctValues(CurrentUserModel user, long campaignId, ReportRowSortField field);

	/**
	 * Appends adjustment rows for one campaign to the report-rows write table, each stamped with the
	 * current user and a server-authoritative {@code last_modified_at}, so the read view merges them
	 * over the base rows (latest {@code last_modified_at} wins). The campaign is resolved and its
	 * visibility to the user enforced first; campaign-identity columns are stamped from the resolved
	 * campaign, never the caller.
	 *
	 * @param user        the current user (stamped into {@code created_by}/{@code last_modified_by})
	 * @param campaignId  the campaign the adjustments belong to
	 * @param adjustments the rows to append (overrides and/or manual adds); must be non-empty
	 * @return the number of rows written
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_025 if the campaign
	 *                                                                          is unknown/invisible,
	 *                                                                          OPH_027 on an invalid
	 *                                                                          payload, OPH_026 if the
	 *                                                                          BigQuery write fails
	 */
	long saveAdjustments(CurrentUserModel user, long campaignId, List<AdjustmentRowModel> adjustments);

	/**
	 * Returns every report row matching the requested grouping/sort/filters for one campaign, up to a
	 * fixed cap, without pagination - for a "download report" export. Unlike {@link #findReportRows},
	 * this reads no full-dataset aggregates (an export needs only the rows).
	 *
	 * @param user       the current user
	 * @param campaignId the campaign id
	 * @param dimensions the dimensions to group by, in display order - same meaning as on
	 *                   {@link #findReportRows}, so an export of the on-screen view matches what the
	 *                   table shows row for row. Empty exports the raw, ungrouped rows; never
	 *                   {@code null}
	 * @param sort       the requested sort dimension/direction, or {@code null} for the default order
	 * @param filters    the requested dimension filters; never {@code null}, may be empty
	 * @param dateRange  the inclusive delivery-date window; never {@code null}, may be empty
	 * @return the matching rows (capped) and whether the cap truncated the result
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the campaign is
	 *                                                                          unknown or not visible
	 *                                                                          to the user, or the
	 *                                                                          BigQuery read fails
	 */
	ReportRowExportModel exportReportRows(
			CurrentUserModel user, long campaignId, List<ReportRowSortField> dimensions,
			SortCriterion<ReportRowSortField> sort, List<ReportRowFilterModel> filters,
			ReportRowDateRangeModel dateRange);

	/**
	 * Applies a bulk manual adjustment from an uploaded spreadsheet: each uploaded row is matched to an
	 * existing report row by natural key (date, line_item_id), its editable metric cells are diffed
	 * against the current value, and every changed cell is written as an append-only override through
	 * the same path as {@link #saveAdjustments}. Edit-only - a row matching no existing report row is
	 * rejected, never added. All-or-nothing - any malformed cell, missing required column, or unmatched
	 * key fails the whole upload before any write is attempted.
	 *
	 * @param user         the current user (stamped into created_by/last_modified_by)
	 * @param campaignId   the campaign the rows belong to
	 * @param uploadedRows the parsed spreadsheet rows
	 * @return the number of override rows written (0 when nothing changed)
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_025 unknown/invisible
	 *                                                                          campaign, OPH_027 invalid
	 *                                                                          upload, OPH_026 if the
	 *                                                                          BigQuery write fails
	 */
	int applyBulkAdjustments(CurrentUserModel user, long campaignId, List<WorkbookAdjustmentRow> uploadedRows);

	/**
	 * Returns one page of one constructed-name level's entities from the campaign's own mart data
	 * matching an exact typed name - resolves an Add Line name cell to a real entity id instead of
	 * letting the user type one (PDI_117 mode A). Also used, with {@code name} blank, as a lightweight
	 * "does this campaign have any data at this level yet" probe.
	 *
	 * @param user       the current user
	 * @param campaignId the campaign id
	 * @param level      the constructed-name level to resolve at
	 * @param platform   narrows results to one platform, or {@code null}/blank for every platform
	 * @param accountId  narrows results to one platform account id, or {@code null}/blank for every account
	 * @param name       the exact constructed name to resolve, or {@code null}/blank to match every entity
	 * @param pageNumber the one-based page number
	 * @param pageSize   the page size
	 * @return the requested page of entities
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the campaign is
	 *                                                                          unknown or not visible
	 *                                                                          to the user, or the
	 *                                                                          BigQuery read fails
	 */
	Page<ConstructedEntity> findConstructedEntities(
			CurrentUserModel user, long campaignId, ConstructedEntityLevel level, String platform, String accountId,
			String name, int pageNumber, int pageSize);

	/**
	 * Previews the deterministic constructed ids Add Line mode B would generate for the given names,
	 * without writing anything. {@link #saveAdjustments} re-derives the same values server-side
	 * regardless of what the client sends (PDI_117 D5) - this is a convenience read, not the authority.
	 *
	 * @param user               the current user
	 * @param campaignId         the campaign id
	 * @param name               the level-1 constructed name
	 * @param nameLvl2           the level-2 constructed name
	 * @param nameLvl3           the level-3 constructed name
	 * @return the three levels' previewed ids
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the campaign is
	 *                                                                          unknown or not visible
	 *                                                                          to the user, or the
	 *                                                                          BigQuery read fails
	 */
	ConstructedIdsPreviewModel previewConstructedIds(
			CurrentUserModel user, long campaignId, String name, String nameLvl2, String nameLvl3);
}
