package com.aidigital.operationalhub.application.scheduler;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryOperationContext;
import com.aidigital.operationalhub.service.netsuite.NetSuiteSyncService;
import com.aidigital.operationalhub.service.netsuite.model.SyncSummary;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link NetSuiteSyncScheduler}.
 */
@ExtendWith(MockitoExtension.class)
class NetSuiteSyncSchedulerTest {

	@Mock
	private NetSuiteSyncService netSuiteSyncService;

	@Mock
	private SyncLockGuard syncLockGuard;

	@Spy
	private BigQueryOperationContext operationContext;

	@InjectMocks
	private NetSuiteSyncScheduler scheduler;

	@Test
	void shouldRunSyncOnScheduleWhenTheLockIsAcquiredTest() {
		// Given: the guard simulates having acquired the lock by invoking the guarded work
		doAnswer(invocation -> {
			Runnable work = invocation.getArgument(2);
			work.run();
			return null;
		}).when(syncLockGuard).runIfLockAcquired(anyString(), anyString(), any());
		when(netSuiteSyncService.sync()).thenReturn(new SyncSummary(1, 2, 3, 4));

		// When:
		scheduler.syncDaily();

		// Verification:
		verify(netSuiteSyncService).sync();
	}

	@Test
	void shouldNameItsOwnBigQueryWorkAndForgetItAfterwardsTest() {
		// Given: the guard runs the guarded work, as the lock-holding node does
		doAnswer(invocation -> {
			Runnable work = invocation.getArgument(2);
			work.run();
			return null;
		}).when(syncLockGuard).runIfLockAcquired(anyString(), anyString(), any());
		when(netSuiteSyncService.sync()).thenAnswer(invocation -> {
			// Read inside the sync: this is the only moment the name is supposed to exist.
			assertThat(operationContext.current()).isEqualTo("netsuite_sync");
			return new SyncSummary(1, 2, 3, 4);
		});

		// When:
		scheduler.syncDaily();

		// Then: named while it runs, unnamed afterwards, so a pooled thread carries nothing over
		verify(netSuiteSyncService).sync();
		assertThat(operationContext.current()).isEqualTo("unlabelled");
	}

	@Test
	void shouldSkipSyncWhenTheLockIsHeldByAnotherNodeTest() {
		// Given: the guard simulates another node already holding the lock - the guarded work never runs
		// (no stubbing needed: a mocked void method is a no-op by default)

		// When:
		scheduler.syncDaily();

		// Verification: the sync itself was never invoked
		verify(netSuiteSyncService, never()).sync();
	}

	@Test
	void shouldSwallowFailureSoTheScheduleKeepsFiringTest() {
		// Given:
		doAnswer(invocation -> {
			Runnable work = invocation.getArgument(2);
			work.run();
			return null;
		}).when(syncLockGuard).runIfLockAcquired(anyString(), anyString(), any());
		when(netSuiteSyncService.sync()).thenThrow(new RuntimeException("boom"));

		// When / Then: a transient failure is logged, not propagated
		assertThatCode(scheduler::syncDaily).doesNotThrowAnyException();
	}
}
