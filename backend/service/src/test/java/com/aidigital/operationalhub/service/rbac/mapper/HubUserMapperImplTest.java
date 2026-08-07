package com.aidigital.operationalhub.service.rbac.mapper;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.rbac.enums.RbacRoleCode;
import com.aidigital.operationalhub.service.rbac.model.HubUserSummaryModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.instancio.Select.field;

/**
 * Unit tests for {@link HubUserMapperImpl}.
 */
class HubUserMapperImplTest {

	private static final Long USER_ID = 42L;

	@Test
	void shouldMapToSummaryModelWithRoleTest() {
		// Given:
		HubUserMapperImpl mapper = new HubUserMapperImpl();
		HubUser user = Instancio.of(HubUser.class)
				.set(field(HubUser::getId), USER_ID)
				.create();
		Long teamId = 42L;

		// When:
		HubUserSummaryModel result = mapper.toSummaryModel(user, RbacRoleCode.ADMIN.getCode(), teamId);

		// Then:
		assertThat(result.hubUserId()).isEqualTo(USER_ID);
		assertThat(result.fullName()).isEqualTo(user.getDisplayName());
		assertThat(result.email()).isEqualTo(user.getEmail());
		assertThat(result.status()).isEqualTo(user.getStatus());
		assertThat(result.roleCode()).isEqualTo(RbacRoleCode.ADMIN.getCode());
		assertThat(result.teamId()).isEqualTo(teamId);
	}

	@Test
	void shouldMapToSummaryModelWithoutRoleTest() {
		// Given:
		HubUserMapperImpl mapper = new HubUserMapperImpl();
		HubUser user = Instancio.of(HubUser.class)
				.set(field(HubUser::getId), USER_ID)
				.create();
		Long teamId = 42L;

		// When:
		HubUserSummaryModel result = mapper.toSummaryModel(user, null, teamId);

		// Then:
		assertThat(result.hubUserId()).isEqualTo(USER_ID);
		assertThat(result.roleCode()).isNull();
		assertThat(result.teamId()).isEqualTo(teamId);
	}
}
