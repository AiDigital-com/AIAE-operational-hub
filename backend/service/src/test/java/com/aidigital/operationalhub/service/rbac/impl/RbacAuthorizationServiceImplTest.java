package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.access.AccessDeniedException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.instancio.Select.field;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link RbacAuthorizationServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class RbacAuthorizationServiceImplTest {

	private static final Long USER_ID = 42L;
	private static final String CLERK_ID = "user_clerk_42";

	@Mock
	private RbacQueryService rbacQueryService;

	@Test
	void shouldRequireAdminTest() {
		// Given:
		RbacAuthorizationServiceImpl service = spy(new RbacAuthorizationServiceImpl(rbacQueryService));
		CurrentUserModel user = Instancio.of(CurrentUserModel.class)
				.set(field(CurrentUserModel::id), USER_ID)
				.set(field(CurrentUserModel::clerkUserId), CLERK_ID)
				.create();
		EffectiveAccessContext access = Instancio.of(EffectiveAccessContext.class)
				.set(field(EffectiveAccessContext::admin), true)
				.create();
		doReturn(access).when(service).effectiveAccess(user);

		// When-Then:
		assertThatCode(() -> service.requireAdmin(user)).doesNotThrowAnyException();
	}

	@Test
	void shouldThrowWhenUserIsNotAdminTest() {
		// Given:
		RbacAuthorizationServiceImpl service = spy(new RbacAuthorizationServiceImpl(rbacQueryService));
		CurrentUserModel user = Instancio.of(CurrentUserModel.class)
				.set(field(CurrentUserModel::id), USER_ID)
				.set(field(CurrentUserModel::clerkUserId), CLERK_ID)
				.create();
		EffectiveAccessContext access = Instancio.of(EffectiveAccessContext.class)
				.set(field(EffectiveAccessContext::admin), false)
				.create();
		doReturn(access).when(service).effectiveAccess(user);

		// When-Then:
		assertThatThrownBy(() -> service.requireAdmin(user))
				.isInstanceOf(AccessDeniedException.class);
	}

	@Test
	void shouldRequireCanManageRolesTest() {
		// Given:
		RbacAuthorizationServiceImpl service = spy(new RbacAuthorizationServiceImpl(rbacQueryService));
		CurrentUserModel user = Instancio.of(CurrentUserModel.class)
				.set(field(CurrentUserModel::id), USER_ID)
				.set(field(CurrentUserModel::clerkUserId), CLERK_ID)
				.create();
		EffectiveAccessContext access = Instancio.of(EffectiveAccessContext.class)
				.set(field(EffectiveAccessContext::canManageRoles), true)
				.create();
		doReturn(access).when(service).effectiveAccess(user);

		// When-Then:
		assertThatCode(() -> service.requireCanManageRoles(user)).doesNotThrowAnyException();
	}

	@Test
	void shouldThrowWhenUserCannotManageRolesTest() {
		// Given:
		RbacAuthorizationServiceImpl service = spy(new RbacAuthorizationServiceImpl(rbacQueryService));
		CurrentUserModel user = Instancio.of(CurrentUserModel.class)
				.set(field(CurrentUserModel::id), USER_ID)
				.set(field(CurrentUserModel::clerkUserId), CLERK_ID)
				.create();
		EffectiveAccessContext access = Instancio.of(EffectiveAccessContext.class)
				.set(field(EffectiveAccessContext::canManageRoles), false)
				.create();
		doReturn(access).when(service).effectiveAccess(user);

		// When-Then:
		assertThatThrownBy(() -> service.requireCanManageRoles(user))
				.isInstanceOf(AccessDeniedException.class);
	}

	@Test
	void shouldReturnTrueWhenCanViewAllCompaniesForActiveUserTest() {
		// Given:
		RbacAuthorizationServiceImpl service = new RbacAuthorizationServiceImpl(rbacQueryService);
		CurrentUserModel user = Instancio.of(CurrentUserModel.class)
				.set(field(CurrentUserModel::status), HubStatus.ACTIVE.getCode())
				.create();

		// When:
		boolean result = service.canViewAllCompanies(user);

		// Then:
		assertThat(result).isTrue();
	}

	@Test
	void shouldReturnFalseWhenCanViewAllCompaniesForDisabledUserTest() {
		// Given:
		RbacAuthorizationServiceImpl service = new RbacAuthorizationServiceImpl(rbacQueryService);
		CurrentUserModel user = Instancio.of(CurrentUserModel.class)
				.set(field(CurrentUserModel::status), HubStatus.DISABLED.getCode())
				.create();

		// When:
		boolean result = service.canViewAllCompanies(user);

		// Then:
		assertThat(result).isFalse();
	}

	@Test
	void shouldReturnFalseWhenCanViewAllCompaniesForNullUserTest() {
		// Given:
		RbacAuthorizationServiceImpl service = new RbacAuthorizationServiceImpl(rbacQueryService);

		// When:
		boolean result = service.canViewAllCompanies(null);

		// Then:
		assertThat(result).isFalse();
	}

	@Test
	void shouldRequireCanViewCompanyTest() {
		// Given:
		RbacAuthorizationServiceImpl service = spy(new RbacAuthorizationServiceImpl(rbacQueryService));
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		Long companyId = Instancio.create(Long.class);
		doReturn(true).when(service).canViewAllCompanies(user);

		// When-Then:
		assertThatCode(() -> service.requireCanViewCompany(user, companyId)).doesNotThrowAnyException();
	}

	@Test
	void shouldThrowWhenCannotViewCompanyTest() {
		// Given:
		RbacAuthorizationServiceImpl service = spy(new RbacAuthorizationServiceImpl(rbacQueryService));
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		Long companyId = Instancio.create(Long.class);
		doReturn(false).when(service).canViewAllCompanies(user);

		// When-Then:
		assertThatThrownBy(() -> service.requireCanViewCompany(user, companyId))
				.isInstanceOf(AccessDeniedException.class);
	}

	@Test
	void shouldReturnEffectiveAccessTest() {
		// Given:
		RbacAuthorizationServiceImpl service = new RbacAuthorizationServiceImpl(rbacQueryService);
		CurrentUserModel user = Instancio.of(CurrentUserModel.class)
				.set(field(CurrentUserModel::id), USER_ID)
				.set(field(CurrentUserModel::clerkUserId), CLERK_ID)
				.create();
		EffectiveAccessContext access = Instancio.of(EffectiveAccessContext.class)
				.set(field(EffectiveAccessContext::clerkUserId), CLERK_ID)
				.set(field(EffectiveAccessContext::userId), USER_ID)
				.create();
		when(rbacQueryService.getEffectiveAccess(CLERK_ID)).thenReturn(access);

		// When:
		EffectiveAccessContext result = service.effectiveAccess(user);

		// Then:
		assertThat(result).isEqualTo(access);
	}

	@Test
	void shouldThrowWhenEffectiveAccessUserIsNullTest() {
		// Given:
		RbacAuthorizationServiceImpl service = new RbacAuthorizationServiceImpl(rbacQueryService);

		// When-Then:
		assertThatThrownBy(() -> service.effectiveAccess(null))
				.isInstanceOf(AccessDeniedException.class);
	}
}
