package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/**
 * One tab of a probed spreadsheet, with enough of its contents to choose column roles.
 *
 * <p>{@code sample} arrives from Pacing with each cell in whatever JSON type the spreadsheet gave
 * it - a date cell is a number, a count is a number, a name is a string - so it is held as
 * {@code Object} here and flattened to text at the contract edge. Flattening earlier would mean
 * guessing a format for a value whose only job is to let a person recognise the column.
 *
 * @param sheetId    the tab's own id - its {@code gid}
 * @param title      the tab's name
 * @param rowCount   how many rows it has, header included
 * @param colCount   how many columns it has
 * @param headerRow  which row the headers were found on, counted from zero
 * @param headers    the header cells of that row, trimmed, in column order
 * @param sample     a few data rows, in the same column order as the headers
 * @param grid       the raw top of the tab, for correcting a wrongly detected header row
 */
public record PacingSheetTab(
		@JsonProperty("sheet_id") int sheetId,
		String title,
		@JsonProperty("row_count") int rowCount,
		@JsonProperty("col_count") int colCount,
		@JsonProperty("header_row") int headerRow,
		List<String> headers,
		List<List<Object>> sample,
		List<List<String>> grid) {
}
