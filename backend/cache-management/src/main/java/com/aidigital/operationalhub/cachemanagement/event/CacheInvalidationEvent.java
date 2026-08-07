package com.aidigital.operationalhub.cachemanagement.event;

import java.time.LocalDateTime;

/**
 * A cross-node cache-invalidation event: a tracked class changed at a point in time.
 *
 * @param trackedClass the {@link Class#getSimpleName() simple class name} that changed
 * @param updatedTime  when the change was published (UTC)
 */
public record CacheInvalidationEvent(String trackedClass, LocalDateTime updatedTime) {

}
