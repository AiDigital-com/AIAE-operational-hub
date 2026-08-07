package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.ClientV1;
import com.aidigital.operationalhub.service.agency.model.ClientModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ClientContractMapper}.
 */
@ExtendWith(MockitoExtension.class)
class ClientContractMapperTest {

	@InjectMocks
	private ClientContractMapperImpl mapper;

	@Test
	void shouldMapClientToV1Test() {
		// Given:
		ClientModel model = Instancio.create(ClientModel.class);

		// When:
		ClientV1 result = mapper.toV1(model);

		// Then:
		assertThat(result.getId()).isEqualTo(model.id());
		assertThat(result.getName()).isEqualTo(model.name());
		assertThat(result.getAgencyId()).isEqualTo(model.agencyId());
		assertThat(result.getEmail()).isEqualTo(model.email());
		assertThat(result.getStatus()).isEqualTo(model.status());
	}

	@Test
	void shouldMapClientListToV1Test() {
		// Given:
		List<ClientModel> models = Instancio.ofList(ClientModel.class).size(2).create();

		// When:
		List<ClientV1> result = mapper.toV1(models);

		// Then:
		assertThat(result).hasSize(2);
		assertThat(result.get(0).getId()).isEqualTo(models.get(0).id());
		assertThat(result.get(1).getId()).isEqualTo(models.get(1).id());
	}
}
