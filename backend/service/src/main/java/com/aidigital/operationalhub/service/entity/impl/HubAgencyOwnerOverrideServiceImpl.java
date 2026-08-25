package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.domain.entity.HubAgencyOwnerOverride;
import com.aidigital.operationalhub.domain.repository.HubAgencyOwnerOverrideRepository;
import com.aidigital.operationalhub.service.entity.HubAgencyOwnerOverrideService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Default {@link HubAgencyOwnerOverrideService} delegating to {@link HubAgencyOwnerOverrideRepository}.
 */
@Service
@RequiredArgsConstructor
public class HubAgencyOwnerOverrideServiceImpl implements HubAgencyOwnerOverrideService {

	private final HubAgencyOwnerOverrideRepository agencyOwnerOverrideRepository;

	@Override
	@Transactional(readOnly = true)
	public List<HubAgencyOwnerOverride> findAllByStatus(String status) {
		return agencyOwnerOverrideRepository.findAllByStatus(status);
	}
}
