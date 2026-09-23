package com.aidigital.operationalhub.externalservices.pacing;

import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAddableLineItems;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateLineItem;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLineItemPlanUpdate;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDashboardData;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDisplaySaveOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibraryEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibrarySaveOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLikeResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffReport;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshStatus;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRevalidateResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRow;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserMirrorEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingValidateResult;

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
	 * <p>Each row is deserialized into {@link PacingRow} — the subset of Pacing's response the
	 * Overview screen (§4 of the migration plan) needs; see that record for what is left out.
	 *
	 * @param assertion who is calling and what they may see
	 * @return the visible pacings, never {@code null}; empty when the assertion's scope is entitled to
	 * nothing. On a non-2xx response or network failure, throws
	 * {@code PacingExternalException} (unchecked).
	 */
	List<PacingRow> listPacings(HubAssertion assertion);

	/**
	 * Fetches the pacings the given assertion entitles the caller to see whose stored campaign set
	 * contains {@code campaignId} (§5 of the migration plan, "Campaign → Pacings").
	 *
	 * <p>The scope in {@code assertion} still applies: a pacing that covers this campaign but falls
	 * outside the caller's scope is not returned, same as {@link #listPacings}. Row shape (including
	 * each row's full {@code campaigns} list, not just this one) is identical to {@link #listPacings} —
	 * see {@link PacingRow}.
	 *
	 * @param assertion  who is calling and what they may see
	 * @param campaignId the NetSuite campaign id to filter by
	 * @return the visible pacings covering this campaign, never {@code null}
	 */
	List<PacingRow> listPacingsForCampaign(HubAssertion assertion, String campaignId);

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

	/**
	 * Fetches one pacing's full dashboard payload (§6 of the migration plan, US-114/115): campaign
	 * summary, plan by line item, daily delivery facts, the per-pacing widget/layout configuration,
	 * journal, and any shared library entries a linked widget refers to.
	 *
	 * @param assertion who is calling and what they may see
	 * @param slug      the pacing's dash_slug
	 * @return the dashboard payload
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked)
	 */
	PacingDashboardData getDashboardData(HubAssertion assertion, String slug);

	/**
	 * Fetches whether/when a pacing's last data refresh landed (US-119) - a completion read, not an
	 * in-progress flag.
	 *
	 * @param assertion who is calling and what they may see
	 * @param slug      the pacing's dash_slug
	 * @return the refresh status
	 */
	PacingRefreshStatus getRefreshStatus(HubAssertion assertion, String slug);

	/**
	 * Triggers an on-demand data refresh for a Live pacing (US-119). Fire-and-forget on the Pacing side.
	 * A 429 inside the two-minute cooldown is not a failure - it is returned as a
	 * {@link PacingRefreshOutcome} carrying the remaining seconds, not thrown.
	 *
	 * @param assertion who is calling and what they may see
	 * @param pacingId  the pacing id (Pacing's UUID primary key)
	 * @return whether the refresh started, or the remaining cooldown
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on any other non-2xx response or network failure (unchecked) - including the pacing not
	 *         being Live ({@link com.aidigital.operationalhub.externalservices.pacing.exception
	 *         .PacingFailureReason#UPSTREAM_BAD_REQUEST})
	 */
	PacingRefreshOutcome refreshPacing(HubAssertion assertion, String pacingId);

	/**
	 * Fetches a read-only, on-demand, LIVE comparison of one pacing against current NetSuite data (§13
	 * of the migration plan, US-136 "NetSuite Diff and Data Health"): {@code GET
	 * /api/pacings/:id/ns-diff} on the Pacing side. Computed fresh on every call - unlike
	 * {@link #revalidatePacing}, nothing here is written back to the pacing, and unlike
	 * {@link PacingRow#nsDiffSummary()}'s nightly value, nothing here is stale.
	 *
	 * <p>Not admin-gated on the Pacing side: any caller with ordinary dashboard access to this pacing
	 * may call it, unlike {@link #revalidatePacing} which requires an unfiltered scope.
	 *
	 * @param assertion who is calling and what they may see
	 * @param pacingId  the pacing id (Pacing's own UUID primary key)
	 * @return the full diff report
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked)
	 */
	PacingNsDiffReport getNsDiff(HubAssertion assertion, String pacingId);

	/**
	 * Saves this pacing's widget/layout selection (US-116/117/118). A concurrent edit (stale revision,
	 * or a stale Hub writer capability) is returned as a {@link PacingDisplaySaveOutcome} conflict, not
	 * thrown - see that record's javadoc.
	 *
	 * @param assertion  who is calling and what they may see
	 * @param slug       the pacing's dash_slug
	 * @param display    the display patch to save; at minimum {@code { widgets: [...] } }
	 * @param displayRev the revision this save was read at
	 * @param writer     the display grammar this client writes, echoed from the dashboard payload's
	 *                   {@code capabilities}. Required whenever the patch touches a v2 widget;
	 *                   omitting it earns a 409 that reads as "reload the editor"
	 * @return the save outcome
	 */
	PacingDisplaySaveOutcome saveDisplay(
			HubAssertion assertion, String slug, Map<String, Object> display, int displayRev,
			Map<String, Object> writer);

	/**
	 * Browses the shared widget/block/layout library (US-116).
	 *
	 * @param assertion who is calling and what they may see
	 * @param q         free-text search, or null
	 * @param sort      {@code usage} (default) or {@code likes}
	 * @param shelf     {@code mine}, {@code standard}, or null/anything else for the full catalog
	 * @param kind      {@code widget}/{@code block}/{@code layout}, or null for no kind filter
	 * @return the matching entries
	 */
	List<PacingLibraryEntry> listLibrary(HubAssertion assertion, String q, String sort, String shelf, String kind);

	/**
	 * Saves a configured widget/block/layout to the shared library with a name and description
	 * (US-118). A rejected save (validation, a full library, or a stale writer capability) is returned
	 * as a {@link PacingLibrarySaveOutcome}, not thrown, except for a plain structural validation
	 * failure which throws {@code PacingExternalException} with
	 * {@link com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason
	 * #UPSTREAM_BAD_REQUEST}.
	 *
	 * @param assertion   who is calling and what they may see
	 * @param kind        {@code widget}, {@code block} or {@code layout}
	 * @param name        entry display name
	 * @param description entry description, or null
	 * @param definition  the canonical widget/block/layout definition
	 * @return the save outcome
	 */
	PacingLibrarySaveOutcome createLibraryEntry(
			HubAssertion assertion, String kind, String name, String description, Map<String, Object> definition);

	/**
	 * Updates a library widget entry (US-118), guarded by {@code expectedUpdatedAt} - a mismatch is
	 * returned as a {@link PacingLibrarySaveOutcome} conflict, never silently overwritten.
	 *
	 * @param assertion         who is calling and what they may see
	 * @param id                the entry id
	 * @param name              entry display name
	 * @param description       entry description, or null
	 * @param definition        the canonical widget definition
	 * @param expectedUpdatedAt the entry's {@code updatedAt} as last read by the caller
	 * @return the save outcome
	 */
	PacingLibrarySaveOutcome updateLibraryEntry(
			HubAssertion assertion, String id, String name, String description, Map<String, Object> definition,
			String expectedUpdatedAt);

	/**
	 * Soft-deletes a library entry (US-118), guarded by the same {@code expectedUpdatedAt} CAS as
	 * {@link #updateLibraryEntry}.
	 *
	 * @param assertion         who is calling and what they may see
	 * @param id                the entry id
	 * @param expectedUpdatedAt the entry's {@code updatedAt} as last read by the caller
	 * @return the save outcome
	 */
	PacingLibrarySaveOutcome deleteLibraryEntry(HubAssertion assertion, String id, String expectedUpdatedAt);

	/**
	 * Likes or unlikes a library entry (idempotent either way) - US-118.
	 *
	 * @param assertion who is calling and what they may see
	 * @param id        the entry id
	 * @param liked     true to like, false to unlike
	 * @return the entry's like state after the change
	 */
	PacingLikeResult likeLibraryEntry(HubAssertion assertion, String id, boolean liked);

	/**
	 * Fetches a campaign's insertion orders and line items for review before creating a pacing (§8 of
	 * the migration plan, US-121/122/123): {@code POST /api/pacings/validate} on the Pacing side with a
	 * {@code campaign_id} selector. Plan values (target impressions, margin, CTR/VCR) already arrive
	 * pre-filled from NetSuite/the reference tables where available - this client computes none of
	 * them.
	 *
	 * <p>{@code result.ok() == false} is a normal outcome, not a thrown exception: Pacing answers it as
	 * a plain 200 when it can read the campaign but will not let it be paced as it stands today (e.g.
	 * mixed currencies).
	 *
	 * @param assertion  who is calling and whether they may create a pacing
	 * @param campaignId the NetSuite campaign id to validate
	 * @return the validate result, never {@code null}
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked) - including
	 *         {@link com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason
	 *         #UPSTREAM_FORBIDDEN} when the assertion does not carry {@code canCreate}
	 */
	PacingValidateResult validateCampaign(HubAssertion assertion, String campaignId);

	/**
	 * Creates a pacing from selected, reviewed line items (§8 of the migration plan, US-123/124):
	 * {@code POST /api/pacings} on the Pacing side. Every line item's plan values are forwarded exactly
	 * as the caller confirmed them - this client computes, defaults or validates none of them beyond
	 * what Pacing itself enforces.
	 *
	 * @param assertion  who is calling and whether they may create a pacing
	 * @param pacingName display name for the new pacing
	 * @param lineItems  the selected line items; never {@code null}, must be non-empty
	 * @return the new pacing's identifiers
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked) - including
	 *         {@link com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason
	 *         #UPSTREAM_FORBIDDEN} when the assertion does not carry {@code canCreate}, and
	 *         {@link com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason
	 *         #UPSTREAM_USER_NOT_SYNCED} when Pacing does not recognize the current user yet
	 */
	PacingCreateResult createPacing(HubAssertion assertion, String pacingName, List<PacingCreateLineItem> lineItems);

	/**
	 * Saves a pacing's plan (§9 of the migration plan, US-125/126/127): {@code POST
	 * /api/dashboards/:slug/settings} on the Pacing side, carrying only {@code line_items} (never
	 * {@code display}) - the same single write path §6's display save uses, just a different fragment
	 * of the same endpoint. {@code lineItems} is the WHOLE set this pacing should have after the save;
	 * see {@link PacingLineItemPlanUpdate} for what adding/editing/removing a line item means on this
	 * one array. Unlike {@link #saveDisplay}, Pacing carries no revision guard on the plan today, so
	 * there is no conflict outcome to return - a rejection (e.g. an out-of-range coefficient-cost
	 * margin) throws.
	 *
	 * @param assertion who is calling and what they may see
	 * @param slug      the pacing's dash_slug
	 * @param lineItems the whole line-item set to persist
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked) - a structurally invalid plan
	 *         (e.g. {@code bad_coef_config}) is {@link com.aidigital.operationalhub.externalservices
	 *         .pacing.exception.PacingFailureReason#UPSTREAM_BAD_REQUEST} with a human {@code detail}
	 *         naming the line item and field
	 */
	void savePlan(HubAssertion assertion, String slug, List<PacingLineItemPlanUpdate> lineItems);

	/**
	 * Fetches this pacing's own campaign(s)' line items that are not yet on it (§9 of the migration
	 * plan, US-126): {@code GET /api/dashboards/:slug/addable-line-items} on the Pacing side.
	 *
	 * @param assertion who is calling and what they may see
	 * @param slug      the pacing's dash_slug
	 * @return the candidate line items, never {@code null}
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked)
	 */
	PacingAddableLineItems getAddableLineItems(HubAssertion assertion, String slug);

	/**
	 * Looks up line items by id directly (§9 of the migration plan, US-126's add-by-id path), for a
	 * line item the campaign-scoped picker ({@link #getAddableLineItems}) does not offer - including one
	 * from a different campaign than the pacing's own. Calls {@code POST /api/pacings/validate} on the
	 * Pacing side with a {@code line_item_ids} selector, the same endpoint {@link #validateCampaign}
	 * uses with a {@code campaign_id} selector instead - and therefore carries the exact same
	 * {@code canCreate} requirement (§8): a caller without create permission gets
	 * {@link com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason
	 * #UPSTREAM_FORBIDDEN} here too, even though they may otherwise be entitled to edit this pacing's
	 * plan - Pacing's validate endpoint draws no distinction between the two callers.
	 *
	 * @param assertion    who is calling and whether they may create a pacing
	 * @param lineItemIds  the line item ids to look up; never {@code null}, must be non-empty
	 * @return the validate result, never {@code null}
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked)
	 */
	PacingValidateResult validateLineItems(HubAssertion assertion, List<String> lineItemIds);

	/**
	 * Changes a pacing's administrative lifecycle status (§9 of the migration plan, US-128): {@code
	 * PATCH /api/pacings/:id/status} on the Pacing side. Pacing journals the change and fires its own
	 * Slack line; this client adds no logic of its own.
	 *
	 * @param assertion who is calling and what they may see
	 * @param pacingId  the pacing id (Pacing's own UUID primary key)
	 * @param status    {@code Live}, {@code Paused}, {@code Complete} or {@code Archive}
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked)
	 */
	void updateStatus(HubAssertion assertion, String pacingId, String status);

	/**
	 * Reassigns a pacing to another person (§11, US-131): {@code PATCH /api/pacings/:id/owner} on the
	 * Pacing side. Pacing journals who made the change and when, and fires its own Slack line; this
	 * client adds no record of its own.
	 *
	 * <p>Pacing decides whether the move is allowed, from the scope this assertion carries: both the
	 * pacing and the person receiving it must be inside it. A caller that offered the wrong choices
	 * gets a 403 here rather than a silently wrong assignment.
	 *
	 * @param assertion  who is calling and what they may see
	 * @param pacingId   the pacing id (Pacing's own UUID primary key)
	 * @param newOwnerId the recipient's PACING user id - not their Hub id
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked)
	 */
	void transferOwner(HubAssertion assertion, String pacingId, String newOwnerId);

	/**
	 * Permanently deletes a pacing (admin-only pacing administration screen - not in the migration
	 * plan, carried over from the retired Pacing front end's own Admin screen because there is
	 * otherwise no way to remove a mistakenly created pacing): {@code DELETE /api/pacings/:pacingId} on
	 * the Pacing side. Cascades on the Pacing side to {@code access.pacing_journal}, and removes the
	 * dashboard data file and slug directory from disk - irreversible, no soft delete, no undo. This
	 * client adds no confirmation of its own; that lives entirely in the Hub's admin screen.
	 *
	 * @param assertion who is calling - must carry an unfiltered ({@code kind=all}) scope, or Pacing
	 *                  answers 403 {@code admin_only}
	 * @param pacingId  the pacing id (Pacing's own UUID primary key)
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked) - including
	 *         {@link com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason
	 *         #UPSTREAM_FORBIDDEN} when the assertion is not unfiltered, and
	 *         {@link com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason
	 *         #UPSTREAM_NOT_FOUND} when the pacing does not exist
	 */
	void deletePacing(HubAssertion assertion, String pacingId);

	/**
	 * Triggers the full nightly Daily Build off-schedule (same admin screen as {@link #deletePacing}):
	 * {@code POST /api/admin/refresh-all-dashboards} on the Pacing side. Fires the same n8n webhook the
	 * scheduled cron run uses and returns immediately - fire-and-forget, the same shape as
	 * {@link #refreshPacing} but for every Live pacing at once. A 429 inside Pacing's own cooldown is
	 * not a failure, same pattern as {@link #refreshPacing}: it is returned as a
	 * {@link PacingRefreshOutcome} carrying the remaining seconds, not thrown.
	 *
	 * @param assertion who is calling - must carry an unfiltered ({@code kind=all}) scope, or Pacing
	 *                  answers 403 {@code admin_only}
	 * @return whether the build started, or the remaining cooldown
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on any other non-2xx response or network failure (unchecked)
	 */
	PacingRefreshOutcome refreshAllDashboards(HubAssertion assertion);

	/**
	 * Re-pulls a pacing's configuration from the NetSuite master and patches it into the pacing
	 * (same admin screen as {@link #deletePacing}): {@code POST /api/pacings/:pacingId/revalidate} on
	 * the Pacing side. Re-seeds margin, targets, flight dates, channel and - only where the pacing has
	 * none - client/agency, campaigns and currency; the user's own plan is preserved and delivery data
	 * is untouched. A run that finds nothing to change is a normal 200 with
	 * {@link PacingRevalidateResult#changed()} false, not an error.
	 *
	 * @param assertion who is calling - must carry an unfiltered ({@code kind=all}) scope, or Pacing
	 *                  answers 403 {@code admin_only}
	 * @param pacingId  the pacing id (Pacing's own UUID primary key)
	 * @return what the re-pull changed
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked) - including
	 *         {@link com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason
	 *         #UPSTREAM_NOT_FOUND} when the pacing does not exist, and
	 *         {@link com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason
	 *         #UNREACHABLE} when Pacing itself could not reach the NetSuite master (502
	 *         {@code ns_master_error})
	 */
	PacingRevalidateResult revalidatePacing(HubAssertion assertion, String pacingId);
}

