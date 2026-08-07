package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.repository.HubUserRepository;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.search.HubUserField;
import com.aidigital.operationalhub.service.rbac.search.HubUserSearchMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * Default {@link HubUserService} delegating to {@link HubUserRepository}.
 */
@Service
@RequiredArgsConstructor
public class HubUserServiceImpl implements HubUserService {

	private final HubUserRepository userRepository;
	private final HubUserSearchMapper hubUserSearchMapper;

	@Override
	public Page<HubUser> searchUsers(SearchCriteria<HubUserField> criteria) {
		return userRepository.findAll(
				hubUserSearchMapper.toSpecification(criteria), hubUserSearchMapper.toPageable(criteria));
	}

	@Override
	public Optional<HubUser> findByClerkUserId(String clerkUserId) {
		return userRepository.findByClerkUserId(clerkUserId);
	}

	@Override
	public Optional<HubUser> findByEmail(String email) {
		return userRepository.findByEmailIgnoreCase(email);
	}

	@Override
	public HubUser existingByIdForUpdate(Long userId) {
		return userRepository
				.findByIdForUpdate(userId)
				.orElseThrow(() -> new BusinessException(OperationalHubErrorReason.OPH_014, userId));
	}

	@Override
	public HubUser save(HubUser user) {
		return userRepository.save(user);
	}

	@Override
	public List<HubUser> findAllByEmailIgnoreCaseIn(Collection<String> lowerCaseEmails) {
		return userRepository.findAllByEmailIgnoreCaseIn(lowerCaseEmails);
	}
}
