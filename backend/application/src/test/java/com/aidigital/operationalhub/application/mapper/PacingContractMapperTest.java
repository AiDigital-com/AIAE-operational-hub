package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingListResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingScopeV1;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.instancio.Select.field;

/**
 * Unit tests for {@link PacingContractMapper}.
 */
class PacingContractMapperTest {

	private final PacingContractMapper mapper = new PacingContractMapper();

	@Test
	void shouldBuildAssertionFromUserAndEntitlementTest() {
		// Given:
		CurrentUserModel user = Instancio.of(CurrentUserModel.class)
				.set(field(CurrentUserModel::email), "acting-user@aidigital.com")
				.create();
		PacingEntitlement entitlement =
				new PacingEntitlement(PacingScope.owners(List.of("a@x.com", "b@x.com")), true);

		// When:
		HubAssertion assertion = mapper.toAssertion(user, entitlement);

		// Then:
		assertThat(assertion.email()).isEqualTo("acting-user@aidigital.com");
		assertThat(assertion.scopeKind()).isEqualTo(PacingScope.KIND_OWNERS);
		assertThat(assertion.scopeIds()).containsExactly("a@x.com", "b@x.com");
		assertThat(assertion.canCreate()).isTrue();
	}

	@Test
	void shouldBuildResponseWithScopeAndPacingsTest() {
		// Given:
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), false);
		List<Map<String, Object>> pacings = List.of(Map.of("pacing_id", "nike-ss26"));

		// When:
		PacingListResponseV1 response = mapper.toV1(entitlement, pacings);

		// Then:
		assertThat(response.getPacings()).isEqualTo(pacings);
		PacingScopeV1 scope = response.getScope();
		assertThat(scope.getKind()).isEqualTo(PacingScopeV1.KindEnum.ALL);
		assertThat(scope.getIds()).isEmpty();
		assertThat(scope.getCanCreate()).isFalse();
	}

	@Test
	void shouldMapOwnersScopeKindTest() {
		// Given:
		PacingEntitlement entitlement =
				new PacingEntitlement(PacingScope.owners(List.of("a@x.com")), true);

		// When:
		PacingListResponseV1 response = mapper.toV1(entitlement, List.of());

		// Then:
		assertThat(response.getScope().getKind()).isEqualTo(PacingScopeV1.KindEnum.OWNERS);
		assertThat(response.getScope().getIds()).containsExactly("a@x.com");
		assertThat(response.getScope().getCanCreate()).isTrue();
	}
}
