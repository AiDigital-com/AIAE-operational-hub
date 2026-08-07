package com.aidigital.operationalhub.cachemanagement.updater;

import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEvent;
import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEventService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

/**
 * Polls the {@link CacheInvalidationEventService}(s) on a fixed delay and clears the cache regions for
 * every class reported as changed since the last poll — the node-local half of cross-node invalidation.
 *
 * <p>Requires {@code @EnableScheduling} on the application. The cursor starts ten minutes in the past
 * so events published between cache warm-up and the first poll are not missed. Clearing a region is
 * idempotent, so re-observing an event across a boundary is harmless.
 */
@Component
public class ScheduledCacheUpdater {

	private static final Logger LOG = LoggerFactory.getLogger(ScheduledCacheUpdater.class);
	private static final long STARTUP_LOOKBACK_MINUTES = 10;

	private final List<CacheInvalidationEventService> eventServices;
	private final CacheUpdaterService cacheUpdaterService;

	private volatile LocalDateTime lastSynchronisationTime;

	/**
	 * Creates the poller, seeding the cursor in the recent past.
	 *
	 * @param eventServices       the available event stores (zero or more)
	 * @param cacheUpdaterService the region-clearing service
	 */
	public ScheduledCacheUpdater(
			List<CacheInvalidationEventService> eventServices, CacheUpdaterService cacheUpdaterService) {
		this.eventServices = eventServices;
		this.cacheUpdaterService = cacheUpdaterService;
		this.lastSynchronisationTime = LocalDateTime.now(ZoneOffset.UTC).minusMinutes(STARTUP_LOOKBACK_MINUTES);
	}

	/**
	 * Reads new invalidation events and clears the corresponding cache regions, then advances the cursor.
	 */
	@Scheduled(
			fixedDelayString = "${app.cache-management.poll-interval-ms:15000}",
			initialDelayString = "${app.cache-management.initial-delay-ms:15000}")
	public void pollAndEvict() {
		LocalDateTime polledAt = LocalDateTime.now(ZoneOffset.UTC);
		LocalDateTime since = lastSynchronisationTime;
		for (CacheInvalidationEventService eventService : eventServices) {
			for (CacheInvalidationEvent event : eventService.updatesAfter(since)) {
				cacheUpdaterService.clearCachesForClass(event.trackedClass());
			}
		}
		lastSynchronisationTime = polledAt;
		LOG.trace("Cache invalidation poll complete; cursor advanced to {}", polledAt);
	}
}
