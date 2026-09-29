package com.aidigital.operationalhub.application.scheduler;

import com.aidigital.operationalhub.service.pacingsync.PacingAudienceSyncService;
import com.aidigital.operationalhub.service.pacingsync.model.PacingAudienceSyncSummary;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link PacingAudienceSyncScheduler}, mirroring {@code PacingUserSyncSchedulerTest}.
 */
@ExtendWith(MockitoExtension.class)
class PacingAudienceSyncSchedulerTest {

	@Mock
	private PacingAudienceSyncService pacingAudienceSyncService;

	@Mock
	private SyncLockGuard syncLockGuard;

	@InjectMocks
	private PacingAudienceSyncScheduler scheduler;

	@Test
	void shouldRunPushOnScheduleWhenTheLockIsAcquiredTest() {
		// Given: the guard simulates having acquired the lock by invoking the guarded work
		doAnswer(invocation -> {
			Runnable work = invocation.getArgument(2);
			work.run();
			return null;
		}).when(syncLockGuard).runIfLockAcquired(anyString(), anyString(), any());
		when(pacingAudienceSyncService.sync()).thenReturn(new PacingAudienceSyncSummary(1, 1, 0, 0, 0));

		// When:
		scheduler.syncDaily();

		// Verification:
		verify(pacingAudienceSyncService).sync();
	}

	@Test
	void shouldSkipPushWhenTheLockIsHeldByAnotherNodeTest() {
		// Given: the guard simulates another node already holding the lock - the guarded work never runs
		// (no stubbing needed: a mocked void method is a no-op by default)

		// When:
		scheduler.syncDaily();

		// Verification: the push itself was never invoked
		verify(pacingAudienceSyncService, never()).sync();
	}

	@Test
	void shouldSwallowFailureSoTheScheduleKeepsFiringTest() {
		// Given:
		doAnswer(invocation -> {
			Runnable work = invocation.getArgument(2);
			work.run();
			return null;
		}).when(syncLockGuard).runIfLockAcquired(anyString(), anyString(), any());
		when(pacingAudienceSyncService.sync()).thenThrow(new RuntimeException("boom"));

		// When / Then: a transient failure is logged, not propagated
		assertThatCode(scheduler::syncDaily).doesNotThrowAnyException();
	}
}
