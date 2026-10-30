package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.UserV1;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link UserContractMapper}.
 */
@ExtendWith(MockitoExtension.class)
class UserContractMapperTest {

	@Spy
	private RoleAssignmentContractMapperImpl roleAssignmentContractMapper;

	@InjectMocks
	private UserContractMapperImpl mapper;

	@Test
	void shouldMapUserToV1Test() {
		// Given:
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		EffectiveAccessContext access = Instancio.create(EffectiveAccessContext.class);

		// When:
		UserV1 result = mapper.toV1(user, access, "pu-1", true);

		// Then:
		assertThat(result.getPacingUserId()).isEqualTo("pu-1");
		assertThat(result.getPacingUnrestricted()).isTrue();
		assertThat(result.getUserId()).isEqualTo(user.clerkUserId());
		assertThat(result.getEmail()).isEqualTo(user.email());
		assertThat(result.getFullName()).isEqualTo(user.displayName());
		assertThat(result.getHubUserId()).isEqualTo(user.id());
		assertThat(result.getStatus()).isEqualTo(user.status());
		assertThat(result.getRoles()).containsExactlyInAnyOrderElementsOf(access.roleCodes());
		assertThat(result.getAssignments()).hasSameSizeAs(access.assignments());
	}

	@Test
	void shouldKeepAnUnsyncedPacingUserIdNullTest() {
		// Given: a person the §2 sync has not reached, on a restricted scope.
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		EffectiveAccessContext access = Instancio.create(EffectiveAccessContext.class);

		// When:
		UserV1 result = mapper.toV1(user, access, null, false);

		// Then: null stays null - the browser reads it as "may edit nothing I did not write", and
		// "false" rather than absent for the scope flag.
		assertThat(result.getPacingUserId()).isNull();
		assertThat(result.getPacingUnrestricted()).isFalse();
	}
}
