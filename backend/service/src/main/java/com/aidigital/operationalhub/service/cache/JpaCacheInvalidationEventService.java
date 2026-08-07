package com.aidigital.operationalhub.service.cache;

import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEvent;
import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEventService;
import com.aidigital.operationalhub.domain.entity.HubCacheUpdateEvent;
import com.aidigital.operationalhub.domain.repository.HubCacheUpdateEventRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

/**
 * Database-backed {@link CacheInvalidationEventService}: publishes events as rows in
 * {@code hub_cache_update_event} (the shared store every node reads) and reads back recent rows. A
 * scheduled cleanup prunes rows older than the retention window, since only recent rows are ever polled.
 */
@Service
@RequiredArgsConstructor
public class JpaCacheInvalidationEventService implements CacheInvalidationEventService {

	private static final Logger LOG = LoggerFactory.getLogger(JpaCacheInvalidationEventService.class);
	private static final long RETENTION_DAYS = 1;

	private final HubCacheUpdateEventRepository eventRepository;

	@Override
	@Transactional(readOnly = true)
	public List<CacheInvalidationEvent> updatesAfter(LocalDateTime time) {
		return eventRepository.findByUpdatedAtAfterOrderByUpdatedAtAsc(time).stream()
				.map(event -> new CacheInvalidationEvent(event.getTrackedClass(), event.getUpdatedAt()))
				.toList();
	}

	@Override
	@Transactional
	public void publishUpdateEvent(String trackedClass) {
		HubCacheUpdateEvent event = new HubCacheUpdateEvent();
		event.setTrackedClass(trackedClass);
		event.setUpdatedAt(LocalDateTime.now(ZoneOffset.UTC));
		eventRepository.save(event);
	}

	/**
	 * Prunes invalidation events older than the retention window; only recent rows are ever polled.
	 */
	@Scheduled(cron = "${app.cache-management.cleanup-cron:0 30 1 * * *}")
	@Transactional
	public void cleanupOldEvents() {
		LocalDateTime cutoff = LocalDateTime.now(ZoneOffset.UTC).minusDays(RETENTION_DAYS);
		int deleted = eventRepository.deleteByUpdatedAtBefore(cutoff);
		if (deleted > 0) {
			LOG.info("Pruned {} cache-invalidation event(s) older than {}", deleted, cutoff);
		}
	}
}
