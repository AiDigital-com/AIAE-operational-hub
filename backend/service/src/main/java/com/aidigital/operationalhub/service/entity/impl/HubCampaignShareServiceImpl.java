package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.domain.entity.HubCampaignShare;
import com.aidigital.operationalhub.domain.repository.HubCampaignShareRepository;
import com.aidigital.operationalhub.service.entity.HubCampaignShareService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

/**
 * Default {@link HubCampaignShareService} delegating to {@link HubCampaignShareRepository}.
 */
@Service
@RequiredArgsConstructor
public class HubCampaignShareServiceImpl implements HubCampaignShareService {

	private final HubCampaignShareRepository campaignShareRepository;

	@Override
	@Transactional(readOnly = true)
	public List<HubCampaignShare> findByCampaignId(Long campaignId) {
		return campaignShareRepository.findByCampaignIdOrderByCreatedAtAsc(campaignId);
	}

	@Override
	@Transactional(readOnly = true)
	public List<Long> findCampaignIdsByUserId(Long userId) {
		if (userId == null) {
			return List.of();
		}
		return campaignShareRepository.findByUserId(userId).stream()
				.map(HubCampaignShare::getCampaignId)
				.distinct()
				.toList();
	}

	@Override
	@Transactional(readOnly = true)
	public Optional<HubCampaignShare> findByCampaignIdAndUserId(Long campaignId, Long userId) {
		return campaignShareRepository.findByCampaignIdAndUserId(campaignId, userId);
	}

	@Override
	@Transactional
	public HubCampaignShare save(HubCampaignShare share) {
		return campaignShareRepository.save(share);
	}

	@Override
	@Transactional
	public void delete(HubCampaignShare share) {
		campaignShareRepository.delete(share);
	}
}
