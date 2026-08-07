package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.entity.HubSyncLock;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;

/**
 * Spring Data repository for {@link HubSyncLock} ({@code hub_sync_lock}).
 */
public interface HubSyncLockRepository extends JpaRepository<HubSyncLock, String> {

	/**
	 * Atomically acquires the named lock: flips {@code locked} from {@code false} to {@code true} in a
	 * single conditional {@code UPDATE}. Two concurrent callers can never both succeed, since the
	 * database serializes the row write - this is the whole mutual-exclusion primitive, the same one
	 * Liquibase's own {@code DATABASECHANGELOGLOCK} table relies on.
	 *
	 * @param lockName the lock to acquire
	 * @param now      the acquisition time (UTC), recorded for observability
	 * @return {@code 1} when this call acquired the lock, {@code 0} when it was already held
	 */
	@Modifying
	@Query("update HubSyncLock l set l.locked = true, l.lockedAt = :now where l.lockName = :lockName "
			+ "and l.locked = false")
	int tryAcquire(@Param("lockName") String lockName, @Param("now") LocalDateTime now);

	/**
	 * Releases a previously-acquired lock.
	 *
	 * @param lockName the lock to release
	 * @return the number of rows updated ({@code 0} or {@code 1})
	 */
	@Modifying
	@Query("update HubSyncLock l set l.locked = false where l.lockName = :lockName")
	int release(@Param("lockName") String lockName);
}
