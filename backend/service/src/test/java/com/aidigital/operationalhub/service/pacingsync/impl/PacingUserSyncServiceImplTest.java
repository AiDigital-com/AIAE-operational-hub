package com.aidigital.operationalhub.service.pacingsync.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSyncStats;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncResult;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.pacingsync.model.PacingUserSyncSummary;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link PacingUserSyncServiceImpl}. Mirrors
 * {@code NetSuiteSyncServiceImplTest}: this class only reads the Hub roster, calls Pacing, and
 * delegates the write side to {@link PacingUserSyncReconciler} - it holds no database transaction of
 * its own. Write-back behavior is covered by {@code PacingUserSyncReconcilerTest}.
 */
@ExtendWith(MockitoExtension.class)
class PacingUserSyncServiceImplTest {

	@Mock
	private HubUserService hubUserService;

	@Mock
	private PacingClient pacingClient;

	@Mock
	private PacingUserSyncReconciler reconciler;

	@InjectMocks
	private PacingUserSyncServiceImpl service;

	@Test
	void shouldSendEveryActiveAndInactiveUserThenDelegateToTheReconcilerTest() {
		// Given: one ACTIVE and one INACTIVE Hub user, both with an email and a display name
		HubUser activeUser = hubUser(1L, "active@x.com", "Active One", HubStatus.ACTIVE.getCode());
		HubUser inactiveUser = hubUser(2L, "inactive@x.com", "Inactive One", HubStatus.INACTIVE.getCode());
		List<HubUser> hubUsers = List.of(activeUser, inactiveUser);
		Map<String, String> pacingIdsByEmail = Map.of("active@x.com", "uuid-1", "inactive@x.com", "uuid-2");
		PacingSyncStats stats = new PacingSyncStats(1, 0, 1, 0);
		PacingUserSyncResult syncResult = new PacingUserSyncResult(pacingIdsByEmail, stats);
		PacingUserSyncSummary reconcilerResult = new PacingUserSyncSummary(2, 1, 0, 1, 0, 2);

		when(hubUserService.findAll()).thenReturn(hubUsers);
		when(pacingClient.syncUsers(any())).thenReturn(syncResult);
		when(reconciler.reconcile(eq(hubUsers), any(), eq(pacingIdsByEmail), eq(stats))).thenReturn(reconcilerResult);

		// When:
		PacingUserSyncSummary summary = service.sync();

		// Then:
		assertThat(summary).isSameAs(reconcilerResult);
		@SuppressWarnings("unchecked")
		ArgumentCaptor<List<PacingUserSyncEntry>> entriesCaptor = ArgumentCaptor.forClass(List.class);
		verify(pacingClient).syncUsers(entriesCaptor.capture());
		List<PacingUserSyncEntry> sentEntries = entriesCaptor.getValue();
		assertThat(sentEntries).hasSize(2);
		assertThat(sentEntries)
				.filteredOn(entry -> entry.email().equals("active@x.com"))
				.singleElement()
				.satisfies(entry -> assertThat(entry.active()).isTrue());
		assertThat(sentEntries)
				.filteredOn(entry -> entry.email().equals("inactive@x.com"))
				.singleElement()
				.satisfies(entry -> assertThat(entry.active()).isFalse());
	}

	@Test
	void shouldSkipAUserMissingAnEmailTest() {
		// Given:
		HubUser noEmail = hubUser(3L, null, "No Email", HubStatus.ACTIVE.getCode());
		List<HubUser> hubUsers = List.of(noEmail);

		PacingUserSyncResult emptyResult = new PacingUserSyncResult(Map.of(), new PacingSyncStats(0, 0, 0, 0));
		when(hubUserService.findAll()).thenReturn(hubUsers);
		when(pacingClient.syncUsers(any())).thenReturn(emptyResult);
		when(reconciler.reconcile(eq(hubUsers), any(), eq(Map.of()), any()))
				.thenReturn(new PacingUserSyncSummary(0, 0, 0, 0, 0, 0));

		// When:
		service.sync();

		// Then:
		@SuppressWarnings("unchecked")
		ArgumentCaptor<List<PacingUserSyncEntry>> entriesCaptor = ArgumentCaptor.forClass(List.class);
		verify(pacingClient).syncUsers(entriesCaptor.capture());
		assertThat(entriesCaptor.getValue()).isEmpty();
	}

	@Test
	void shouldSkipAUserMissingADisplayNameTest() {
		// Given: a blank display name is treated the same as a missing one - Pacing rejects the batch
		// on an empty-string name just as it would on a null
		HubUser blankName = hubUser(4L, "blank@x.com", "   ", HubStatus.ACTIVE.getCode());
		List<HubUser> hubUsers = List.of(blankName);

		PacingUserSyncResult emptyResult = new PacingUserSyncResult(Map.of(), new PacingSyncStats(0, 0, 0, 0));
		when(hubUserService.findAll()).thenReturn(hubUsers);
		when(pacingClient.syncUsers(any())).thenReturn(emptyResult);
		when(reconciler.reconcile(eq(hubUsers), any(), eq(Map.of()), any()))
				.thenReturn(new PacingUserSyncSummary(0, 0, 0, 0, 0, 0));

		// When:
		service.sync();

		// Then:
		@SuppressWarnings("unchecked")
		ArgumentCaptor<List<PacingUserSyncEntry>> entriesCaptor = ArgumentCaptor.forClass(List.class);
		verify(pacingClient).syncUsers(entriesCaptor.capture());
		assertThat(entriesCaptor.getValue()).isEmpty();
	}

	@Test
	void shouldNeverCallHubUserServiceSaveDirectlyItselfTest() {
		// Given: the orchestrator must never write - only the reconciler does
		HubUser user = hubUser(5L, "a@x.com", "A", HubStatus.ACTIVE.getCode());
		when(hubUserService.findAll()).thenReturn(List.of(user));
		when(pacingClient.syncUsers(any()))
				.thenReturn(new PacingUserSyncResult(Map.of("a@x.com", "uuid"), new PacingSyncStats(1, 0, 0, 0)));
		when(reconciler.reconcile(any(), any(), any(), any()))
				.thenReturn(new PacingUserSyncSummary(1, 1, 0, 0, 0, 1));

		// When:
		service.sync();

		// Then:
		verify(hubUserService, never()).save(any());
	}

	private static HubUser hubUser(Long id, String email, String displayName, String status) {
		HubUser user = new HubUser();
		user.setId(id);
		user.setEmail(email);
		user.setDisplayName(displayName);
		user.setStatus(status);
		return user;
	}
}
