package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.domain.repository.HubSyncLockRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link HubSyncLockServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class HubSyncLockServiceImplTest {

	private static final String LOCK_NAME = "netsuite_sync";

	@Mock
	private HubSyncLockRepository syncLockRepository;

	@InjectMocks
	private HubSyncLockServiceImpl service;

	@Test
	void shouldReturnTrueWhenTheConditionalUpdateAcquiresTheLockTest() {
		// Given:
		ArgumentCaptor<LocalDateTime> nowCaptor = ArgumentCaptor.forClass(LocalDateTime.class);
		when(syncLockRepository.tryAcquire(eq(LOCK_NAME), nowCaptor.capture())).thenReturn(1);

		// When:
		boolean acquired = service.tryAcquire(LOCK_NAME);

		// Then:
		assertThat(acquired).isTrue();
		assertThat(nowCaptor.getValue()).isNotNull();
		InOrder inOrder = inOrder(syncLockRepository);
		inOrder.verify(syncLockRepository).ensureExists(LOCK_NAME);
		inOrder.verify(syncLockRepository).tryAcquire(LOCK_NAME, nowCaptor.getValue());
	}

	@Test
	void shouldReturnFalseWhenTheLockIsAlreadyHeldTest() {
		// Given:
		when(syncLockRepository.tryAcquire(eq(LOCK_NAME), any())).thenReturn(0);

		// When:
		boolean acquired = service.tryAcquire(LOCK_NAME);

		// Then:
		assertThat(acquired).isFalse();
		verify(syncLockRepository).ensureExists(LOCK_NAME);
	}

	@Test
	void shouldDelegateReleaseToTheRepositoryTest() {
		// When:
		service.release(LOCK_NAME);

		// Then:
		verify(syncLockRepository).release(LOCK_NAME);
	}
}
