package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.entity.HubCampaignShare;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * Spring Data repository for {@link HubCampaignShare} ({@code hub_campaign_shares}).
 */
public interface HubCampaignShareRepository extends JpaRepository<HubCampaignShare, Long> {

	/**
	 * Returns every share of one campaign, oldest first - the order the "people" list on the campaign
	 * shows them in.
	 *
	 * @param campaignId the NetSuite campaign id
	 * @return the campaign's shares, oldest first
	 */
	List<HubCampaignShare> findByCampaignIdOrderByCreatedAtAsc(Long campaignId);

	/**
	 * Returns every campaign shared with one user, for resolving that user's visibility.
	 *
	 * @param userId the {@code hub_users.id}
	 * @return the user's shares, in no guaranteed order
	 */
	List<HubCampaignShare> findByUserId(Long userId);

	/**
	 * Returns the one share of a campaign with a user, if any ({@code UNIQUE (campaign_id, user_id)}).
	 *
	 * @param campaignId the NetSuite campaign id
	 * @param userId     the {@code hub_users.id}
	 * @return the share, or empty when the campaign is not shared with that user
	 */
	Optional<HubCampaignShare> findByCampaignIdAndUserId(Long campaignId, Long userId);
}
