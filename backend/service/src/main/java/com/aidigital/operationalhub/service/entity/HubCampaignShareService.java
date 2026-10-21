package com.aidigital.operationalhub.service.entity;

import com.aidigital.operationalhub.domain.entity.HubCampaignShare;

import java.util.List;
import java.util.Optional;

/**
 * Single gateway to the {@code hub_campaign_shares} entity and its repository.
 *
 * <p>Per the "one entity, one repository, one service" rule, this is the only collaborator that
 * touches {@code HubCampaignShareRepository}; other services depend on this contract instead of the
 * repository.
 */
public interface HubCampaignShareService {

	/**
	 * Returns every share of one campaign, oldest first.
	 *
	 * @param campaignId the NetSuite campaign id
	 * @return the campaign's shares, oldest first
	 */
	List<HubCampaignShare> findByCampaignId(Long campaignId);

	/**
	 * Returns the distinct NetSuite campaign ids shared with one user.
	 *
	 * @param userId the {@code hub_users.id}
	 * @return the shared campaign ids, in no guaranteed order
	 */
	List<Long> findCampaignIdsByUserId(Long userId);

	/**
	 * Returns the share of a campaign with a user, if any.
	 *
	 * @param campaignId the NetSuite campaign id
	 * @param userId     the {@code hub_users.id}
	 * @return the share, or empty when the campaign is not shared with that user
	 */
	Optional<HubCampaignShare> findByCampaignIdAndUserId(Long campaignId, Long userId);

	/**
	 * Persists the given share.
	 *
	 * @param share the share to save
	 * @return the saved share
	 */
	HubCampaignShare save(HubCampaignShare share);

	/**
	 * Deletes the given share.
	 *
	 * @param share the share to delete
	 */
	void delete(HubCampaignShare share);
}
