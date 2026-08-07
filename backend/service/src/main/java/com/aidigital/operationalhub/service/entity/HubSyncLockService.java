package com.aidigital.operationalhub.service.entity;

/**
 * Single gateway to the {@code hub_sync_lock} entity and its repository.
 *
 * <p>Per the "one entity, one repository, one service" rule, this is the only collaborator that
 * touches {@code HubSyncLockRepository}; other collaborators (e.g. {@code SyncLockGuard}) depend on
 * this contract instead of the repository.
 */
public interface HubSyncLockService {

	/**
	 * Attempts to acquire the named lock, committing immediately so the acquisition is visible to every
	 * other node as soon as this call returns.
	 *
	 * @param lockName the lock to acquire
	 * @return {@code true} when this call acquired the lock, {@code false} when another node holds it
	 */
	boolean tryAcquire(String lockName);

	/**
	 * Releases the named lock, committing immediately.
	 *
	 * @param lockName the lock to release
	 */
	void release(String lockName);
}
