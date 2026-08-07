// NoOpUsageLogger — silent sink wired when app.usage-logging.enabled=false.
// Keeps the @LogUsage call sites cheap (assemble + drop) when usage
// logging is intentionally disabled (tests, local dev without DB).

package com.aidigital.operationalhub.usagelogging.loggers.impl;

import com.aidigital.operationalhub.usagelogging.loggers.UsageLogger;
import com.aidigital.operationalhub.usagelogging.models.UsageEvent;

/**
 * Drops usage events when usage logging is intentionally disabled.
 */
public class NoOpUsageLogger implements UsageLogger {

    @Override
    public void record(UsageEvent event) {
        // no-op
    }
}
