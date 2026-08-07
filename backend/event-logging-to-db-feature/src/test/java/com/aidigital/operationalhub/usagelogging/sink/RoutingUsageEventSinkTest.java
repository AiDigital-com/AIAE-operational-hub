package com.aidigital.operationalhub.usagelogging.sink;

import com.aidigital.operationalhub.usagelogging.models.UsageEvent;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Map;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

class RoutingUsageEventSinkTest {

    @Test
    void shouldUsePostgresWhenBigQuerySinkAbsentTest() {
        PostgreSqlUsageEventSink postgres = mock(PostgreSqlUsageEventSink.class);
        RoutingUsageEventSink routing = new RoutingUsageEventSink(postgres, null);
        UsageEvent event = sampleEvent();

        routing.record(event);

        verify(postgres).record(event);
    }

    @Test
    void shouldPreferBigQueryWhenPresentTest() {
        PostgreSqlUsageEventSink postgres = mock(PostgreSqlUsageEventSink.class);
        UsageEventSink bigQuery = mock(UsageEventSink.class);
        RoutingUsageEventSink routing = new RoutingUsageEventSink(postgres, bigQuery);
        UsageEvent event = sampleEvent();

        routing.record(event);

        verify(bigQuery).record(event);
        verifyNoInteractions(postgres);
    }

    @Test
    void shouldFallBackToPostgresWhenBigQueryFailsTest() {
        PostgreSqlUsageEventSink postgres = mock(PostgreSqlUsageEventSink.class);
        UsageEventSink bigQuery = mock(UsageEventSink.class);
        UsageEvent event = sampleEvent();
        doThrow(new RuntimeException("bq down")).when(bigQuery).record(event);

        RoutingUsageEventSink routing = new RoutingUsageEventSink(postgres, bigQuery);
        routing.record(event);

        verify(postgres).record(event);
    }

    @Test
    void bigQuerySuccessShouldNotTouchPostgresTest() {
        PostgreSqlUsageEventSink postgres = mock(PostgreSqlUsageEventSink.class);
        UsageEventSink bigQuery = mock(UsageEventSink.class);
        UsageEvent event = sampleEvent();

        new RoutingUsageEventSink(postgres, bigQuery).record(event);

        verify(bigQuery).record(event);
        verifyNoInteractions(postgres);
    }

    private static UsageEvent sampleEvent() {
        return UsageEvent.builder()
            .eventId("evt-1")
            .eventTimestamp(LocalDateTime.now())
            .service("svc")
            .environment("test")
            .eventType("api_request")
            .action("demo.run")
            .status("success")
            .durationMs(1L)
            .attributes(Map.of())
            .build();
    }
}
