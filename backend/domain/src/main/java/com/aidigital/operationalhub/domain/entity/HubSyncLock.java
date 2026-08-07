package com.aidigital.operationalhub.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NonNull;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.Objects;

/**
 * JPA entity mapping the {@code hub_sync_lock} table: one row per guarded job, used as a
 * mutual-exclusion lock so only one node in a multi-node deployment runs a given job at a time.
 * Acquired via a conditional {@code UPDATE ... WHERE locked = false} rather than a database-specific
 * advisory-lock function, mirroring how Liquibase's own {@code DATABASECHANGELOGLOCK} table works.
 */
@Getter
@Setter
@Entity
@Table(name = "hub_sync_lock")
public class HubSyncLock {

	@Id
	@NonNull
	@Column(name = "lock_name", nullable = false)
	private String lockName;

	@Column(name = "locked", nullable = false)
	private boolean locked;

	/**
	 * When the lock was last acquired (UTC); stale while {@link #locked} is {@code false}.
	 */
	@Column(name = "locked_at")
	private LocalDateTime lockedAt;

	@Override
	public boolean equals(Object o) {
		if (this == o) {
			return true;
		}
		if (!(o instanceof HubSyncLock that)) {
			return false;
		}
		return Objects.equals(getLockName(), that.getLockName());
	}

	@Override
	public int hashCode() {
		return Objects.hash(getLockName());
	}

	@Override
	public String toString() {
		return "HubSyncLock{lockName=" + lockName + ", locked=" + locked + ", lockedAt=" + lockedAt + "}";
	}
}
