package com.aidigital.operationalhub.service.campaignshare;

import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareCandidateModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharePacingModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharesModel;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;

import java.util.List;

/**
 * Campaign sharing (2026-10-20): "Add people" on a campaign.
 *
 * <p>A share gives one Hub user, from any team, the campaign and every pacing under it - the same
 * access a team-mate has, with no end date, until it is removed. Who may share: anyone whose OWN scope
 * covers the campaign - an admin, an ALL-scoped role, or a TEAM-scoped MPO role (a Director's included)
 * whose team owns the campaign's agency. A person who sees the campaign only through a share may not
 * share it onward, and Client Services may not share at all. Who may be added: active MPO people only
 * (2026-10-23, {@code MpoDepartmentPolicy}) - refused here, not merely hidden from the picker.
 *
 * <p>Owning a pacing on a campaign puts the owner on its people list automatically
 * ({@link CampaignShareAutoGrantService}); removing such a person hands their pacings to the remover
 * first - see {@link #unshare}.
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
	 * Lists the Hub users a campaign could be shared with: every active MPO person except the current
	 * user and those the campaign is already shared with, narrowed by a name/email search and capped.
	 * Requires the right to share.
	 *
	 * @param user       the current user
	 * @param campaignId the NetSuite campaign id
	 * @param query      a case-insensitive fragment of the name or email; blank lists the first page
	 * @return the matching candidates, by name
	 */
	List<CampaignShareCandidateModel> listCandidates(CurrentUserModel user, long campaignId, String query);

	/**
	 * Shares the campaign with a Hub user. Sharing with someone it is already shared with returns the
	 * existing share unchanged. The recipient must be a current MPO person.
	 *
	 * @param user       the current user, who must have the right to share
	 * @param campaignId the NetSuite campaign id
	 * @param hubUserId  the recipient's {@code hub_users.id}
	 * @return the share
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException {@code OPH_068} when the
	 *         recipient is no longer in Rippling, {@code OPH_069} when they are outside MPO
	 */
	CampaignShareModel share(CurrentUserModel user, long campaignId, long hubUserId);

	/**
	 * Lists the pacings a person on the campaign owns that touch it - what removing them would hand
	 * to the remover. Requires the right to share. Empty when they own none, or when Pacing does not
	 * know them yet.
	 *
	 * @param user       the current user
	 * @param campaignId the NetSuite campaign id
	 * @param hubUserId  the person's {@code hub_users.id}
	 * @return their pacings on this campaign, by name
	 */
	List<CampaignSharePacingModel> listOwnedPacings(CurrentUserModel user, long campaignId, long hubUserId);

	/**
	 * Removes a Hub user's share of the campaign. Removing one that does not exist is a no-op.
	 *
	 * <p>When the person owns pacings touching the campaign, each is transferred whole to the current
	 * user FIRST - through Pacing's system route, since the person is usually outside the remover's
	 * scope - and only then is the share deleted; the remover then holds those pacings' campaigns on
	 * their own people lists ({@link CampaignShareAutoGrantService}). Without
	 * {@code transferPacings} that case is refused with the count, so the UI can show the list and ask.
	 * A failed transfer leaves the share in place.
	 *
	 * @param user            the current user, who must have the right to share
	 * @param campaignId      the NetSuite campaign id
	 * @param hubUserId       the recipient's {@code hub_users.id}
	 * @param transferPacings whether the current user has confirmed taking over the person's pacings
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException {@code OPH_070} when the
	 *         person owns pacings and the transfer was not confirmed, {@code OPH_071} when the current
	 *         user has no Pacing account to receive them
	 */
	void unshare(CurrentUserModel user, long campaignId, long hubUserId, boolean transferPacings);
}
