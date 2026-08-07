package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.RoleV1;
import com.aidigital.operationalhub.domain.entity.HubRole;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link RoleContractMapper}.
 */
@ExtendWith(MockitoExtension.class)
class RoleContractMapperTest {

	@InjectMocks
	private RoleContractMapperImpl mapper;

	@Test
	void shouldMapRoleToV1Test() {
		// Given:
		HubRole role = Instancio.create(HubRole.class);

		// When:
		RoleV1 result = mapper.toV1(role);

		// Then:
		assertThat(result.getId()).isEqualTo(role.getId());
		assertThat(result.getRoleCode()).isEqualTo(role.getRoleCode());
		assertThat(result.getDisplayName()).isEqualTo(role.getDisplayName());
		assertThat(result.getDescription()).isEqualTo(role.getDescription());
		assertThat(result.getFuture()).isEqualTo(role.isFuture());
		assertThat(result.getStatus()).isEqualTo(role.getStatus());
	}

	@Test
	void shouldMapRoleListToV1Test() {
		// Given:
		List<HubRole> roles = Instancio.ofList(HubRole.class).size(2).create();

		// When:
		List<RoleV1> result = mapper.toV1(roles);

		// Then:
		assertThat(result).hasSize(2);
		assertThat(result.get(0).getRoleCode()).isEqualTo(roles.get(0).getRoleCode());
		assertThat(result.get(1).getRoleCode()).isEqualTo(roles.get(1).getRoleCode());
	}
}
