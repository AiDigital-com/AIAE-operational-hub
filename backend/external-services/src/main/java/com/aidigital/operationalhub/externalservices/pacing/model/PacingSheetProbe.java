package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/**
 * What {@code POST /api/dashboards/:slug/sheet-probe} saw in a spreadsheet.
 *
 * <p>A file nobody shared with the Pacing service comes back here as {@code ok=false} with the
 * address to share it with, and that is NOT a failure: it is the expected first answer for a source
 * being set up, and the only useful response is to show the person who to share with. Pacing
 * answers it with 200 for exactly that reason, so nothing in this path throws on it.
 *
 * @param ok             false when the file could not be opened
 * @param spreadsheetId  the id taken out of the pasted link
 * @param title          the spreadsheet's own name, or null when it could not be read
 * @param shareWith      the address the file must be shared with, or null when none is configured
 * @param error          why the file could not be read, or null on success
 * @param tabs           the tabs holding a grid of values; empty when the file could not be read
 */
public record PacingSheetProbe(
		boolean ok,
		@JsonProperty("spreadsheet_id") String spreadsheetId,
		String title,
		@JsonProperty("share_with") String shareWith,
		String error,
		List<PacingSheetTab> tabs) {
}
