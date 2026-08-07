package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.exception.AppException;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.enums.ClerkJwtClaim;
import com.aidigital.operationalhub.service.rbac.mapper.HubUserMapper;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

/**
 * Default {@link CurrentUserService} backed by the Spring Security context and {@code hub_users}.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CurrentUserServiceImpl implements CurrentUserService {

	private final HubUserMapper hubUserMapper;
	private final HubUserService hubUserService;
	private final UserProvisioningService userProvisioningService;

	/**
	 * {@inheritDoc}
	 *
	 * <p>Opens no transaction of its own: the dominant path is a single cached read
	 * ({@link HubUserService#findByClerkUserId}), and the rare first-login write is delegated to
	 * {@link UserProvisioningService}, which manages its own transaction.
	 */
	@Override
	public CurrentUserModel resolveCurrentUser() {
		Jwt jwt = currentJwt();
		String clerkUserId = jwt.getClaimAsString(ClerkJwtClaim.USER_ID.getClaimName());
		if (clerkUserId == null || clerkUserId.isBlank()) {
			throw new AccessDeniedException("Authenticated token has no user_id claim.");
		}
		String email = jwt.getClaimAsString(ClerkJwtClaim.EMAIL.getClaimName());
		String displayName = jwt.getClaimAsString(ClerkJwtClaim.FULL_NAME.getClaimName());
		return findOrCreateByClerkUserId(clerkUserId, email, displayName);
	}

	@Override
	public CurrentUserModel findOrCreateByClerkUserId(String clerkUserId, String email, String displayName) {
		if (clerkUserId == null || clerkUserId.isBlank()) {
			throw new AppException("clerkUserId must not be blank.");
		}
		HubUser entity = hubUserService
				.findByClerkUserId(clerkUserId)
				.orElseGet(() -> userProvisioningService.provisionFromEmployee(clerkUserId, email, displayName));
		return hubUserMapper.toCurrentUserModel(entity);
	}

	/**
	 * Extracts the authenticated Clerk JWT from the current security context.
	 *
	 * @return the authenticated Clerk JWT
	 * @throws AccessDeniedException if there is no authenticated JWT principal in the context
	 */
	Jwt currentJwt() {
		Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
		if (authentication == null || !authentication.isAuthenticated()) {
			throw new AccessDeniedException("No authenticated Clerk JWT in the security context.");
		}
		Object principal = authentication.getPrincipal();
		if (principal instanceof Jwt jwt) {
			return jwt;
		}
		throw new AccessDeniedException("Authenticated principal is not a Clerk JWT.");
	}
}
