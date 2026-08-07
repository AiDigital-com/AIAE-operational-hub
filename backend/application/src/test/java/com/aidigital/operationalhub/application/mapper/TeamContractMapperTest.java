package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.CreateTeamRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.TeamPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.TeamV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.UpdateTeamRequestV1;
import com.aidigital.operationalhub.domain.entity.HubTeam;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link TeamContractMapper}.
 */
@ExtendWith(MockitoExtension.class)
class TeamContractMapperTest {

	@InjectMocks
	private TeamContractMapperImpl mapper;

	@Test
	void shouldMapHubTeamToV1Test() {
		// Given:
		HubTeam entity = Instancio.create(HubTeam.class);

		// When:
		TeamV1 result = mapper.toV1(entity);

		// Then:
		assertThat(result.getId()).isEqualTo(entity.getId());
		assertThat(result.getTeamName()).isEqualTo(entity.getTeamName());
		assertThat(result.getPodKey()).isEqualTo(entity.getPodKey());
		assertThat(result.getStatus()).isEqualTo(entity.getStatus());
	}

	@Test
	void shouldMapHubTeamListToV1Test() {
		// Given:
		List<HubTeam> entities = Instancio.ofList(HubTeam.class).size(2).create();

		// When:
		List<TeamV1> result = mapper.toV1(entities);

		// Then:
		assertThat(result).hasSize(2);
		assertThat(result.get(0).getId()).isEqualTo(entities.get(0).getId());
		assertThat(result.get(1).getId()).isEqualTo(entities.get(1).getId());
	}

	@Test
	void shouldMapCreateRequestToEntityTest() {
		// Given:
		CreateTeamRequestV1 request = Instancio.create(CreateTeamRequestV1.class);

		// When:
		HubTeam result = mapper.fromV1(request);

		// Then:
		assertThat(result.getTeamName()).isEqualTo(request.getTeamName());
		assertThat(result.getPodKey()).isEqualTo(request.getPodKey());
		assertThat(result.getStatus()).isEqualTo(request.getStatus());
	}

	@Test
	void shouldMapUpdateRequestToEntityTest() {
		// Given:
		UpdateTeamRequestV1 request = Instancio.create(UpdateTeamRequestV1.class);

		// When:
		HubTeam result = mapper.fromV1(request);

		// Then:
		assertThat(result.getTeamName()).isEqualTo(request.getTeamName());
		assertThat(result.getPodKey()).isEqualTo(request.getPodKey());
		assertThat(result.getStatus()).isEqualTo(request.getStatus());
	}

	@Test
	void shouldMapPageToPageResponseTest() {
		// Given: the last page (zero-based index 1 → one-based 2) of size 20 holding the final 5 of 25 teams
		List<HubTeam> teams = Instancio.ofList(HubTeam.class).size(5).create();
		Page<HubTeam> page = new PageImpl<>(teams, PageRequest.of(1, 20), 25);

		// When:
		TeamPageResponseV1 response = mapper.toPageResponse(page);

		// Then: page number is one-based; totals are passed through
		assertThat(response.getPageNumber()).isEqualTo(2);
		assertThat(response.getPageSize()).isEqualTo(20);
		assertThat(response.getTotalElements()).isEqualTo(25L);
		assertThat(response.getTotalPages()).isEqualTo(2);
		assertThat(response.getContent()).hasSize(5);
	}
}
