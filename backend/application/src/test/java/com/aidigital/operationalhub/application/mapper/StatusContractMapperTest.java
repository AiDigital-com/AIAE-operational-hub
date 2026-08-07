package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.StatusV1;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link StatusContractMapper}.
 */
@ExtendWith(MockitoExtension.class)
class StatusContractMapperTest {

	@InjectMocks
	private StatusContractMapperImpl mapper;

	@Test
	void shouldMapStatusToContractRowTest() {
		// Given:
		// When:
		StatusV1 result = mapper.toV1(HubStatus.ACTIVE);

		// Then:
		assertThat(result.getCode()).isEqualTo(HubStatus.ACTIVE.getCode());
		assertThat(result.getDisplayName()).isEqualTo(HubStatus.ACTIVE.getDisplayName());
	}

	@Test
	void shouldMapStatusListPreservingOrderTest() {
		// Given:
		// When:
		List<StatusV1> result = mapper.toV1(List.of(HubStatus.ACTIVE, HubStatus.REVOKED));

		// Then:
		assertThat(result).extracting(StatusV1::getCode)
				.containsExactly(HubStatus.ACTIVE.getCode(), HubStatus.REVOKED.getCode());
	}
}
