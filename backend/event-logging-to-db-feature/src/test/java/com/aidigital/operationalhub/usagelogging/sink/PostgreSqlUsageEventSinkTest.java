// Added on top of the template's test set: this repository enforces a per-class coverage floor at build
// time, and the template ships no test for the default sink itself (RoutingUsageEventSinkTest mocks it).
package com.aidigital.operationalhub.usagelogging.sink;

import com.aidigital.operationalhub.usagelogging.models.UsageEvent;
import com.aidigital.operationalhub.usagelogging.persistence.UsageEventPersistenceService;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class PostgreSqlUsageEventSinkTest {

    @Test
    void shouldHandTheEventToThePersistenceServiceTest() {
        // Given:
        UsageEventPersistenceService persistenceService = mock(UsageEventPersistenceService.class);
        PostgreSqlUsageEventSink sink = new PostgreSqlUsageEventSink(persistenceService);
        UsageEvent event = UsageEvent.builder()
            .eventId("event-1")
            .eventTimestamp(LocalDateTime.of(2026, 8, 14, 9, 30))
            .service("operational-hub")
            .eventType("api_request")
            .action("report.create")
            .status("success")
            .build();

        // When:
        sink.record(event);

        // Then: the sink itself owns no transaction and no thread - it only forwards.
        verify(persistenceService).persist(event);
    }
}
