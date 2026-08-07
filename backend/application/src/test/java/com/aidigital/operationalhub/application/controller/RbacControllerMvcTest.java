package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.model.AssignRoleRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.RoleAssignmentV1;
import com.aidigital.operationalhub.application.exception.GlobalExceptionHandler;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelperImpl;
import com.aidigital.operationalhub.application.mapper.HubUserSearchContractMapper;
import com.aidigital.operationalhub.application.mapper.RoleAssignmentContractMapper;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.exception.AppException;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.RbacAdministrationService;
import com.aidigital.operationalhub.service.rbac.RbacAuthorizationService;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.model.AssignRoleModel;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.HubUserSummaryModel;
import com.aidigital.operationalhub.service.rbac.model.RevokeRoleModel;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;
import com.aidigital.operationalhub.service.rbac.search.HubUserField;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc contract tests for {@link RbacController}.
 */
@ExtendWith(MockitoExtension.class)
class RbacControllerMvcTest {

	@Mock
	private RbacQueryService rbacQueryService;

	@Mock
	private HubUserSearchContractMapper hubUserSearchMapper;

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private RoleAssignmentContractMapper roleAssignmentMapper;

	@Mock
	private RbacAuthorizationService rbacAuthorizationService;

	@Mock
	private RbacAdministrationService rbacAdministrationService;

	@InjectMocks
	private RbacController controller;

