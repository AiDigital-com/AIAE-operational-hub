package com.aidigital.operationalhub.service.campaignshare;

import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareCandidateModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharesModel;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;

import java.util.List;

/**
 * Campaign sharing (2026-10-20): "Add people" on a campaign.
 *
 * <p>A share gives one Hub user, from any team, the campaign and every pacing under it - the same
 * access a team-mate has, with no end date, until it is removed. Who may share: anyone whose OWN scope
 * covers the campaign - an admin, an ALL-scoped role (Directors), or a TEAM-scoped MPO role whose team
 * owns the campaign's agency. A person who sees the campaign only through a share may not share it
 * onward, and Client Services may not share at all.
 */
public interface CampaignShareService {

	/**
	 * Lists who a campaign is shared with, and whether the current user may change that list. The
	 * campaign must be visible to the current user (by their own scope or through a share).
	 *
	 * @param user       the current user
	 * @param campaignId the NetSuite campaign id
	 * @return the shares and the current user's right to edit them
	 */
	CampaignSharesModel listShares(CurrentUserModel user, long campaignId);

	/**
	 * Lists the Hub users a campaign could be shared with: everyone except the current user and those
	 * the campaign is already shared with, narrowed by a name/email search and capped. Requires the
	 * right to share.
	 *
	 * @param user       the current user
	 * @param campaignId the NetSuite campaign id
	 * @param query      a case-insensitive fragment of the name or email; blank lists the first page
	 * @return the matching candidates, by name
	 */
	List<CampaignShareCandidateModel> listCandidates(CurrentUserModel user, long campaignId, String query);

	/**
	 * Shares the campaign with a Hub user. Sharing with someone it is already shared with returns the
	 * existing share unchanged.
	 *
	 * @param user       the current user, who must have the right to share
	 * @param campaignId the NetSuite campaign id
	 * @param hubUserId  the recipient's {@code hub_users.id}
	 * @return the share
	 */
	CampaignShareModel share(CurrentUserModel user, long campaignId, long hubUserId);

	/**
	 * Removes a Hub user's share of the campaign. Removing one that does not exist is a no-op.
	 *
	 * @param user       the current user, who must have the right to share
	 * @param campaignId the NetSuite campaign id
	 * @param hubUserId  the recipient's {@code hub_users.id}
	 */
	void unshare(CurrentUserModel user, long campaignId, long hubUserId);
}
