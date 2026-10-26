package com.aidigital.operationalhub.externalservices.pacing;

import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibrarySaveOutcome;

/**
 * Only me / Team for a library entry on the Pacing side ({@code PUT /api/library/:id/visibility}).
 *
 * <p>Kept apart from {@link PacingClient}: that file is at the 2000 lines this module caps a source
 * file at, and this call shares nothing with it but the transport.
 */
public interface PacingLibraryVisibilityClient {

	/**
	 * Makes an entry private (the author's Mine shelf only) or shared with the team. Pacing lets the
	 * entry's author do it, and an admin (an unfiltered scope); it carries no optimistic-lock stamp
	 * and does not move the entry's {@code updated_at}.
	 *
	 * @param assertion  who is calling and what they may see
	 * @param id         the entry id
	 * @param visibility {@code private} or {@code team}
	 * @return the saved entry, or a {@code v2_writer_required} conflict
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on any other non-2xx answer (not yours, not found, bad value, too fast) or a network
	 *         failure (unchecked)
	 */
	PacingLibrarySaveOutcome setVisibility(HubAssertion assertion, String id, String visibility);
}
