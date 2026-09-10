package com.aidigital.operationalhub.service.pacingsync.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSyncStats;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncEntry;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.pacingsync.model.PacingUserSyncSummary;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * Pure Mockito unit tests for {@link PacingUserSyncReconciler} - the write-back logic, kept separate
 * from {@link PacingUserSyncServiceImpl} the same way {@code NetSuiteSyncReconciler} is kept separate
 * from {@code NetSuiteSyncServiceImpl}.
 *
 * <p>createdInPacing/activated/deactivated/unchanged are no longer derived here from what was SENT -
 * they are taken verbatim from the {@link PacingSyncStats} Pacing returns, so these tests pass a stats
 * value directly and assert it passes through unchanged, rather than deriving it from entries.
 */
@ExtendWith(MockitoExtension.class)
class PacingUserSyncReconcilerTest {

	@Mock
	private HubUserService hubUserService;

	@InjectMocks
	private PacingUserSyncReconciler reconciler;

	@Test
	void shouldWriteBackAPacingIdForAUserWhoHadNoneBeforeTest() {
		// Given:
		HubUser user = new HubUser();
		user.setId(1L);
		user.setEmail("new@x.com");
		List<HubUser> hubUsers = List.of(user);
		List<PacingUserSyncEntry> entries = List.of(new PacingUserSyncEntry("new@x.com", "New", true, null));
		Map<String, String> pacingIdsByEmail = Map.of("new@x.com", "pacing-uuid-1");
		PacingSyncStats stats = new PacingSyncStats(1, 0, 0, 0);

		// When:
		PacingUserSyncSummary summary = reconciler.reconcile(hubUsers, entries, pacingIdsByEmail, stats);

		// Then:
		assertThat(user.getPacingUserId()).isEqualTo("pacing-uuid-1");
		verify(hubUserService).save(user);
		assertThat(summary).isEqualTo(new PacingUserSyncSummary(1, 1, 0, 0, 0, 1));
	}

	@Test
	void shouldNotReSaveAUserWhosePacingIdIsAlreadyCurrentTest() {
		// Given:
		HubUser user = new HubUser();
		user.setId(2L);
		user.setEmail("existing@x.com");
		user.setPacingUserId("pacing-uuid-2");
		List<HubUser> hubUsers = List.of(user);
		List<PacingUserSyncEntry> entries = List.of(new PacingUserSyncEntry("existing@x.com", "Existing", true, null));
		Map<String, String> pacingIdsByEmail = Map.of("existing@x.com", "pacing-uuid-2");
		PacingSyncStats stats = new PacingSyncStats(0, 0, 0, 1);

		// When:
		PacingUserSyncSummary summary = reconciler.reconcile(hubUsers, entries, pacingIdsByEmail, stats);

		// Then: nothing changed, so nothing is saved
		verify(hubUserService, never()).save(user);
		assertThat(summary).isEqualTo(new PacingUserSyncSummary(1, 0, 0, 0, 1, 0));
	}

	@Test
	void shouldWriteBackACorrectedPacingIdTest() {
		// Given: the id changed - a correction, e.g. a re-provisioned Pacing row
		HubUser user = new HubUser();
		user.setId(3L);
		user.setEmail("corrected@x.com");
		user.setPacingUserId("stale-uuid");
		List<HubUser> hubUsers = List.of(user);
		List<PacingUserSyncEntry> entries = List.of(new PacingUserSyncEntry("corrected@x.com", "Corrected", true, null));
		Map<String, String> pacingIdsByEmail = Map.of("corrected@x.com", "fresh-uuid");
		PacingSyncStats stats = new PacingSyncStats(0, 0, 0, 1);

		// When:
		PacingUserSyncSummary summary = reconciler.reconcile(hubUsers, entries, pacingIdsByEmail, stats);

		// Then:
		assertThat(user.getPacingUserId()).isEqualTo("fresh-uuid");
		verify(hubUserService).save(user);
		assertThat(summary).isEqualTo(new PacingUserSyncSummary(1, 0, 0, 0, 1, 1));
	}

	@Test
	void shouldPassThroughPacingsDeactivatedCountUnchangedTest() {
		// Given: the real bug this fix closes - deactivated must come from Pacing's stats, not from
		// "this entry was sent with active=false" (which the reconciler no longer even looks at).
		HubUser user = new HubUser();
		user.setId(4L);
		user.setEmail("gone@x.com");
		user.setPacingUserId("pacing-uuid-4");
		List<HubUser> hubUsers = List.of(user);
		List<PacingUserSyncEntry> entries = List.of(new PacingUserSyncEntry("gone@x.com", "Gone", false, null));
		Map<String, String> pacingIdsByEmail = Map.of("gone@x.com", "pacing-uuid-4");
		PacingSyncStats stats = new PacingSyncStats(0, 0, 1, 0);

		// When:
		PacingUserSyncSummary summary = reconciler.reconcile(hubUsers, entries, pacingIdsByEmail, stats);

		// Then: id unchanged (no save), and deactivated is exactly what Pacing reported
		verify(hubUserService, never()).save(user);
		assertThat(summary).isEqualTo(new PacingUserSyncSummary(1, 0, 0, 1, 0, 0));
	}

	@Test
	void shouldReSendAnAlreadyInactiveEntryWithoutCountingItAsANewDeactivationTest() {
		// Given: the exact double-run scenario from the bug report - re-sending the same batch a second
		// time must report deactivated=0 because Pacing's stats say so, even though every inactive entry
		// is still SENT with active=false on every run.
		HubUser user = new HubUser();
		user.setId(6L);
		user.setEmail("stillgone@x.com");
		user.setPacingUserId("pacing-uuid-6");
		List<HubUser> hubUsers = List.of(user);
		List<PacingUserSyncEntry> entries = List.of(new PacingUserSyncEntry("stillgone@x.com", "Still Gone", false, null));
		Map<String, String> pacingIdsByEmail = Map.of("stillgone@x.com", "pacing-uuid-6");
		PacingSyncStats stats = new PacingSyncStats(0, 0, 0, 1);

		// When:
		PacingUserSyncSummary summary = reconciler.reconcile(hubUsers, entries, pacingIdsByEmail, stats);

		// Then:
		assertThat(summary.deactivated()).isZero();
		assertThat(summary.unchanged()).isEqualTo(1);
	}

	@Test
	void shouldSkipAUserPacingReturnedNoMappingForTest() {
		// Given: e.g. a user filtered out before the call ever reached Pacing (see
		// PacingUserSyncServiceImpl#isSyncable) - the map simply has no entry for them
		HubUser user = new HubUser();
		user.setId(5L);
		user.setEmail("unmapped@x.com");
		List<HubUser> hubUsers = List.of(user);
		List<PacingUserSyncEntry> entries = List.of();
		Map<String, String> pacingIdsByEmail = Map.of();
		PacingSyncStats stats = new PacingSyncStats(0, 0, 0, 0);

		// When:
		PacingUserSyncSummary summary = reconciler.reconcile(hubUsers, entries, pacingIdsByEmail, stats);

		// Then:
		verify(hubUserService, never()).save(user);
		assertThat(summary).isEqualTo(new PacingUserSyncSummary(0, 0, 0, 0, 0, 0));
	}
}
