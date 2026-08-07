package com.aidigital.operationalhub.application.scheduler;

import com.aidigital.operationalhub.service.entity.HubSyncLockService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link SyncLockGuard}.
 */
@ExtendWith(MockitoExtension.class)
class SyncLockGuardTest {

	private static final String LOCK_NAME = "test_job";

	@Mock
	private HubSyncLockService hubSyncLockService;

	@InjectMocks
	private SyncLockGuard guard;

	@Test
	void shouldRunTheGuardedWorkAndReleaseTheLockWhenAcquiredTest() {
		// Given:
		when(hubSyncLockService.tryAcquire(LOCK_NAME)).thenReturn(true);
		AtomicBoolean ran = new AtomicBoolean(false);

		// When:
		guard.runIfLockAcquired(LOCK_NAME, "test job", () -> ran.set(true));

		// Then:
		assertThat(ran).isTrue();
		verify(hubSyncLockService).release(LOCK_NAME);
	}

	@Test
	void shouldSkipTheGuardedWorkWhenTheLockIsHeldByAnotherNodeTest() {
		// Given: another node already holds the lock
		when(hubSyncLockService.tryAcquire(LOCK_NAME)).thenReturn(false);
		AtomicBoolean ran = new AtomicBoolean(false);

		// When:
		guard.runIfLockAcquired(LOCK_NAME, "test job", () -> ran.set(true));

		// Then: the work never ran, and no release was attempted
		assertThat(ran).isFalse();
		verify(hubSyncLockService, never()).release(LOCK_NAME);
	}

	@Test
	void shouldReleaseTheLockEvenWhenTheGuardedWorkThrowsTest() {
		// Given:
		when(hubSyncLockService.tryAcquire(LOCK_NAME)).thenReturn(true);

		// When/Then: the guarded work's exception propagates, but the lock is still released
		assertThatThrownBy(() -> guard.runIfLockAcquired(LOCK_NAME, "test job", () -> {
			throw new IllegalStateException("boom");
		})).isInstanceOf(IllegalStateException.class);
		verify(hubSyncLockService).release(LOCK_NAME);
	}

	@Test
	void shouldSkipWithoutThrowingWhenAcquiringTheLockFailsTest() {
		// Given:
		when(hubSyncLockService.tryAcquire(LOCK_NAME)).thenThrow(new RuntimeException("connection refused"));
		AtomicBoolean ran = new AtomicBoolean(false);

		// When:
		guard.runIfLockAcquired(LOCK_NAME, "test job", () -> ran.set(true));

		// Then: the failure is swallowed, not propagated
		assertThat(ran).isFalse();
	}

	@Test
	void shouldSwallowAFailedReleaseTest() {
		// Given: release itself throws - it must not surface past runIfLockAcquired
		when(hubSyncLockService.tryAcquire(LOCK_NAME)).thenReturn(true);
		doThrow(new RuntimeException("release failed")).when(hubSyncLockService).release(LOCK_NAME);
		AtomicBoolean ran = new AtomicBoolean(false);

		// When:
		guard.runIfLockAcquired(LOCK_NAME, "test job", () -> ran.set(true));

		// Then: the guarded work still ran, and the failed release did not propagate
		assertThat(ran).isTrue();
	}
}
