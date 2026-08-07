package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.AgencyV1;
import com.aidigital.operationalhub.service.agency.model.AgencyModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link AgencyContractMapper}.
 */
@ExtendWith(MockitoExtension.class)
class AgencyContractMapperTest {

	@InjectMocks
	private AgencyContractMapperImpl mapper;

	@Test
	void shouldMapAgencyToV1Test() {
		// Given:
		AgencyModel model = Instancio.create(AgencyModel.class);

		// When:
		AgencyV1 result = mapper.toV1(model);

		// Then:
		assertThat(result.getId()).isEqualTo(model.id());
		assertThat(result.getName()).isEqualTo(model.name());
		assertThat(result.getEmail()).isEqualTo(model.email());
		assertThat(result.getStatus()).isEqualTo(model.status());
		assertThat(result.getClientsCount()).isEqualTo(model.clientsCount());
		assertThat(result.getClients()).hasSameSizeAs(model.clients());
		assertThat(result.getClients().get(0).getId()).isEqualTo(model.clients().get(0).id());
	}

	@Test
	void shouldMapAgencyListToV1Test() {
		// Given:
		List<AgencyModel> models = Instancio.ofList(AgencyModel.class).size(2).create();

		// When:
		List<AgencyV1> result = mapper.toV1(models);

		// Then:
		assertThat(result).hasSize(2);
		assertThat(result.get(0).getId()).isEqualTo(models.get(0).id());
		assertThat(result.get(1).getId()).isEqualTo(models.get(1).id());
	}
}
