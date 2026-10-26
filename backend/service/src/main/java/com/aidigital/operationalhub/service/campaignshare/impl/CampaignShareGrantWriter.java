package com.aidigital.operationalhub.service.campaignshare.impl;

import com.aidigital.operationalhub.domain.entity.HubCampaignShare;
import com.aidigital.operationalhub.domain.enums.CampaignShareSource;
import com.aidigital.operationalhub.service.entity.HubCampaignShareService;
import com.aidigital.operationalhub.service.rbac.AgencyVisibilityService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;

/**
 * Writes the automatic shares: one row per (campaign, recipient) that does not exist yet, in one
 * transaction, evicting the recipient's cached visibility once - the same discipline a manual share
 * follows. A separate bean from {@link CampaignShareAutoGrantServiceImpl} so the annotations apply
 * through the proxy (a self-call would bypass them).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CampaignShareGrantWriter {

	private final HubCampaignShareService hubCampaignShareService;

	/**
	 * Grants the recipient the given campaigns, skipping every one they already hold - whatever its
	 * source - so a manual share is never overwritten and nothing is ever duplicated.
	 *
	 * @param actorUserId     who is granting ({@code hub_users.id}), stored as {@code granted_by_user_id}
	 * @param recipientUserId who receives ({@code hub_users.id})
	 * @param campaignIds     the NetSuite campaign ids
	 * @param source          what the new rows record as their origin
	 * @return how many rows were created
	 */
	@Transactional
	@CacheEvict(cacheNames = AgencyVisibilityService.AGENCY_VISIBILITY_CACHE, key = "#recipientUserId")
	public int grant(Long actorUserId, Long recipientUserId, Collection<Long> campaignIds, CampaignShareSource source) {
		int created = 0;
		for (Long campaignId : campaignIds) {
			if (hubCampaignShareService.findByCampaignIdAndUserId(campaignId, recipientUserId).isPresent()) {
				continue;
			}
			HubCampaignShare share = new HubCampaignShare();
			share.setCampaignId(campaignId);
			share.setUserId(recipientUserId);
			share.setGrantedByUserId(actorUserId);
			share.setSource(source.getCode());
			hubCampaignShareService.save(share);
			created++;
		}
		if (created > 0) {
			log.info("Campaign shares granted: toUserId={}, byUserId={}, source={}, created={}",
					recipientUserId, actorUserId, source.getCode(), created);
		}
		return created;
	}
}
