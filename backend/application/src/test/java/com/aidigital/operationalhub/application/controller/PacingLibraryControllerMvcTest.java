package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryEntryV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryKindV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryListResponseV1;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingDashboardContractMapper;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibraryEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibrarySaveOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLikeResult;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc contract tests for {@link PacingLibraryController} (§6 of the migration plan, US-116/US-118).
 */
@ExtendWith(MockitoExtension.class)
class PacingLibraryControllerMvcTest {

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private PacingScopeResolver pacingScopeResolver;

	@Mock
	private PacingClient pacingClient;

	@Mock
	private PacingContractMapper assertionMapper;

	@Mock
	private PacingDashboardContractMapper mapper;

	@InjectMocks
	private PacingLibraryController controller;

	private void stubCurrentUser() {
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(assertionMapper).toAssertion(user, entitlement);
	}

	private PacingLibraryEntry anEntry() {
		return new PacingLibraryEntry(
				"e1", "widget", "Budget card", null, Map.of("id", "w_1"), "Azat", "t1", "t2", 0, false, true, 0);
	}

	@Test
	void shouldListLibraryTest() throws Exception {
		// Given:
		stubCurrentUser();
		List<PacingLibraryEntry> entries = List.of(anEntry());
		doReturn(entries).when(pacingClient).listLibrary(any(), eq("budget"), eq("usage"), eq("mine"), eq("widget"));
		doReturn(new PacingLibraryListResponseV1().entries(
				List.of(new PacingLibraryEntryV1().id("e1").kind(PacingLibraryKindV1.WIDGET).name("Budget card")
						.likes(0).liked(false).mine(true).usage(0))))
				.when(mapper).toListV1(entries);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		// Note: "WIDGET" (matching the generated enum constant name) rather than the wire value
		// "widget" - Spring's plain (non-Boot-autoconfigured) ConversionService used by this standalone
		// MockMvc setup only accepts an exact case match; a real request from the Hub's own frontend
		// sends the lowercase wire value, which Spring Boot's case-insensitive enum converter accepts.
		mockMvc.perform(get("/api/v1/pacing/library")
						.param("q", "budget").param("sort", "usage").param("shelf", "mine").param("kind", "WIDGET"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.entries[0].id").value("e1"));
	}

	@Test
	void shouldCreateLibraryEntryTest() throws Exception {
		// Given:
		stubCurrentUser();
		PacingLibraryEntry entry = anEntry();
		doReturn(PacingLibrarySaveOutcome.saved(entry)).when(pacingClient)
				.createLibraryEntry(any(), eq("widget"), eq("Budget card"), eq(null), any());
		doReturn(new PacingLibraryEntryV1().id("e1").kind(PacingLibraryKindV1.WIDGET).name("Budget card")
				.likes(0).liked(false).mine(true).usage(0))
				.when(mapper).toV1(entry);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/library")
						.contentType(APPLICATION_JSON)
						.content("{\"kind\":\"widget\",\"name\":\"Budget card\",\"definition\":{\"id\":\"w_1\"}}"))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.id").value("e1"));
	}

	@Test
	void shouldReturn409OnLibraryFullConflictTest() throws Exception {
		// Given:
		stubCurrentUser();
		doReturn(PacingLibrarySaveOutcome.libraryFull()).when(pacingClient)
				.createLibraryEntry(any(), eq("widget"), eq("Budget card"), eq(null), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/library")
						.contentType(APPLICATION_JSON)
						.content("{\"kind\":\"widget\",\"name\":\"Budget card\",\"definition\":{\"id\":\"w_1\"}}"))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.reason").value("library_full"));
	}

	@Test
	void shouldUpdateLibraryEntryTest() throws Exception {
		// Given:
		stubCurrentUser();
		PacingLibraryEntry entry = anEntry();
		doReturn(PacingLibrarySaveOutcome.saved(entry)).when(pacingClient)
				.updateLibraryEntry(any(), eq("e1"), eq("Renamed"), eq(null), any(), eq("t2"));
		doReturn(new PacingLibraryEntryV1().id("e1").kind(PacingLibraryKindV1.WIDGET).name("Renamed")
				.likes(0).liked(false).mine(true).usage(0))
				.when(mapper).toV1(entry);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(put("/api/v1/pacing/library/{id}", "e1")
						.contentType(APPLICATION_JSON)
						.content("{\"name\":\"Renamed\",\"definition\":{\"id\":\"w_1\"},\"expectedUpdatedAt\":\"t2\"}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.name").value("Renamed"));
	}

	@Test
	void shouldReturn409WithCurrentUpdatedAtOnStaleEntryConflictTest() throws Exception {
		// Given: US-118 - a concurrent edit is reported with the current stamp, never silently overwritten
		stubCurrentUser();
		doReturn(PacingLibrarySaveOutcome.staleEntry("t3")).when(pacingClient)
				.updateLibraryEntry(any(), eq("e1"), eq("Renamed"), eq(null), any(), eq("t2"));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(put("/api/v1/pacing/library/{id}", "e1")
						.contentType(APPLICATION_JSON)
						.content("{\"name\":\"Renamed\",\"definition\":{\"id\":\"w_1\"},\"expectedUpdatedAt\":\"t2\"}"))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.reason").value("stale_entry"))
				.andExpect(jsonPath("$.currentUpdatedAt").value("t3"));
	}

	@Test
	void shouldDeleteLibraryEntryTest() throws Exception {
		// Given:
		stubCurrentUser();
		doReturn(PacingLibrarySaveOutcome.deleted("e1")).when(pacingClient)
				.deleteLibraryEntry(any(), eq("e1"), eq("t2"));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(delete("/api/v1/pacing/library/{id}", "e1")
						.contentType(APPLICATION_JSON)
						.content("{\"expectedUpdatedAt\":\"t2\"}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.id").value("e1"));
	}

	@Test
	void shouldLikeLibraryEntryTest() throws Exception {
		// Given:
		stubCurrentUser();
		doReturn(new PacingLikeResult(true, 4)).when(pacingClient).likeLibraryEntry(any(), eq("e1"), eq(true));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/library/{id}/like", "e1"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.liked").value(true))
				.andExpect(jsonPath("$.likes").value(4));
	}

	@Test
	void shouldUnlikeLibraryEntryTest() throws Exception {
		// Given:
		stubCurrentUser();
		doReturn(new PacingLikeResult(false, 3)).when(pacingClient).likeLibraryEntry(any(), eq("e1"), eq(false));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(delete("/api/v1/pacing/library/{id}/like", "e1"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.liked").value(false))
				.andExpect(jsonPath("$.likes").value(3));
	}
}
