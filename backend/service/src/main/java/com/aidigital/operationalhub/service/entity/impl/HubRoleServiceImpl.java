package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.domain.repository.HubRoleRepository;
import com.aidigital.operationalhub.service.entity.HubRoleService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Default {@link HubRoleService} delegating to {@link HubRoleRepository}.
 */
@Service
@RequiredArgsConstructor
public class HubRoleServiceImpl implements HubRoleService {

	private final HubRoleRepository roleRepository;

	@Override
	public List<HubRole> listActiveOrderedByDisplayName() {
		return roleRepository.findAllByStatusOrderByDisplayNameAsc(HubStatus.ACTIVE.getCode());
	}

	@Override
	public HubRole existingByRoleCode(String roleCode) {
		if (roleCode == null || roleCode.isBlank()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_003);
		}
		return roleRepository
				.findByRoleCode(roleCode)
				.orElseThrow(() -> new BusinessException(OperationalHubErrorReason.OPH_004, roleCode));
	}
}
