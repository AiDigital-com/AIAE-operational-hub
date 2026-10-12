package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/**
 * The body of {@code POST /api/dashboards/:slug/dim-source-values}: which columns of which tab to
 * list the values of.
 *
 * @param spreadsheetId the spreadsheet the tab belongs to
 * @param sheetId       the tab's gid
 * @param columns       one to three header names, spelled as they are in the sheet
 * @param headerRow     where the header was last seen, counted from zero; null means the first row
 */
public record DimSourceValuesRequest(
		@JsonProperty("spreadsheet_id") String spreadsheetId,
		@JsonProperty("sheet_id") int sheetId,
		List<String> columns,
		@JsonProperty("header_row") Integer headerRow) {
}