	@Test
	void shouldSearchUsersTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		SearchCriteria<HubUserField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);
		Page<HubUserSummaryModel> page = new PageImpl<>(Instancio.ofList(HubUserSummaryModel.class).size(1).create());
		HubUserPageResponseV1 response = Instancio.create(HubUserPageResponseV1.class);
		response.setTotalElements(7L);
		ArgumentCaptor<HubUserSearchRequestV1> bodyCaptor = ArgumentCaptor.forClass(HubUserSearchRequestV1.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		when(hubUserSearchMapper.toCriteria(bodyCaptor.capture(), eq(1), eq(20))).thenReturn(criteria);
		doReturn(page).when(rbacQueryService).searchUsers(criteria);
		doReturn(response).when(hubUserSearchMapper).toPageResponse(page);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When:
		mockMvc.perform(post("/api/v1/rbac/users/search")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"filters\":[],\"sorting\":{\"field\":\"FULL_NAME\",\"direction\":\"ASC\"}}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.totalElements").value(7));

		// Then: the manage-roles permission is enforced for the resolved user
		ArgumentCaptor<CurrentUserModel> userCaptor = ArgumentCaptor.forClass(CurrentUserModel.class);
		verify(rbacAuthorizationService).requireCanManageRoles(userCaptor.capture());
		assertThat(userCaptor.getValue()).isEqualTo(currentUser);
	}

	@Test
	void shouldListRoleAssignmentsTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		List<RoleAssignmentModel> models = Instancio.ofList(RoleAssignmentModel.class).size(1).create();
		RoleAssignmentV1 assignmentV1 = Instancio.create(RoleAssignmentV1.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(models).when(rbacQueryService).listRoleAssignments(42L);
		doReturn(List.of(assignmentV1)).when(roleAssignmentMapper).toV1(models);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When:
		mockMvc.perform(get("/api/v1/rbac/users/42/role-assignments"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.length()").value(1))
				.andExpect(jsonPath("$[0].role_code").value(assignmentV1.getRoleCode()));

		// Then:
		ArgumentCaptor<CurrentUserModel> userCaptor = ArgumentCaptor.forClass(CurrentUserModel.class);
		verify(rbacAuthorizationService).requireCanManageRoles(userCaptor.capture());
		assertThat(userCaptor.getValue()).isEqualTo(currentUser);
	}

	@Test
	void shouldAssignRoleAndReturnCreatedTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		AssignRoleRequestV1 request = new AssignRoleRequestV1();
		request.setRoleCode("ADMIN");
		request.setScopeCode("ALL");
		AssignRoleModel command = Instancio.create(AssignRoleModel.class);
		RoleAssignmentModel model = Instancio.create(RoleAssignmentModel.class);
		RoleAssignmentV1 body = Instancio.create(RoleAssignmentV1.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(command).when(roleAssignmentMapper).fromV1(42L, request, currentUser);
		doReturn(model).when(rbacAdministrationService).assignRole(command);
		doReturn(body).when(roleAssignmentMapper).toV1(model);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/rbac/users/42/role-assignments")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"role_code\":\"ADMIN\",\"scope_code\":\"ALL\"}"))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.role_code").value(body.getRoleCode()));
	}

	@Test
	void shouldRevokeRoleAndReturnNoContentTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When:
		mockMvc.perform(delete("/api/v1/rbac/users/42/role-assignments/7"))
				.andExpect(status().isNoContent());

		// Then:
		ArgumentCaptor<RevokeRoleModel> commandCaptor = ArgumentCaptor.forClass(RevokeRoleModel.class);
		verify(rbacAdministrationService).revokeRole(commandCaptor.capture());
		assertThat(commandCaptor.getValue())
				.isEqualTo(new RevokeRoleModel(42L, 7L, currentUser.id()));
	}

	@Test
	void shouldReturnForbiddenWhenListingWithoutPermissionTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doThrow(new AccessDeniedException("denied"))
				.when(rbacAuthorizationService).requireCanManageRoles(currentUser);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(get("/api/v1/rbac/users/42/role-assignments"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_015"));
	}

	@Test
	void shouldReturnForbiddenWhenAssigningWithoutPermissionTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doThrow(new AccessDeniedException("denied"))
				.when(rbacAuthorizationService).requireCanManageRoles(currentUser);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/rbac/users/42/role-assignments")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"role_code\":\"ADMIN\",\"scope_code\":\"ALL\"}"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_015"));
	}

	@Test
	void shouldReturnBadRequestWhenAssignRoleViolatesBusinessRuleTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		AssignRoleRequestV1 request = new AssignRoleRequestV1();
		request.setRoleCode("ADMIN");
		request.setScopeCode("AGENCY");
		AssignRoleModel command = Instancio.create(AssignRoleModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(command).when(roleAssignmentMapper).fromV1(42L, request, currentUser);
		doThrow(new BusinessException(OperationalHubErrorReason.OPH_007, "AGENCY"))
				.when(rbacAdministrationService).assignRole(command);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/rbac/users/42/role-assignments")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"role_code\":\"ADMIN\",\"scope_code\":\"AGENCY\"}"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("OPH_007"));
	}

	@Test
	void shouldReturnNotFoundWhenAssignRoleTargetsUnknownUserTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		AssignRoleRequestV1 request = new AssignRoleRequestV1();
		request.setRoleCode("ADMIN");
		request.setScopeCode("ALL");
		AssignRoleModel command = Instancio.create(AssignRoleModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(command).when(roleAssignmentMapper).fromV1(42L, request, currentUser);
		doThrow(new BusinessException(OperationalHubErrorReason.OPH_014, 42L))
				.when(rbacAdministrationService).assignRole(command);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/rbac/users/42/role-assignments")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"role_code\":\"ADMIN\",\"scope_code\":\"ALL\"}"))
				.andExpect(status().isNotFound())
				.andExpect(jsonPath("$.code").value("OPH_014"));
	}

	@Test
	void shouldReturnInternalServerErrorWhenAssignRoleFailsTechnicallyTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		AssignRoleRequestV1 request = new AssignRoleRequestV1();
		request.setRoleCode("ADMIN");
		request.setScopeCode("ALL");
		AssignRoleModel command = Instancio.create(AssignRoleModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(command).when(roleAssignmentMapper).fromV1(42L, request, currentUser);
		doThrow(new AppException("technical failure"))
				.when(rbacAdministrationService).assignRole(command);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/rbac/users/42/role-assignments")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"role_code\":\"ADMIN\",\"scope_code\":\"ALL\"}"))
				.andExpect(status().isInternalServerError())
				.andExpect(jsonPath("$.code").value("OPH_000"));
	}

	@Test
	void shouldReturnBadRequestWhenRevokeCommandInvalidTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doThrow(new BusinessException(OperationalHubErrorReason.OPH_013))
				.when(rbacAdministrationService).revokeRole(new RevokeRoleModel(42L, 7L, currentUser.id()));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(delete("/api/v1/rbac/users/42/role-assignments/7"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("OPH_013"));
	}
}
