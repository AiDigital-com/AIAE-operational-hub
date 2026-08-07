package com.aidigital.operationalhub.cachemanagement.event;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit test for the {@link CacheInvalidationEvent} record (accessors + value semantics).
 */
class CacheInvalidationEventTest {

	@Test
	void shouldExposeComponentsAndValueSemanticsTest() {
		// Given:
		LocalDateTime when = LocalDateTime.now();
		CacheInvalidationEvent event = new CacheInvalidationEvent("Foo", when);
		CacheInvalidationEvent same = new CacheInvalidationEvent("Foo", when);

		// Then:
		assertThat(event.trackedClass()).isEqualTo("Foo");
		assertThat(event.updatedTime()).isEqualTo(when);
		assertThat(event).isEqualTo(same).hasSameHashCodeAs(same);
		assertThat(event.toString()).contains("Foo");
	}
}
