package com.aidigital.operationalhub.usagelogging.sink;

import com.aidigital.operationalhub.usagelogging.models.UsageEvent;

/**
 * Persistence/export boundary for usage analytics events.
 *
 * <p>The default sink is PostgreSQL ({@link PostgreSqlUsageEventSink}). An
 * optional BigQuery sink may be registered by the BigQuery integration pack;
 * {@link RoutingUsageEventSink} prefers BigQuery when present and falls back
 * to PostgreSQL on failure.
 */
public interface UsageEventSink {

    /**
     * Records a single usage event.
     *
     * @param event immutable usage event payload
     */
    void record(UsageEvent event);
}
