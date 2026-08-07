package com.aidigital.operationalhub.service.agency.model;

import java.util.Map;

/**
 * One data row read from an uploaded bulk-adjustment spreadsheet: the 1-based source row number (for
 * error messages) plus the raw string cell values keyed by their (lower-cased) column header. Numeric
 * coercion and validation happen in the service, so a malformed value is reported as OPH_027 with the
 * offending row/column, never silently dropped here.
 *
 * @param sourceRowNumber the 1-based row number in the uploaded sheet (header is row 1), for diagnostics
 * @param cells           the row's cell values keyed by column header; a blank/absent cell maps to null
 */
public record WorkbookAdjustmentRow(int sourceRowNumber, Map<String, String> cells) {
}
