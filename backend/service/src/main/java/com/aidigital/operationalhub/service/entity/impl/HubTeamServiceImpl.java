package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEventService;
import com.aidigital.operationalhub.domain.entity.HubTeam;
import com.aidigital.operationalhub.domain.repository.HubTeamRepository;
import com.aidigital.operationalhub.service.entity.HubTeamService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;

/**
 * Default {@link HubTeamService} delegating to {@link HubTeamRepository}.
 */
@Service
@RequiredArgsConstructor
public class HubTeamServiceImpl implements HubTeamService {

	private final HubTeamRepository teamRepository;
	private final CacheInvalidationEventService cacheInvalidationEventService;

	/**
	 * {@inheritDoc}
	 *
	 * <p>Reads the query-cached no-arg {@link HubTeamRepository#findAll()} and sorts in memory (the row
	 * count is tiny) rather than {@code findAll(Sort)}, which has no {@code @QueryHints} and would issue
	 * a fresh, uncached query on every admin team-list load and every sync run.
	 */
	@Override
	@Transactional(readOnly = true)
	public List<HubTeam> listAllOrderedByName() {
		return teamRepository.findAll().stream()
				.sorted(Comparator.comparing(HubTeam::getTeamName, Comparator.nullsLast(String::compareTo)))
				.toList();
	}

	@Override
	@Transactional(readOnly = true)
	public java.util.Optional<HubTeam> findByName(String name) {
		return teamRepository.findByTeamName(name);
	}

	@Override
	@Transactional(readOnly = true)
	public Page<HubTeam> search(String name, int pageNumber, int pageSize) {
		Pageable pageable = PageRequest.of(pageNumber - 1, pageSize, Sort.by(Sort.Direction.ASC, "teamName"));
		return name == null || name.isBlank()
				? teamRepository.findAll(pageable)
				: teamRepository.findByTeamNameContainingIgnoreCase(name.trim(), pageable);
	}

	@Override
	@Transactional
	public HubTeam create(HubTeam team) {
		requireName(team.getTeamName());
		HubTeam saved = teamRepository.save(team);
		cacheInvalidationEventService.publishUpdateEvent(HubTeam.class);
		return saved;
	}

	@Override
	@Transactional
	public HubTeam update(Long teamId, HubTeam team) {
		requireName(team.getTeamName());
		HubTeam existing = teamRepository
				.findById(teamId)
				.orElseThrow(() -> new BusinessException(OperationalHubErrorReason.OPH_021, String.valueOf(teamId)));
		if (existing.isFromNetSuite()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_023);
		}
		existing.setTeamName(team.getTeamName());
		existing.setPodKey(team.getPodKey());
		existing.setStatus(team.getStatus());
		cacheInvalidationEventService.publishUpdateEvent(HubTeam.class);
		return existing;
	}

	@Override
	@Transactional(readOnly = true)
	public boolean existsById(Long teamId) {
		return teamRepository.existsById(teamId);
	}

	@Override
	@Transactional
	public HubTeam saveFromNetSuite(HubTeam team) {
		HubTeam saved = teamRepository.save(team);
		cacheInvalidationEventService.publishUpdateEvent(HubTeam.class);
		return saved;
	}

	/**
	 * Validates that the team name is present.
	 *
	 * @param teamName the name to validate
	 */
	void requireName(String teamName) {
		if (teamName == null || teamName.isBlank()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_022);
		}
	}
}
