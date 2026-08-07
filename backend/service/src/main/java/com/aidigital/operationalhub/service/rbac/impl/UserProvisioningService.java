package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Collaborator that links an authenticated Clerk identity to its synced employee row, on first
 * login.
 *
 * <p>Kept as a separate bean from {@link CurrentUserServiceImpl} rather than a method on it, so
 * this write transaction opens only on the rare provisioning-miss path: the dominant lookup path
 * runs with no explicit transaction of its own (see {@link CurrentUserServiceImpl}), and a
 * self-invoked call from there would bypass Spring's transactional proxy.
 */
@Component
@RequiredArgsConstructor
public class UserProvisioningService {

	private final HubUserService hubUserService;

	/**
	 * Links the authenticated Clerk identity to the synced employee matched by email, on first login:
	 * stamps the Clerk id and activates the (until-now deactivated) row. Logins that do not match a
	 * synced employee are rejected, since Hub users are provisioned only by the NetSuite/Rippling sync.
	 *
	 * @param clerkUserId the Clerk subject id to stamp on the matched row
	 * @param email       the email claim to match against synced employees
	 * @param displayName the display-name claim, used only to backfill a missing name
	 * @return the linked, activated Hub user
	 * @throws BusinessException if no synced employee matches, or the match is already linked to another identity
	 */
	@Transactional
	public HubUser provisionFromEmployee(String clerkUserId, String email, String displayName) {
		if (email == null || email.isBlank()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_024);
		}
		HubUser employee = hubUserService
				.findByEmail(email)
				.orElseThrow(() -> new BusinessException(OperationalHubErrorReason.OPH_024));
		String existingClerkId = employee.getClerkUserId();
		if (existingClerkId != null && !existingClerkId.isBlank() && !existingClerkId.equals(clerkUserId)) {
			throw new BusinessException(OperationalHubErrorReason.OPH_024);
		}
		employee.setClerkUserId(clerkUserId);
		employee.setStatus(HubStatus.ACTIVE.getCode());
		if ((employee.getDisplayName() == null || employee.getDisplayName().isBlank()) && displayName != null) {
			employee.setDisplayName(displayName);
		}
		return hubUserService.save(employee);
	}
}
