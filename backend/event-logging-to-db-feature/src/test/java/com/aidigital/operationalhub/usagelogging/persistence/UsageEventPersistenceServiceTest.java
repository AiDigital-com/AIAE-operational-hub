package com.aidigital.operationalhub.usagelogging.persistence;

import com.aidigital.operationalhub.usagelogging.entities.UsageEventEntity;
import com.aidigital.operationalhub.usagelogging.models.UsageEvent;
import com.aidigital.operationalhub.usagelogging.repositories.UsageEventRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDateTime;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UsageEventPersistenceServiceTest {

    private final UsageEventRepository repository = mock(UsageEventRepository.class);
    private final UsageEventPersistenceService service = new UsageEventPersistenceService(repository);

    @Test
    void shouldPersistEventMappedToEntityTest() {
        // Given:
        UsageEvent event = UsageEvent.builder()
            .eventId("e-1")
            .eventTimestamp(LocalDateTime.of(2026, 1, 1, 0, 0))
            .service("svc").environment("test").eventType("api_request").action("a.b")
            .userId("u@x.com").userEmail("u@x.com").status("success").durationMs(12L)
            .attributes(Map.of("k", "v")).clientIp("1.2.3.4").userAgent("ua")
            .build();

        // When:
        service.persist(event);

        // Then: every field is copied onto the entity that is saved
        ArgumentCaptor<UsageEventEntity> captor = ArgumentCaptor.forClass(UsageEventEntity.class);
        verify(repository).save(captor.capture());
        UsageEventEntity entity = captor.getValue();
        assertThat(entity.getEventId()).isEqualTo("e-1");
        assertThat(entity.getService()).isEqualTo("svc");
        assertThat(entity.getAction()).isEqualTo("a.b");
        assertThat(entity.getStatus()).isEqualTo("success");
        assertThat(entity.getDurationMs()).isEqualTo(12L);
        assertThat(entity.getUserEmail()).isEqualTo("u@x.com");
        assertThat(entity.getAttributes()).containsEntry("k", "v");
    }

    @Test
    void shouldSwallowRepositoryFailureTest() {
        // Given: the DB write blows up
        when(repository.save(any())).thenThrow(new RuntimeException("db down"));
        UsageEvent event = UsageEvent.builder().eventId("e-2").action("a").build();

        // When / Then: the failure never propagates into the caller's flow
        assertThatCode(() -> service.persist(event)).doesNotThrowAnyException();
    }
}
