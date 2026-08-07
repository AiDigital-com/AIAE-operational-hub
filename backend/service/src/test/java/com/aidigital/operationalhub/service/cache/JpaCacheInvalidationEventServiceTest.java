package com.aidigital.operationalhub.service.cache;

import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEvent;
import com.aidigital.operationalhub.domain.entity.HubCacheUpdateEvent;
import com.aidigital.operationalhub.domain.repository.HubCacheUpdateEventRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link JpaCacheInvalidationEventService}.
 */
@ExtendWith(MockitoExtension.class)
class JpaCacheInvalidationEventServiceTest {

	@Mock
	private HubCacheUpdateEventRepository eventRepository;

	@InjectMocks
	private JpaCacheInvalidationEventService service;

	@Test
	void shouldMapStoredEventsToInvalidationEventsTest() {
		// Given:
		LocalDateTime since = LocalDateTime.now().minusMinutes(5);
		HubCacheUpdateEvent stored = new HubCacheUpdateEvent();
		stored.setTrackedClass("HubTeam");
		stored.setUpdatedAt(since.plusMinutes(1));
		when(eventRepository.findByUpdatedAtAfterOrderByUpdatedAtAsc(since)).thenReturn(List.of(stored));

		// When:
		List<CacheInvalidationEvent> result = service.updatesAfter(since);

		// Verification:
		assertThat(result).singleElement()
				.satisfies(event -> {
					assertThat(event.trackedClass()).isEqualTo("HubTeam");
					assertThat(event.updatedTime()).isEqualTo(stored.getUpdatedAt());
				});
	}

	@Test
	void shouldPersistEventWithClassNameAndTimestampTest() {
		// Given:
		ArgumentCaptor<HubCacheUpdateEvent> captor = ArgumentCaptor.forClass(HubCacheUpdateEvent.class);

		// When: published via the default Class overload (covers the interface default too)
		service.publishUpdateEvent(String.class);

		// Verification:
		verify(eventRepository).save(captor.capture());
		assertThat(captor.getValue().getTrackedClass()).isEqualTo("String");
		assertThat(captor.getValue().getUpdatedAt()).isNotNull();
	}

	@Test
	void shouldPruneOldEventsOnCleanupTest() {
		// Given:
		when(eventRepository.deleteByUpdatedAtBefore(any())).thenReturn(3);

		// When:
		service.cleanupOldEvents();

		// Verification: the cutoff is one retention-day (24h) before now
		ArgumentCaptor<LocalDateTime> cutoffCaptor = ArgumentCaptor.forClass(LocalDateTime.class);
		verify(eventRepository).deleteByUpdatedAtBefore(cutoffCaptor.capture());
		assertThat(cutoffCaptor.getValue())
				.isCloseTo(LocalDateTime.now(ZoneOffset.UTC).minusDays(1), within(5, ChronoUnit.SECONDS));
	}
}
