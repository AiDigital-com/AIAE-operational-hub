// UsageEvent — immutable value type assembled by UsageLoggingAspect and
// handed to UsageLogger.record(). Lives in the event-logging-to-db-feature
// module alongside the sink interface so consumers depend on the API and
// impl together.

package com.aidigital.operationalhub.usagelogging.models;

import lombok.Builder;

import java.time.LocalDateTime;
import java.util.Map;

@Builder
public record UsageEvent(
    String eventId,
    LocalDateTime eventTimestamp,
    String service,
    String environment,
    String eventType,
    String action,
    String userId,
    String userEmail,
    String status,
    long durationMs,
    Map<String, Object> attributes,
    String errorMessage,
    String clientIp,
    String userAgent
) { }
