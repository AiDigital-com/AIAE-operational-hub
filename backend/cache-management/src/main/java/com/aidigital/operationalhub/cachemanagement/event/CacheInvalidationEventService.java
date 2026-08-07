package com.aidigital.operationalhub.cachemanagement.event;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Stores and reads cross-node cache-invalidation events.
 *
 * <p>The application provides an implementation backed by shared storage (e.g. a database table) so
 * that an event published on one node is visible to every other node's poller. The publishing node
 * also re-reads its own events on the next poll, which keeps all nodes — including the writer —
 * consistent.
 */
public interface CacheInvalidationEventService {

	/**
	 * Returns the invalidation events published strictly after the given time.
	 *
	 * @param time the exclusive lower bound (UTC)
	 * @return the matching events; never {@code null}
	 */
	List<CacheInvalidationEvent> updatesAfter(LocalDateTime time);

	/**
	 * Publishes an invalidation event for the given simple class name.
	 *
	 * @param trackedClass the {@link Class#getSimpleName() simple class name} that changed
	 */
	void publishUpdateEvent(String trackedClass);

	/**
	 * Publishes an invalidation event for the given class.
	 *
	 * @param trackedClass the class that changed
	 */
	default void publishUpdateEvent(Class<?> trackedClass) {
		publishUpdateEvent(trackedClass.getSimpleName());
	}
}
