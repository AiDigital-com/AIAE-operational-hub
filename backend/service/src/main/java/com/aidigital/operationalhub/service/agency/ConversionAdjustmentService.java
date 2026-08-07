package com.aidigital.operationalhub.service.agency;

import com.aidigital.operationalhub.service.agency.model.ConversionBreakdownQuery;
import com.aidigital.operationalhub.service.agency.model.ConversionRowExportModel;
import com.aidigital.operationalhub.service.agency.model.ConversionRowModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowDateRangeModel;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;

import java.util.List;

/**
 * Writes manual adjustments to a campaign's conversions, at the conversions mart's own per-action grain.
 *
 * <p>Writes replace rather than append: an adjustment for a key already adjusted supersedes the earlier
 * one instead of joining it. That has to be stated because the conversions view merges adjustments without
 * resolving duplicates - two rows for one key are counted twice, so "write the new value" has to mean "and
 * remove the old one".
 *
 * <p>Separate from {@link ReportRowService} because the two write to different tables at different
 * grains: a delivery adjustment names a line item on a day, a conversions adjustment names a line item,
 * a day and a conversion action. The report shows the two joined, but nothing can write them together.
 */
public interface ConversionAdjustmentService {

	/**
	 * Returns the campaign's conversions rows at the conversions mart's own grain - one row per day, line
	 * item and conversion action - for the template the user edits offline.
	 *
	 * <p>A read of its own rather than a slice of the report, because the report has no conversion-action
	 * column: it sums the actions away to attach one figure per delivery row. An editable file has to name
	 * the action, or an edited value would have nothing to belong to.
	 *
	 * @param user       the current user
	 * @param campaignId the campaign to read
	 * @param dateRange  the inclusive conversion-date window; never {@code null}, may be empty
	 * @return the campaign's conversions rows, ordered by date, line item and action, and whether the read
	 *         hit its row cap
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the campaign is unknown
	 *                                                                         or not visible to the user
	 *                                                                         (OPH_025)
	 */
	ConversionRowExportModel findConversionRows(
			CurrentUserModel user, long campaignId, ReportRowDateRangeModel dateRange);

	/**
	 * Returns the conversions rows behind one report row's Conversions cell, one per conversion action.
	 *
	 * <p>Selected by the report's own join, so the rows returned are the rows that produced the figure and
	 * their values sum to it. That is the whole contract of this method: a breakdown the user can trust
	 * enough to edit.
	 *
	 * @param user       the current user
	 * @param campaignId the campaign the report row belongs to
	 * @param query      the report row's identity
	 * @return the conversions rows behind that cell, ordered by conversion action; empty when the cell is
	 *         blank because nothing matched
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the campaign is unknown
	 *                                                                         or not visible (OPH_025)
	 */
	List<ConversionRowModel> findConversionRowsBehind(
			CurrentUserModel user, long campaignId, ConversionBreakdownQuery query);

	/**
	 * Applies submitted conversion adjustments: each row is matched against the campaign's current
	 * conversions by its full identity, and a row whose conversions figure differs is written as an
	 * adjustment. A row that changes nothing is skipped rather than rewritten.
	 *
	 * <p>One method for both ways of submitting them - an edited spreadsheet and an edited cell - because
	 * they differ only in how the rows were typed. Matching, validation and the replace-not-append write
	 * are the same, and a second path through them would be a second place for them to drift.
	 *
	 * @param user         the current user
	 * @param campaignId   the campaign the rows belong to
	 * @param uploadedRows the submitted rows
	 * @return the number of rows written
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the campaign is unknown
	 *                                                                         or not visible (OPH_025), a
	 *                                                                         row names no current
	 *                                                                         conversions row or carries an
	 *                                                                         unreadable value (OPH_027), or
	 *                                                                         the BigQuery write fails
	 *                                                                         (OPH_026)
	 */
	int applyConversionAdjustments(
			CurrentUserModel user, long campaignId, List<WorkbookAdjustmentRow> uploadedRows);

}
