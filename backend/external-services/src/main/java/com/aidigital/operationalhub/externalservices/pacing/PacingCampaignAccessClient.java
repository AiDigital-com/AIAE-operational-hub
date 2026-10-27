package com.aidigital.operationalhub.externalservices.pacing;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignPacing;

import java.util.List;

/**
 * The campaign-access half of Pacing's system API (2026-10-23): which campaigns carry a pacing, which
 * pacings a person owns on a campaign, and a transfer the Hub orders on its own authority. Every call
 * signs a SYSTEM assertion ({@link
 * com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner#signSystem()}),
 * like the employee sync: these are decisions the Hub has already made - a team's Pacing scope, who
 * owns a campaign's agency - and Pacing applies them.
 *
 * <p>Kept apart from {@link PacingClient}: that file is at the file-length cap, and these four calls
 * share nothing with it but the transport.
 */
public interface PacingCampaignAccessClient {

	/**
	 * Every NetSuite campaign id at least one pacing covers ({@code GET
	 * /api/internal/campaigns-with-pacings}). One small list for the whole fleet, meant to be cached
	 * and intersected locally with a team's campaigns.
	 *
	 * @return the campaign ids, as text, never {@code null}
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked)
	 */
	List<String> listCampaignIdsWithPacings();

	/**
	 * The pacings covering one campaign, optionally only those one owner holds ({@code GET
	 * /api/internal/campaign-pacings}).
	 *
	 * @param campaignId        the NetSuite campaign id, as text
	 * @param ownerPacingUserId the owner's Pacing user id to narrow to, or {@code null} for every owner
	 * @return the pacings, never {@code null}
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked)
	 */
	List<PacingCampaignPacing> listPacingsOnCampaign(String campaignId, String ownerPacingUserId);

	/**
	 * One pacing with the campaigns it covers ({@code GET /api/internal/pacings/:id}).
	 *
	 * @param pacingId the pacing id (Pacing's own UUID primary key)
	 * @return the pacing
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked) -
	 *         {@link com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason
	 *         #UPSTREAM_NOT_FOUND} when there is no such pacing
	 */
	PacingCampaignPacing getPacing(String pacingId);

	/**
	 * Reassigns a pacing on the Hub's authority ({@code POST /api/internal/pacings/:id/owner}), with no
	 * scope check on the Pacing side - the user route refuses to move a pacing whose owner the caller
	 * cannot see, which is exactly the case when somebody is removed from a campaign. Pacing journals
	 * the change under {@code actorEmail} and fires its Slack line exactly as for a user transfer.
	 *
	 * @param pacingId          the pacing id (Pacing's own UUID primary key)
	 * @param newOwnerPacingUserId the recipient's Pacing user id
	 * @param actorEmail        the Hub user ordering the transfer; must exist in Pacing's user mirror
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on a non-2xx response or network failure (unchecked) -
	 *         {@link com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason
	 *         #UPSTREAM_USER_NOT_SYNCED} when Pacing does not know the actor,
	 *         {@link com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason
	 *         #UPSTREAM_NOT_FOUND} when the pacing or the recipient does not exist
	 */
	void transferOwnerAsSystem(String pacingId, String newOwnerPacingUserId, String actorEmail);
}
