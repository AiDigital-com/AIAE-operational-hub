package com.aidigital.operationalhub.externalservices.pacing;

import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSlackSummarySwitch;

/**
 * The daily Slack summaries switch on the Pacing side ({@code GET|PUT /api/admin/slack-summaries}):
 * one switch for everybody, pressed from the Pacing admin screen. Off means no owner and no delegate
 * gets a summary after any refresh, nightly or manual; on means everything as before.
 *
 * <p>Kept apart from {@link PacingClient}: that file is at the 2000 lines this module caps a source
 * file at, and these two calls share nothing with it but the transport.
 */
public interface PacingSummarySwitchClient {

	/**
	 * Reads the switch.
	 *
	 * @param assertion who is calling - must carry an unfiltered ({@code kind=all}) scope, or Pacing
	 *                  answers 403 {@code admin_only}
	 * @return the switch as Pacing has it stored
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response, an answer without a state, or a network failure (unchecked)
	 */
	PacingSlackSummarySwitch getSwitch(HubAssertion assertion);

	/**
	 * Switches the summaries on or off for everybody. Takes effect from the next refresh.
	 *
	 * @param assertion who is calling - must carry an unfiltered ({@code kind=all}) scope; its email is
	 *                  stored as who pressed it
	 * @param enabled   the new state
	 * @return what Pacing now has stored
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response, an answer without a state, or a network failure (unchecked)
	 */
	PacingSlackSummarySwitch updateSwitch(HubAssertion assertion, boolean enabled);
}
