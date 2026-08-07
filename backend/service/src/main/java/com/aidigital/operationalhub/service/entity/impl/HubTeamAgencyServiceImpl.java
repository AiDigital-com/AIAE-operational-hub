package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.domain.entity.HubTeamAgency;
import com.aidigital.operationalhub.domain.repository.HubTeamAgencyRepository;
import com.aidigital.operationalhub.service.entity.HubTeamAgencyService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;

/**
 * Default {@link HubTeamAgencyService} delegating to {@link HubTeamAgencyRepository}.
 */
@Service
@RequiredArgsConstructor
public class HubTeamAgencyServiceImpl implements HubTeamAgencyService {

	private final HubTeamAgencyRepository teamAgencyRepository;

	@Override
	@Transactional(readOnly = true)
	public List<HubTeamAgency> findAll() {
		return teamAgencyRepository.findAll();
	}

	@Override
	@Transactional(readOnly = true)
	public List<Long> findAgencyIdsByTeamIdIn(Collection<Long> teamIds) {
		if (teamIds.isEmpty()) {
			return List.of();
		}
		return teamAgencyRepository.findByTeamIdIn(teamIds).stream()
				.map(HubTeamAgency::getAgencyId)
				.distinct()
				.toList();
	}

	@Override
	@Transactional
	public HubTeamAgency save(HubTeamAgency mapping) {
		return teamAgencyRepository.save(mapping);
	}

	@Override
	@Transactional
	public void deleteAll(Collection<HubTeamAgency> mappings) {
		teamAgencyRepository.deleteAll(mappings);
	}
}
