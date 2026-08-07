package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.domain.entity.HubScopeType;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.domain.repository.HubScopeTypeRepository;
import com.aidigital.operationalhub.service.entity.HubScopeTypeService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Default {@link HubScopeTypeService} delegating to {@link HubScopeTypeRepository}.
 */
@Service
@RequiredArgsConstructor
public class HubScopeTypeServiceImpl implements HubScopeTypeService {

	private final HubScopeTypeRepository scopeTypeRepository;

	@Override
	public List<HubScopeType> listActiveOrderedByDisplayName() {
		return scopeTypeRepository.findAllByStatusOrderByDisplayNameAsc(HubStatus.ACTIVE.getCode());
	}

	@Override
	public HubScopeType existingByScopeCode(String scopeCode) {
		if (scopeCode == null || scopeCode.isBlank()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_005);
		}
		return scopeTypeRepository
				.findByScopeCode(scopeCode)
				.orElseThrow(() -> new BusinessException(OperationalHubErrorReason.OPH_006, scopeCode));
	}
}
