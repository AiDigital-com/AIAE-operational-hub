package com.aidigital.operationalhub.cachemanagement.event;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit test for the {@link CacheInvalidationEventService} {@code Class} default overload.
 */
class CacheInvalidationEventServiceTest {

	@Test
	void shouldPublishUsingSimpleClassNameViaDefaultOverloadTest() {
		// Given: an implementation that records the published class name
		List<String> published = new ArrayList<>();
		CacheInvalidationEventService service = new CacheInvalidationEventService() {
			@Override
			public List<CacheInvalidationEvent> updatesAfter(LocalDateTime time) {
				return List.of();
			}

			@Override
			public void publishUpdateEvent(String trackedClass) {
				published.add(trackedClass);
			}
		};

		// When: the Class overload is used
		service.publishUpdateEvent(String.class);

		// Then: it delegates with the simple class name
		assertThat(published).containsExactly("String");
	}
}
