package com.aidigital.operationalhub.usagelogging.persistence;

import com.aidigital.operationalhub.usagelogging.entities.UsageEventEntity;
import com.aidigital.operationalhub.usagelogging.models.UsageEvent;
import com.aidigital.operationalhub.usagelogging.repositories.UsageEventRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owns the actual usage event INSERT in a separate Spring proxy.
 */
@RequiredArgsConstructor
public class UsageEventPersistenceService {

    private static final Logger LOG = LoggerFactory.getLogger(UsageEventPersistenceService.class);

    private final UsageEventRepository repository;

    /**
     * Persists a usage event outside the request transaction.
     *
     * @param event immutable usage event assembled by the usage-logging aspect
     */
    @Async("usageLoggingExecutor")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void persist(UsageEvent event) {
        try {
            repository.save(toEntity(event));
        } catch (Throwable t) {
            LOG.warn("Failed to persist usage event action={} eventId={}: {}",
                event.action(), event.eventId(), t.getMessage());
        }
    }

    /**
     * Converts the value object to a JPA entity. Package-private (not static)
     * so {@link #persist} can be unit-tested with a Mockito spy if needed.
     *
     * @param e usage event value object
     * @return populated JPA entity
     */
    UsageEventEntity toEntity(UsageEvent e) {
        UsageEventEntity entity = new UsageEventEntity();
        entity.setEventId(e.eventId());
        entity.setEventTimestamp(e.eventTimestamp());
        entity.setService(e.service());
        entity.setEnvironment(e.environment());
        entity.setEventType(e.eventType());
        entity.setAction(e.action());
        entity.setUserId(e.userId());
        entity.setUserEmail(e.userEmail());
        entity.setStatus(e.status());
        entity.setDurationMs(e.durationMs());
        entity.setAttributes(e.attributes());
        entity.setErrorMessage(e.errorMessage());
        entity.setClientIp(e.clientIp());
        entity.setUserAgent(e.userAgent());
        return entity;
    }
}
