package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.domain.repository.HubSyncLockRepository;
import com.aidigital.operationalhub.service.entity.HubSyncLockService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.ZoneOffset;

/**
 * Default {@link HubSyncLockService} delegating to {@link HubSyncLockRepository}.
 *
 * <p>Each method runs in its own {@code REQUIRES_NEW} transaction that commits before returning, so
 * the lock row's state is durable and visible to every other node the instant it changes, independent
 * of whatever transaction the guarded work itself opens.
 */
@Service
@RequiredArgsConstructor
public class HubSyncLockServiceImpl implements HubSyncLockService {

	private final HubSyncLockRepository syncLockRepository;

	@Override
	@Transactional(propagation = Propagation.REQUIRES_NEW)
	public boolean tryAcquire(String lockName) {
		return syncLockRepository.tryAcquire(lockName, LocalDateTime.now(ZoneOffset.UTC)) == 1;
	}

	@Override
	@Transactional(propagation = Propagation.REQUIRES_NEW)
	public void release(String lockName) {
		syncLockRepository.release(lockName);
	}
}
