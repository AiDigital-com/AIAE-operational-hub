package com.aidigital.operationalhub.cachemanagement.updater;

import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEvent;
import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEventService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link ScheduledCacheUpdater}.
 */
@ExtendWith(MockitoExtension.class)
class ScheduledCacheUpdaterTest {

	@Mock
	private CacheInvalidationEventService eventService;

	@Mock
	private CacheUpdaterService cacheUpdaterService;

	@Test
	void shouldClearCachesForEachPolledEventTest() {
		// Given: the store reports one changed class (constructor takes a list, so build directly)
		when(eventService.updatesAfter(any())).thenReturn(List.of(
				new CacheInvalidationEvent("HubTeam", LocalDateTime.now(ZoneOffset.UTC))));
		ScheduledCacheUpdater updater = new ScheduledCacheUpdater(List.of(eventService), cacheUpdaterService);

		// When:
		updater.pollAndEvict();

		// Verification:
		verify(cacheUpdaterService).clearCachesForClass("HubTeam");
	}

	@Test
	void shouldDoNothingWhenNoEventsTest() {
		// Given:
		when(eventService.updatesAfter(any())).thenReturn(List.of());
		ScheduledCacheUpdater updater = new ScheduledCacheUpdater(List.of(eventService), cacheUpdaterService);

		// When:
		updater.pollAndEvict();

		// Verification:
		verifyNoInteractions(cacheUpdaterService);
	}
}
