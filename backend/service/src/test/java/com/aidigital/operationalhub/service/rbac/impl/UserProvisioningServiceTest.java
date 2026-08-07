package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.instancio.Select.field;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link UserProvisioningService}.
 */
@ExtendWith(MockitoExtension.class)
class UserProvisioningServiceTest {

	private static final String CLERK_USER_ID = "user_123";
	private static final String EMAIL = "alice@aidigital.com";
	private static final String FULL_NAME = "Alice Aidigital";

	@Mock
	private HubUserService hubUserService;

	@InjectMocks
	private UserProvisioningService service;

	@Test
	void shouldLinkSyncedEmployeeOnFirstLoginTest() {
		// Given: a synced employee row exists by email, deactivated and not yet linked to a Clerk identity
		HubUser employee = Instancio.of(HubUser.class)
				.set(field(HubUser::getClerkUserId), null)
				.set(field(HubUser::getEmail), EMAIL)
				.set(field(HubUser::getDisplayName), FULL_NAME)
				.set(field(HubUser::getStatus), HubStatus.INACTIVE.getCode())
				.create();
		ArgumentCaptor<HubUser> userCaptor = ArgumentCaptor.forClass(HubUser.class);
		when(hubUserService.findByEmail(EMAIL)).thenReturn(Optional.of(employee));
		when(hubUserService.save(userCaptor.capture())).thenAnswer(invocation -> invocation.getArgument(0));

		// When:
		HubUser result = service.provisionFromEmployee(CLERK_USER_ID, EMAIL, FULL_NAME);

		// Then: the matched row is stamped with the Clerk id and activated
		assertThat(userCaptor.getValue().getClerkUserId()).isEqualTo(CLERK_USER_ID);
		assertThat(userCaptor.getValue().getStatus()).isEqualTo(HubStatus.ACTIVE.getCode());
		assertThat(userCaptor.getValue().getDisplayName()).isEqualTo(FULL_NAME);
		assertThat(result.getClerkUserId()).isEqualTo(CLERK_USER_ID);
		assertThat(result.getStatus()).isEqualTo(HubStatus.ACTIVE.getCode());
	}

	@Test
	void shouldRejectLoginWhenEmailIsNotASyncedEmployeeTest() {
		// Given: no synced employee matches the authenticated email
		when(hubUserService.findByEmail(EMAIL)).thenReturn(Optional.empty());

		// When-Then:
		assertThatThrownBy(() -> service.provisionFromEmployee(CLERK_USER_ID, EMAIL, FULL_NAME))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("registered employee");
	}

	@Test
	void shouldRejectLoginWhenEmailClaimIsMissingTest() {
		// When-Then:
		assertThatThrownBy(() -> service.provisionFromEmployee(CLERK_USER_ID, null, FULL_NAME))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("registered employee");
	}

	@Test
	void shouldRejectLoginWhenEmployeeAlreadyLinkedToAnotherIdentityTest() {
		// Given: the matched employee is already linked to a different Clerk identity
		HubUser employee = Instancio.of(HubUser.class)
				.set(field(HubUser::getClerkUserId), "user_other")
				.set(field(HubUser::getEmail), EMAIL)
				.create();
		when(hubUserService.findByEmail(EMAIL)).thenReturn(Optional.of(employee));

		// When-Then:
		assertThatThrownBy(() -> service.provisionFromEmployee(CLERK_USER_ID, EMAIL, FULL_NAME))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("registered employee");
	}
}
