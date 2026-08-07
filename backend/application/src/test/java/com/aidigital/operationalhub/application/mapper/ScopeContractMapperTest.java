package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.ScopeTypeV1;
import com.aidigital.operationalhub.domain.entity.HubScopeType;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ScopeContractMapper}.
 */
@ExtendWith(MockitoExtension.class)
class ScopeContractMapperTest {

	@InjectMocks
	private ScopeContractMapperImpl mapper;

	@Test
	void shouldMapScopeTypeToV1Test() {
		// Given:
		HubScopeType scopeType = Instancio.create(HubScopeType.class);

		// When:
		ScopeTypeV1 result = mapper.toV1(scopeType);

		// Then:
		assertThat(result.getId()).isEqualTo(scopeType.getId());
		assertThat(result.getScopeCode()).isEqualTo(scopeType.getScopeCode());
		assertThat(result.getDisplayName()).isEqualTo(scopeType.getDisplayName());
		assertThat(result.getDescription()).isEqualTo(scopeType.getDescription());
		assertThat(result.getStatus()).isEqualTo(scopeType.getStatus());
	}

	@Test
	void shouldMapScopeTypeListToV1Test() {
		// Given:
		List<HubScopeType> scopeTypes = Instancio.ofList(HubScopeType.class).size(2).create();

		// When:
		List<ScopeTypeV1> result = mapper.toV1(scopeTypes);

		// Then:
		assertThat(result).hasSize(2);
		assertThat(result.get(0).getScopeCode()).isEqualTo(scopeTypes.get(0).getScopeCode());
		assertThat(result.get(1).getScopeCode()).isEqualTo(scopeTypes.get(1).getScopeCode());
	}
}
