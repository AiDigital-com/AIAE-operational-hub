package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserSummaryV1;
import com.aidigital.operationalhub.service.rbac.model.HubUserSummaryModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link HubUserContractMapper}.
 */
@ExtendWith(MockitoExtension.class)
class HubUserContractMapperTest {

	@InjectMocks
	private HubUserContractMapperImpl mapper;

	@Test
	void shouldMapModelToV1Test() {
		// Given:
		HubUserSummaryModel model = Instancio.create(HubUserSummaryModel.class);

		// When:
		HubUserSummaryV1 result = mapper.toV1(model);

		// Then:
		assertThat(result.getHubUserId()).isEqualTo(model.hubUserId());
		assertThat(result.getFullName()).isEqualTo(model.fullName());
		assertThat(result.getEmail()).isEqualTo(model.email());
		assertThat(result.getStatus()).isEqualTo(model.status());
		assertThat(result.getRoleCode()).isEqualTo(model.roleCode());
	}

	@Test
	void shouldMapModelListToV1Test() {
		// Given:
		List<HubUserSummaryModel> models = Instancio.ofList(HubUserSummaryModel.class).size(2).create();

		// When:
		List<HubUserSummaryV1> result = mapper.toV1(models);

		// Then:
		assertThat(result).hasSize(2);
		assertThat(result.get(0).getHubUserId()).isEqualTo(models.get(0).hubUserId());
		assertThat(result.get(1).getEmail()).isEqualTo(models.get(1).email());
	}
}
