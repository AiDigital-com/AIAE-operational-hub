package com.aidigital.operationalhub.service.dictionary.impl;

import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.dictionary.HubStatusService;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Default {@link HubStatusService} returning the {@link HubStatus} enum values in declaration order.
 */
@Service
public class HubStatusServiceImpl implements HubStatusService {

	@Override
	public List<HubStatus> listStatuses() {
		return List.of(HubStatus.values());
	}
}
