package com.aidigital.operationalhub.application.scheduler;

import com.aidigital.operationalhub.service.entity.HubSyncLockService;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Guards a unit of work with a row in {@code hub_sync_lock}, so only one node in a multi-node
 * deployment runs it at a time. Uses a plain conditional-{@code UPDATE} lock table (see
 * {@link HubSyncLockService}) instead of a database-specific advisory-lock function, mirroring how
 * Liquibase's own {@code DATABASECHANGELOGLOCK} table works.
 */
@Component
@RequiredArgsConstructor
public class SyncLockGuard {

	private static final Logger LOG = LoggerFactory.getLogger(SyncLockGuard.class);

	private final HubSyncLockService hubSyncLockService;

	/**
	 * Runs {@code work} only if the given lock is acquired on this node; otherwise logs and skips,
	 * assuming another node already holds it. The lock is always released once {@code work} finishes,
	 * even if it throws.
	 *
	 * @param lockName a fixed, well-known lock name unique to the guarded unit of work, seeded as a row
	 *                 in {@code hub_sync_lock}
	 * @param label    a short label identifying the guarded work, for logging
	 * @param work     the guarded unit of work
	 */
	public void runIfLockAcquired(String lockName, String label, Runnable work) {
		boolean acquired;
		try {
			acquired = hubSyncLockService.tryAcquire(lockName);
		} catch (RuntimeException ex) {
			LOG.error("Lock acquisition failed for {}; skipping this run", label, ex);
			return;
		}
		if (!acquired) {
			LOG.info("Skipping {}: lock {} is held by another node", label, lockName);
			return;
		}
		try {
			work.run();
		} finally {
			release(lockName);
		}
	}

	/**
	 * Releases a previously-acquired lock, swallowing (and logging) any failure - the lock is retried
	 * on the guarded job's next scheduled firing regardless.
	 *
	 * @param lockName the lock to release
	 */
	void release(String lockName) {
		try {
			hubSyncLockService.release(lockName);
		} catch (RuntimeException ex) {
			LOG.warn("Failed to release lock {}", lockName, ex);
		}
	}
}
