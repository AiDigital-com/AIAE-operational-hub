package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.entity.HubCacheUpdateEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Spring Data repository for {@link HubCacheUpdateEvent} ({@code hub_cache_update_event}).
 */
public interface HubCacheUpdateEventRepository extends JpaRepository<HubCacheUpdateEvent, Long> {

	/**
	 * Returns the events published strictly after the given time, oldest first.
	 *
	 * @param time the exclusive lower bound (UTC)
	 * @return the matching events
	 */
	List<HubCacheUpdateEvent> findByUpdatedAtAfterOrderByUpdatedAtAsc(LocalDateTime time);

	/**
	 * Deletes events published strictly before the given time (retention cleanup), as a single bulk
	 * DELETE statement rather than a select-then-delete-per-row pattern. Served by the existing
	 * {@code idx_hub_cache_update_event_updated_at} index.
	 *
	 * @param time the exclusive upper bound (UTC)
	 * @return the number of rows deleted
	 */
	@Modifying
	@Query("delete from HubCacheUpdateEvent e where e.updatedAt < :time")
	int deleteByUpdatedAtBefore(@Param("time") LocalDateTime time);
}
