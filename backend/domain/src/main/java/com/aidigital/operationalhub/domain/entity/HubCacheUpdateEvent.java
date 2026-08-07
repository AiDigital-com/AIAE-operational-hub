package com.aidigital.operationalhub.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NonNull;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.Objects;

/**
 * JPA entity mapping the {@code hub_cache_update_event} table: an append-only log of cross-node cache
 * invalidations. Each row records that a tracked class changed at a point in time (UTC); every node
 * polls rows newer than its cursor and clears the cache regions registered for the class. Old rows are
 * pruned by a scheduled cleanup, since only recent rows are ever read.
 */
@Getter
@Setter
@Entity
@Table(name = "hub_cache_update_event")
public class HubCacheUpdateEvent {

	@Id
	@NonNull
	@Column(name = "id", nullable = false)
	@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "hub_cache_update_event_sequence")
	@SequenceGenerator(sequenceName = "HUB_CACHE_UPDATE_EVENT_SEQ", name = "hub_cache_update_event_sequence")
	private Long id;

	/**
	 * Simple name of the class that changed.
	 */
	@Column(name = "tracked_class", nullable = false)
	private String trackedClass;

	/**
	 * When the change was published (UTC).
	 */
	@Column(name = "updated_at", nullable = false)
	private LocalDateTime updatedAt;

	@Override
	public boolean equals(Object o) {
		if (this == o) {
			return true;
		}
		if (!(o instanceof HubCacheUpdateEvent that)) {
			return false;
		}
		return Objects.equals(getId(), that.getId());
	}

	@Override
	public int hashCode() {
		return Objects.hash(getId());
	}

	@Override
	public String toString() {
		return "HubCacheUpdateEvent{id=" + id + ", trackedClass=" + trackedClass + ", updatedAt=" + updatedAt + "}";
	}
}
