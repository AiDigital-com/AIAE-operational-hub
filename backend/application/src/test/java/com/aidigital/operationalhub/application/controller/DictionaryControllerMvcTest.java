package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.model.RoleV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ScopeTypeV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.StatusV1;
import com.aidigital.operationalhub.application.exception.GlobalExceptionHandler;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelperImpl;
import com.aidigital.operationalhub.application.mapper.RoleContractMapper;
import com.aidigital.operationalhub.application.mapper.ScopeContractMapper;
import com.aidigital.operationalhub.application.mapper.StatusContractMapper;
import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubScopeType;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.dictionary.HubStatusService;
import com.aidigital.operationalhub.service.entity.HubRoleService;
import com.aidigital.operationalhub.service.entity.HubScopeTypeService;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.RbacAuthorizationService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc contract tests for {@link DictionaryController}.
 */
@ExtendWith(MockitoExtension.class)
class DictionaryControllerMvcTest {

	@Mock
	private RoleContractMapper roleMapper;

	@Mock
	private ScopeContractMapper scopeMapper;

	@Mock
	private StatusContractMapper statusMapper;

	@Mock
	private HubStatusService hubStatusService;

	@Mock
	private HubRoleService hubRoleService;

	@Mock
	private HubScopeTypeService hubScopeTypeService;

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private RbacAuthorizationService rbacAuthorizationService;

	@InjectMocks
	private DictionaryController controller;

	@Test
	void shouldListRolesTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		List<HubRole> roles = Instancio.ofList(HubRole.class).size(1).create();
		RoleV1 roleV1 = Instancio.create(RoleV1.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(roles).when(hubRoleService).listActiveOrderedByDisplayName();
		doReturn(List.of(roleV1)).when(roleMapper).toV1(roles);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When:
		mockMvc.perform(get("/api/v1/dictionary/rbac/roles"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.length()").value(1))
				.andExpect(jsonPath("$[0].role_code").value(roleV1.getRoleCode()));

		// Then:
		ArgumentCaptor<CurrentUserModel> userCaptor = ArgumentCaptor.forClass(CurrentUserModel.class);
		verify(rbacAuthorizationService).requireCanManageRoles(userCaptor.capture());
		assertThat(userCaptor.getValue()).isEqualTo(currentUser);
	}

	@Test
	void shouldListScopeTypesTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		List<HubScopeType> scopeTypes = Instancio.ofList(HubScopeType.class).size(1).create();
		ScopeTypeV1 scopeTypeV1 = Instancio.create(ScopeTypeV1.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(scopeTypes).when(hubScopeTypeService).listActiveOrderedByDisplayName();
		doReturn(List.of(scopeTypeV1)).when(scopeMapper).toV1(scopeTypes);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When:
		mockMvc.perform(get("/api/v1/dictionary/rbac/scope-types"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.length()").value(1))
				.andExpect(jsonPath("$[0].scope_code").value(scopeTypeV1.getScopeCode()));

		// Then:
		ArgumentCaptor<CurrentUserModel> userCaptor = ArgumentCaptor.forClass(CurrentUserModel.class);
		verify(rbacAuthorizationService).requireCanManageRoles(userCaptor.capture());
		assertThat(userCaptor.getValue()).isEqualTo(currentUser);
	}

	@Test
	void shouldListStatusesTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		List<HubStatus> statuses = List.of(HubStatus.ACTIVE, HubStatus.INACTIVE);
		StatusV1 statusV1 = new StatusV1();
		statusV1.setCode("ACTIVE");
		statusV1.setDisplayName("Active");
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(statuses).when(hubStatusService).listStatuses();
		doReturn(List.of(statusV1)).when(statusMapper).toV1(statuses);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When:
		mockMvc.perform(get("/api/v1/dictionary/statuses"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.length()").value(1))
				.andExpect(jsonPath("$[0].code").value("ACTIVE"));

		// Then:
		ArgumentCaptor<CurrentUserModel> userCaptor = ArgumentCaptor.forClass(CurrentUserModel.class);
		verify(rbacAuthorizationService).requireCanManageRoles(userCaptor.capture());
		assertThat(userCaptor.getValue()).isEqualTo(currentUser);
	}

	@Test
	void shouldReturnForbiddenWhenListingRolesWithoutPermissionTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doThrow(new AccessDeniedException("denied"))
				.when(rbacAuthorizationService).requireCanManageRoles(currentUser);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(get("/api/v1/dictionary/rbac/roles"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_015"));
	}

	@Test
	void shouldReturnForbiddenWhenListingScopeTypesWithoutPermissionTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doThrow(new AccessDeniedException("denied"))
				.when(rbacAuthorizationService).requireCanManageRoles(currentUser);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(get("/api/v1/dictionary/rbac/scope-types"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.code").value("OPH_015"));
	}
}
