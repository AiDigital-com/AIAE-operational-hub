package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.TeamsApi;
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
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * REST controller for the {@code /api/v1/teams} endpoints.
 *
 * <p>Implements the OpenAPI-generated {@link TeamsApi}. Contains no business logic: it resolves the
 * current user, enforces the manage-roles permission, delegates to {@link HubTeamService}, and maps
 * the result into the generated contract.
 */
@RestController
@RequiredArgsConstructor
public class TeamController implements TeamsApi {

	private final HubTeamService teamService;
	private final CurrentUserService currentUserService;
	private final RbacAuthorizationService rbacAuthorizationService;
	private final TeamContractMapper teamMapper;

	@Override
	public ResponseEntity<List<TeamV1>> listTeams() {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		rbacAuthorizationService.requireCanManageRoles(currentUser);

		List<HubTeam> teams = teamService.listAllOrderedByName();
		return ResponseEntity.ok(teamMapper.toV1(teams));
	}

	@Override
	public ResponseEntity<TeamPageResponseV1> searchTeams(
			Integer pageNumber, Integer pageSize, TeamSearchRequestV1 teamSearchRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		rbacAuthorizationService.requireCanManageRoles(currentUser);

		String name = teamSearchRequestV1 == null ? null : teamSearchRequestV1.getName();
		Page<HubTeam> page = teamService.search(name, pageNumber, pageSize);
		return ResponseEntity.ok(teamMapper.toPageResponse(page));
	}

	@Override
	public ResponseEntity<TeamV1> createTeam(CreateTeamRequestV1 createTeamRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		rbacAuthorizationService.requireCanManageRoles(currentUser);

		HubTeam created = teamService.create(teamMapper.fromV1(createTeamRequestV1));
		return ResponseEntity.status(HttpStatus.CREATED).body(teamMapper.toV1(created));
	}

	@Override
	public ResponseEntity<TeamV1> updateTeam(Long teamId, UpdateTeamRequestV1 updateTeamRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		rbacAuthorizationService.requireCanManageRoles(currentUser);

		HubTeam updated = teamService.update(teamId, teamMapper.fromV1(updateTeamRequestV1));
		return ResponseEntity.ok(teamMapper.toV1(updated));
	}
}
