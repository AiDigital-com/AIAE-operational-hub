package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.model.ConversionAdjustmentRowModel;
import com.aidigital.operationalhub.service.agency.model.ConversionKey;
import com.aidigital.operationalhub.service.agency.model.ConversionRowModel;
import com.aidigital.operationalhub.service.agency.model.ConversionTemplateColumn;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Turns an uploaded conversions spreadsheet into the adjustments it asks for, by comparing each row against
 * the campaign's current conversions.
 *
 * <p>No BigQuery here despite the package - this is the spreadsheet's contract, and it sits beside the read
 * and the write it runs between rather than in a package of its own. What it decides is which rows changed,
 * which named nothing, and what an edited cell is allowed to say.
 */
@Component
public class ConversionTemplateDiffer {

	/**
	 * How many stale row numbers an error message names before it stops - enough to see the pattern, few
	 * enough that the message stays readable when most of a large file is stale.
	 */
	private static final int UNMATCHED_ROWS_NAMED = 10;

	/**
	 * Diffs every uploaded row against the baseline, returning one adjustment per row whose figure changed.
	 *
	 * <p>Rejects the whole upload when any row named a conversions row that no longer exists, rather than
	 * writing the rest: a file half-applied is harder to reason about than one refused, and the user still
	 * holds the file.
	 *
	 * @param uploadedRows the parsed spreadsheet rows
	 * @param baseline     the campaign's current conversions, keyed
	 * @return the adjustments to write, in sheet order; empty when nothing changed
	 * @throws BusinessException OPH_027 when a row matches nothing, matches more than one row, or carries a
	 *                           value that is not a number
	 */
	List<ConversionAdjustmentRowModel> diff(
			List<WorkbookAdjustmentRow> uploadedRows, Map<ConversionKey, List<ConversionRowModel>> baseline) {
		List<ConversionAdjustmentRowModel> models = new ArrayList<>();
		List<Integer> unmatchedRows = new ArrayList<>();
		for (WorkbookAdjustmentRow row : uploadedRows) {
			ConversionRowModel base = matchBaseline(row, baseline);
			if (base == null) {
				unmatchedRows.add(row.sourceRowNumber());
				continue;
			}
			ConversionAdjustmentRowModel adjustment = diffRow(row, base);
			if (adjustment != null) {
				models.add(adjustment);
			}
		}
		requireEveryRowMatched(unmatchedRows, uploadedRows.size());
		return models;
	}

	/**
	 * Rejects the upload when any row named a conversions row that no longer exists, reporting how many and
	 * where rather than stopping at the first.
	 *
	 * <p>Every row has to match, because the template writes a figure for each one - there is no "left
	 * blank" to mean "skip me". So an upload can fail for a reason that has nothing to do with the rows the
	 * user edited: a template downloaded last week, a mart reprocessed since, an action renamed upstream.
	 * Naming only the first such row would send someone to fix one line of a file where fifty are stale, and
	 * they would learn that one row at a time.
	 *
	 * @param unmatchedRows the sheet row numbers that matched nothing, in sheet order
	 * @param totalRows     how many rows the upload carried
	 * @throws BusinessException OPH_027 when any row matched nothing
	 */
	void requireEveryRowMatched(List<Integer> unmatchedRows, int totalRows) {
		if (unmatchedRows.isEmpty()) {
			return;
		}
		List<Integer> shown = unmatchedRows.subList(0, Math.min(unmatchedRows.size(), UNMATCHED_ROWS_NAMED));
		String where = shown.stream().map(String::valueOf).collect(Collectors.joining(", "));
		String more = unmatchedRows.size() > shown.size() ? ", ..." : "";
		throw new BusinessException(
				OperationalHubErrorReason.OPH_027,
				unmatchedRows.size() + " of " + totalRows + " rows match no current conversions row (row "
						+ where + more + "). The conversions they name may have changed since the template was "
						+ "downloaded - download it again and re-apply the edits");
	}

	/**
	 * Finds the one conversions row an uploaded row refers to, or {@code null} when the campaign no longer
	 * has one.
	 *
	 * <p>No match returns rather than throws, so the caller can count every stale row and report them
	 * together (see {@link #requireEveryRowMatched}). More than one match still throws immediately: that is
	 * not a stale template but a key that has stopped identifying a single row, and continuing would mean
	 * picking one arbitrarily.
	 *
	 * @param row      the uploaded row
	 * @param baseline the campaign's conversions rows, keyed by template key
	 * @return the matching row, or {@code null} when none matches
	 * @throws BusinessException OPH_027 when more than one row matches
	 */
	ConversionRowModel matchBaseline(
			WorkbookAdjustmentRow row, Map<ConversionKey, List<ConversionRowModel>> baseline) {
		List<ConversionRowModel> matches = baseline.get(ConversionKey.fromCells(row.cells()));
		if (matches == null || matches.isEmpty()) {
			return null;
		}
		if (matches.size() > 1) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					"row " + row.sourceRowNumber() + " matches more than one conversions row");
		}
		return matches.get(0);
	}

	/**
	 * Turns one uploaded row into an adjustment, or {@code null} when it changes nothing.
	 *
	 * <p>Every identity value comes from {@code base}, never from the sheet. The sheet is trusted to say
	 * which row it means and what the new figure is; it is not trusted to restate the row's identity, since
	 * a mistyped level name would otherwise be written as a new row rather than an edit of an existing one.
	 *
	 * @param row  the uploaded row
	 * @param base the conversions row it refers to
	 * @return the adjustment to write, or {@code null} when the figure is unchanged
	 * @throws BusinessException OPH_027 when the conversions cell is not a number
	 */
	ConversionAdjustmentRowModel diffRow(WorkbookAdjustmentRow row, ConversionRowModel base) {
		String raw = row.cells().get(ConversionTemplateColumn.CONVERSIONS);
		if (raw == null || raw.isBlank()) {
			return null;
		}
		Double edited = parseCell(raw, row.sourceRowNumber());
		if (AdjustmentValueValidator.isSameValue(base.conversions(), edited)) {
			return null;
		}
		return new ConversionAdjustmentRowModel(
				base.date(), base.platform(), base.account(), base.accountId(),
				base.conversionAction(), base.conversionCategory(),
				base.lineItemName(), base.lineItemId(),
				base.insertionOrderName(), base.insertionOrderId(),
				base.creativeName(), base.creativeId(),
				edited, ConversionTemplateColumn.CONVERSIONS);
	}

	/**
	 * Parses one edited cell as a number, rejecting anything else rather than silently treating it as no
	 * change.
	 *
	 * @param raw    the cell's text
	 * @param rowNum the sheet row number, for the message
	 * @return the parsed value
	 * @throws BusinessException OPH_027 when the text is not a number
	 */
	Double parseCell(String raw, int rowNum) {
		return AdjustmentValueValidator.parseOptionalNonNegativeDecimal(
				raw, ConversionTemplateColumn.CONVERSIONS, rowNum);
	}
}
