package com.aidigital.operationalhub.externalservices.pacing;

import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceRead;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceValues;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceSuggestions;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceUnboundName;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSheetProbe;
import java.util.List;

/**
 * The three Pacing calls that stand behind connecting a Google Sheet to a pacing as an extra
 * dimension: look at the file, list what a column holds, and read a configured source now.
 *
 * <p>Kept apart from {@link PacingClient} rather than added to it. These three are the only Pacing
 * calls that read a file the user names - everything on {@code PacingClient} works on the pacing's
 * own stored state - and they share a failure vocabulary of their own, where "we cannot open it" is
 * an ANSWER rather than an error. Folding them in would also have pushed that file past the 2000
 * lines this module caps a source file at, for no gain in cohesion.
 */
public interface PacingSheetSourceClient {

	/**
	 * Opens a Google spreadsheet and reports what is in it - its tabs, each one's header row and a
	 * few data rows - so a person can choose which tab a source reads and what each column means.
	 *
	 * <p>Reads only; nothing is stored. A spreadsheet that has not been shared with the Pacing
	 * service comes back as an unreadable answer carrying the address to share with, NOT as a thrown
	 * failure: on a source being set up that is the expected first answer, and the caller's job is to
	 * show it as an instruction.
	 *
	 * @param assertion the signed caller identity and scope
	 * @param slug      the pacing's dash_slug
	 * @param url       the spreadsheet link as the user pasted it
	 * @return what the spreadsheet holds, or why it could not be read
	 */
	PacingSheetProbe probeSheet(HubAssertion assertion, String slug, String url);

	/**
	 * Lists the distinct values of up to three columns of a sheet tab, each with how many rows carry
	 * it, so a mapping can offer the spellings that are really in the file instead of asking a person
	 * to retype them.
	 *
	 * @param assertion     the signed caller identity and scope
	 * @param slug          the pacing's dash_slug
	 * @param spreadsheetId the spreadsheet the tab belongs to
	 * @param sheetId       the tab's gid
	 * @param columns       one to three header names, spelled as they are in the sheet
	 * @param headerRow     where the header was last seen, counted from zero, or null for the first row
	 * @return the distinct values, most rows first
	 */
	PacingDimSourceValues readValues(
			HubAssertion assertion,
			String slug,
			String spreadsheetId,
			int sheetId,
			List<String> columns,
			Integer headerRow);

	/**
	 * Re-reads a configured sheet source now rather than waiting for the next refresh.
	 *
	 * @param assertion the signed caller identity and scope
	 * @param slug      the pacing's dash_slug
	 * @param sourceId  the stored source's id
	 * @return how many rows were stored, how many were left unattributed, and how far the data reaches
	 */
	PacingDimSourceRead readSource(HubAssertion assertion, String slug, String sourceId);

	/**
	 * Asks Pacing to propose part of a source's mapping - which line item each unrouted name belongs
	 * to, more spellings for one canonical value, or a grouping of a whole column.
	 *
	 * <p>Proposals are DRAFTS; nothing is stored. "No model is connected" and "this source has not
	 * been read yet" come back as unavailable ANSWERS rather than as thrown failures: both are states
	 * a person can act on, and neither is a fault of the request.
	 *
	 * @param assertion  the signed caller identity and scope
	 * @param slug       the pacing's dash_slug
	 * @param sourceId   the stored source's id
	 * @param kind       bindings, aliases or groups
	 * @param dim        the breakdown's key, for aliases and groups
	 * @param label      the canonical value being extended, for aliases
	 * @param unbound    the names that matched no line item, for bindings
	 * @param candidates groupings the screen already guessed
	 * @return the proposal, possibly unavailable with a notice
	 */
	PacingDimSourceSuggestions suggest(
			HubAssertion assertion,
			String slug,
			String sourceId,
			String kind,
			String dim,
			String label,
			List<PacingDimSourceUnboundName> unbound,
			List<String> candidates);
}
