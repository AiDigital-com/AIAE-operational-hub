package com.aidigital.operationalhub.usagelogging.sink;

import com.aidigital.operationalhub.usagelogging.models.UsageEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

/**
 * Routes usage events to BigQuery when a {@code bigqueryUsageEventSink} bean is
 * registered; otherwise writes only to PostgreSQL. BigQuery failures fall back
 * to PostgreSQL so local MVPs keep collecting analytics without cloud credentials.
 */
@Component
@Primary
public class RoutingUsageEventSink implements UsageEventSink {

    private static final Logger LOG = LoggerFactory.getLogger(RoutingUsageEventSink.class);

    private final PostgreSqlUsageEventSink postgresSink;
    private final UsageEventSink bigQuerySink;

    public RoutingUsageEventSink(
        PostgreSqlUsageEventSink postgresSink,
        @Autowired(required = false) @Qualifier("bigqueryUsageEventSink") UsageEventSink bigQuerySink
    ) {
        this.postgresSink = postgresSink;
        this.bigQuerySink = bigQuerySink;
    }

    @Override
    public void record(UsageEvent event) {
        if (bigQuerySink != null) {
            try {
                bigQuerySink.record(event);
                return;
            } catch (RuntimeException ex) {
                LOG.warn("BigQuery usage sink failed; falling back to PostgreSQL: {}", ex.getMessage());
            }
        }
        postgresSink.record(event);
    }
}
