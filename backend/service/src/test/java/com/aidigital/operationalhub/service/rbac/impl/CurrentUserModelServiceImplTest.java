package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.exception.AppException;
import com.aidigital.operationalhub.service.rbac.mapper.HubUserMapperImpl;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.instancio.Select.field;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link CurrentUserServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class CurrentUserModelServiceImplTest {

	private static final Long USER_ID = 42L;
	private static final String CLERK_USER_ID = "user_123";
	private static final String EMAIL = "alice@aidigital.com";
	private static final String FULL_NAME = "Alice Aidigital";

	@Mock
	private HubUserService hubUserService;

	@Mock
	private UserProvisioningService userProvisioningService;

	@AfterEach
	void tearDown() {
		SecurityContextHolder.clearContext();
	}

	@Test
	void shouldResolveCurrentUserTest() {
		// Given:
		CurrentUserServiceImpl service = spy(
				new CurrentUserServiceImpl(new HubUserMapperImpl(), hubUserService, userProvisioningService));
		Jwt jwt = Jwt.withTokenValue("token")
				.header("alg", "none")
				.subject(CLERK_USER_ID)
				.claim("user_id", CLERK_USER_ID)
				.claim("email", EMAIL)
				.claim("full_name", FULL_NAME)
				.build();
		CurrentUserModel currentUser = Instancio.of(CurrentUserModel.class)
				.set(field(CurrentUserModel::id), USER_ID)
				.set(field(CurrentUserModel::clerkUserId), CLERK_USER_ID)
				.set(field(CurrentUserModel::email), EMAIL)
				.set(field(CurrentUserModel::displayName), FULL_NAME)
				.create();
		doReturn(jwt).when(service).currentJwt();
		doReturn(currentUser).when(service).findOrCreateByClerkUserId(CLERK_USER_ID, EMAIL, FULL_NAME);

		// When:
		CurrentUserModel result = service.resolveCurrentUser();

		// Then:
		assertThat(result).isEqualTo(currentUser);
		verify(service).findOrCreateByClerkUserId(CLERK_USER_ID, EMAIL, FULL_NAME);
	}

	@Test
	void shouldThrowWhenJwtHasNoUserIdTest() {
		// Given:
		CurrentUserServiceImpl service = spy(
				new CurrentUserServiceImpl(new HubUserMapperImpl(), hubUserService, userProvisioningService));
		Jwt jwt = Jwt.withTokenValue("token")
				.header("alg", "none")
				.subject(CLERK_USER_ID)
				.claim("email", EMAIL)
				.claim("full_name", FULL_NAME)
				.build();
		doReturn(jwt).when(service).currentJwt();

		// When-Then:
		assertThatThrownBy(service::resolveCurrentUser)
				.isInstanceOf(AccessDeniedException.class)
				.hasMessageContaining("user_id");
	}

	@Test
	void shouldReturnExistingUserWhenFindOrCreateByClerkUserIdTest() {
		// Given:
		CurrentUserServiceImpl service = new CurrentUserServiceImpl(
				new HubUserMapperImpl(), hubUserService, userProvisioningService);
		HubUser user = Instancio.of(HubUser.class)
				.set(field(HubUser::getId), USER_ID)
				.set(field(HubUser::getClerkUserId), CLERK_USER_ID)
				.set(field(HubUser::getEmail), EMAIL)
				.set(field(HubUser::getDisplayName), FULL_NAME)
				.set(field(HubUser::getStatus), HubStatus.ACTIVE.getCode())
				.create();
		when(hubUserService.findByClerkUserId(CLERK_USER_ID)).thenReturn(Optional.of(user));

		// When:
		CurrentUserModel result = service.findOrCreateByClerkUserId(CLERK_USER_ID, EMAIL, FULL_NAME);

		// Then:
		assertThat(result.id()).isEqualTo(USER_ID);
		assertThat(result.clerkUserId()).isEqualTo(CLERK_USER_ID);
		assertThat(result.email()).isEqualTo(EMAIL);
		assertThat(result.displayName()).isEqualTo(FULL_NAME);
		assertThat(result.status()).isEqualTo(HubStatus.ACTIVE.getCode());
	}

	@Test
	void shouldDelegateProvisioningOnMissAndMapTheResultTest() {
		// Given: no Clerk-linked user yet; provisioning is delegated to UserProvisioningService
		CurrentUserServiceImpl service = new CurrentUserServiceImpl(
				new HubUserMapperImpl(), hubUserService, userProvisioningService);
		HubUser provisioned = Instancio.of(HubUser.class)
				.set(field(HubUser::getId), USER_ID)
				.set(field(HubUser::getClerkUserId), CLERK_USER_ID)
				.set(field(HubUser::getEmail), EMAIL)
				.set(field(HubUser::getDisplayName), FULL_NAME)
				.set(field(HubUser::getStatus), HubStatus.ACTIVE.getCode())
				.create();
		when(hubUserService.findByClerkUserId(CLERK_USER_ID)).thenReturn(Optional.empty());
		when(userProvisioningService.provisionFromEmployee(CLERK_USER_ID, EMAIL, FULL_NAME))
				.thenReturn(provisioned);

		// When:
		CurrentUserModel result = service.findOrCreateByClerkUserId(CLERK_USER_ID, EMAIL, FULL_NAME);

		// Then:
		assertThat(result.id()).isEqualTo(USER_ID);
		assertThat(result.clerkUserId()).isEqualTo(CLERK_USER_ID);
		assertThat(result.status()).isEqualTo(HubStatus.ACTIVE.getCode());
		verify(userProvisioningService).provisionFromEmployee(CLERK_USER_ID, EMAIL, FULL_NAME);
	}

	@Test
	void shouldThrowWhenClerkUserIdIsBlankTest() {
		// Given:
		CurrentUserServiceImpl service = new CurrentUserServiceImpl(
				new HubUserMapperImpl(), hubUserService, userProvisioningService);

		// When-Then:
		assertThatThrownBy(() -> service.findOrCreateByClerkUserId(" ", EMAIL, FULL_NAME))
				.isInstanceOf(AppException.class)
				.hasMessageContaining("clerkUserId");
	}

	@Test
	void shouldReturnCurrentJwtTest() {
		// Given:
		CurrentUserServiceImpl service = new CurrentUserServiceImpl(
				new HubUserMapperImpl(), hubUserService, userProvisioningService);
		Jwt jwt = Jwt.withTokenValue("token")
				.header("alg", "none")
				.subject(CLERK_USER_ID)
				.build();
		SecurityContextHolder.getContext().setAuthentication(
				UsernamePasswordAuthenticationToken.authenticated(jwt, "n/a", List.of()));

		// When:
		Jwt result = service.currentJwt();

		// Then:
		assertThat(result).isEqualTo(jwt);
	}

	@Test
	void shouldThrowWhenAuthenticationIsMissingTest() {
		// Given:
		CurrentUserServiceImpl service = new CurrentUserServiceImpl(
				new HubUserMapperImpl(), hubUserService, userProvisioningService);

		// When-Then:
		assertThatThrownBy(service::currentJwt)
				.isInstanceOf(AccessDeniedException.class);
	}

	@Test
	void shouldThrowWhenPrincipalIsNotJwtTest() {
		// Given:
		CurrentUserServiceImpl service = new CurrentUserServiceImpl(
				new HubUserMapperImpl(), hubUserService, userProvisioningService);
		SecurityContextHolder.getContext().setAuthentication(
				UsernamePasswordAuthenticationToken.authenticated("principal", "n/a", List.of()));

		// When-Then:
		assertThatThrownBy(service::currentJwt)
				.isInstanceOf(AccessDeniedException.class);
	}
}
