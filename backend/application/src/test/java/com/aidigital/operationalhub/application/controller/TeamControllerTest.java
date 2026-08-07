package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.model.CreateTeamRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.TeamPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.TeamSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.TeamV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.UpdateTeamRequestV1;
import com.aidigital.operationalhub.application.mapper.TeamContractMapper;
import com.aidigital.operationalhub.domain.entity.HubTeam;
import com.aidigital.operationalhub.service.entity.HubTeamService;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.RbacAuthorizationService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

/**
 * Direct unit tests for {@link TeamController}.
 */
@ExtendWith(MockitoExtension.class)
class TeamControllerTest {

	@Mock
	private HubTeamService teamService;

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private RbacAuthorizationService rbacAuthorizationService;

	@Mock
	private TeamContractMapper teamMapper;

	@InjectMocks
	private TeamController controller;

	@Test
	void shouldListTeamsForCurrentUserTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		List<HubTeam> teams = Instancio.ofList(HubTeam.class).size(2).create();
		List<TeamV1> response = Instancio.ofList(TeamV1.class).size(2).create();
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(teams).when(teamService).listAllOrderedByName();
		doReturn(response).when(teamMapper).toV1(teams);

		// When:
		ResponseEntity<List<TeamV1>> result = controller.listTeams();

		// Then:
		assertThat(result.getBody()).isEqualTo(response);
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		verify(currentUserService).resolveCurrentUser();
		verify(rbacAuthorizationService).requireCanManageRoles(currentUser);
		verify(teamService).listAllOrderedByName();
		verify(teamMapper).toV1(teams);
		verifyNoMoreInteractions(teamService, teamMapper);
	}

	@Test
	void shouldSearchTeamsForCurrentUserTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		TeamSearchRequestV1 request = Instancio.create(TeamSearchRequestV1.class);
		String name = request.getName();
		Page<HubTeam> page = new PageImpl<>(Instancio.ofList(HubTeam.class).size(1).create());
		TeamPageResponseV1 response = Instancio.create(TeamPageResponseV1.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(page).when(teamService).search(name, 1, 20);
		doReturn(response).when(teamMapper).toPageResponse(page);

		// When:
		ResponseEntity<TeamPageResponseV1> result = controller.searchTeams(1, 20, request);

		// Then:
		assertThat(result.getBody()).isEqualTo(response);
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		verify(currentUserService).resolveCurrentUser();
		verify(rbacAuthorizationService).requireCanManageRoles(currentUser);
		verify(teamService).search(name, 1, 20);
		verify(teamMapper).toPageResponse(page);
	}

	@Test
	void shouldCreateTeamTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		CreateTeamRequestV1 request = Instancio.create(CreateTeamRequestV1.class);
		HubTeam entity = Instancio.create(HubTeam.class);
		HubTeam created = Instancio.create(HubTeam.class);
		TeamV1 response = Instancio.create(TeamV1.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(entity).when(teamMapper).fromV1(request);
		doReturn(created).when(teamService).create(entity);
		doReturn(response).when(teamMapper).toV1(created);

		// When:
		ResponseEntity<TeamV1> result = controller.createTeam(request);

		// Then:
		assertThat(result.getBody()).isEqualTo(response);
		assertThat(result.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		verify(currentUserService).resolveCurrentUser();
		verify(rbacAuthorizationService).requireCanManageRoles(currentUser);
		verify(teamMapper).fromV1(request);
		verify(teamService).create(entity);
		verify(teamMapper).toV1(created);
	}

	@Test
	void shouldUpdateTeamTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		Long teamId = 5L;
		UpdateTeamRequestV1 request = Instancio.create(UpdateTeamRequestV1.class);
		HubTeam entity = Instancio.create(HubTeam.class);
		HubTeam updated = Instancio.create(HubTeam.class);
		TeamV1 response = Instancio.create(TeamV1.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(entity).when(teamMapper).fromV1(request);
		doReturn(updated).when(teamService).update(teamId, entity);
		doReturn(response).when(teamMapper).toV1(updated);

		// When:
		ResponseEntity<TeamV1> result = controller.updateTeam(teamId, request);

		// Then:
		assertThat(result.getBody()).isEqualTo(response);
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		verify(currentUserService).resolveCurrentUser();
		verify(rbacAuthorizationService).requireCanManageRoles(currentUser);
		verify(teamMapper).fromV1(request);
		verify(teamService).update(teamId, entity);
		verify(teamMapper).toV1(updated);
	}
}
