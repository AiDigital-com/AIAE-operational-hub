package com.aidigital.operationalhub.externalservices.pacing;

import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserMirrorEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncResult;

import java.util.List;
import java.util.Map;

/**
 * Narrow application-facing interface for the Pacing service's read API.
 *
 * <p>The Hub does not resolve or apply any filtering of its own here: {@code assertion} already
 * carries the scope decision (see {@code PacingScopeResolver}), and Pacing applies it server-side.
 * This client only signs the assertion, calls Pacing, and returns what it said.
 *
 * @see com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
 */
public interface PacingClient {

	/**
	 * Fetches the pacings the given assertion entitles the caller to see.
	 *
	 * <p>Each row is returned exactly as Pacing sent it (column name to value); the Hub does not yet
	 * interpret individual pacing fields.
	 *
	 * @param assertion who is calling and what they may see
	 * @return the visible pacings, never {@code null}; empty when the assertion's scope is entitled to
	 * nothing. On a non-2xx response or network failure, throws
	 * {@code PacingExternalException} (unchecked).
	 */
	List<Map<String, Object>> listPacings(HubAssertion assertion);

	/**
	 * Batch-upserts Hub employees into Pacing's user mirror ({@code POST /api/internal/users/sync}, §2
	 * of the migration plan). Signs a SYSTEM assertion ({@link
	 * com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner#signSystem()})
	 * rather than a per-user one: this call has no acting user, and on a fresh database there is nobody
	 * in Pacing's {@code access.users} yet to assert as one.
	 *
	 * <p>Safe to retry: the endpoint upserts by email (matched case-insensitively, enforced by a unique
	 * index on the Pacing side), so re-sending the same batch after a timeout can only re-apply the same
	 * rows, never create a duplicate.
	 *
	 * @param users the employees to sync; never {@code null}, may be empty
	 * @return the assigned/matched {@code user_id}s plus Pacing's own account of what the upsert did
	 *         (see {@link PacingUserSyncResult})
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked)
	 */
	PacingUserSyncResult syncUsers(List<PacingUserSyncEntry> users);

	/**
	 * Fetches every row of Pacing's user mirror ({@code GET /api/internal/users}), for the Hub's US-106
	 * drift report (§2 of the migration plan). Signs a SYSTEM assertion, the same as {@link
	 * #syncUsers}: this is a system-to-system read, not something done on behalf of a logged-in user.
	 *
	 * @return every user Pacing knows about, never {@code null}
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked)
	 */
	List<PacingUserMirrorEntry> listUsers();
}
