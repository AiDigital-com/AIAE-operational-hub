// UsageLoggingConfig — binds the UsageLogger bean per config.
//
// Binding rules (observability/usage-logging-rules.md → "Default behavior"):
//   - enabled=false           → NoOpUsageLogger
//   - enabled=true + valid    → PostgresUsageLogger
//   - enabled=true + EMPTY or PLACEHOLDER service-name → FAIL FAST at
//     startup, do NOT silently bind NoOp (past sessions shipped projects
//     with zero events in the DB and no error anywhere).

package com.aidigital.operationalhub.usagelogging.config;

import com.aidigital.operationalhub.usagelogging.loggers.UsageLogger;
import com.aidigital.operationalhub.usagelogging.loggers.impl.NoOpUsageLogger;
import com.aidigital.operationalhub.usagelogging.loggers.impl.PostgresUsageLogger;
import com.aidigital.operationalhub.usagelogging.persistence.UsageEventPersistenceService;
import com.aidigital.operationalhub.usagelogging.sink.UsageEventSink;
import com.aidigital.operationalhub.usagelogging.repositories.UsageEventRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.TaskExecutor;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.Set;

/**
 * Wires the usage logging sink and async executor from configuration.
 */
@Configuration
@EnableAsync
@EnableConfigurationProperties(UsageLoggingProperties.class)
public class UsageLoggingConfig {

    private static final Set<String> PLACEHOLDERS = Set.of(
        "project-template",
        "<stable-service-name>",
        "<service-name>",
        "change-me",
        "TODO"
    );

    /**
     * Primary logger when enabled. Fails fast on empty/placeholder service-name.
     *
     * @param usageEventSink configured sink chain for usage events
     * @param props          bound app.usage-logging.* properties
     * @return Postgres-backed logger
     * @throws IllegalStateException when service-name is blank or still the placeholder
     */
    @Bean
    @ConditionalOnProperty(name = "app.usage-logging.enabled",
                           havingValue = "true",
                           matchIfMissing = true)
    public UsageLogger postgresUsageLogger(UsageEventSink usageEventSink,
                                           UsageLoggingProperties props) {
        String serviceName = props.getServiceName();
        if (serviceName == null || serviceName.isBlank() || PLACEHOLDERS.contains(serviceName)) {
            throw new IllegalStateException(
                "app.usage-logging.service-name must be set to a real service identifier "
                + "(NOT empty, NOT a placeholder). Set USAGE_LOG_SERVICE_NAME env "
                + "or spring.application.name in application.yml. "
                + "Disabling usage logging? Set app.usage-logging.enabled=false explicitly.");
        }
        return new PostgresUsageLogger(usageEventSink);
    }

    /**
     * Separate bean so @Async and REQUIRES_NEW are applied through Spring proxy.
     *
     * @param repo JPA repo for usage event inserts
     * @return proxied persistence service
     */
    @Bean
    public UsageEventPersistenceService usageEventPersistenceService(UsageEventRepository repo) {
        return new UsageEventPersistenceService(repo);
    }

    /**
     * Executor dedicated to fire-and-forget usage event persistence.
     *
     * @param props bound app.usage-logging.* properties
     * @return bounded async executor for usage logging writes
     */
    @Bean(name = "usageLoggingExecutor")
    public TaskExecutor usageLoggingExecutor(UsageLoggingProperties props) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setThreadNamePrefix("usage-log-");
        executor.setCorePoolSize(props.getExecutorCorePoolSize());
        executor.setMaxPoolSize(props.getExecutorMaxPoolSize());
        executor.setQueueCapacity(props.getExecutorQueueCapacity());
        executor.initialize();
        return executor;
    }

    /**
     * Fallback when enabled=false. {@link ConditionalOnMissingBean} keeps this
     * out of the way when the postgres bean fires.
     *
     * @return silent logger
     */
    @Bean
    @ConditionalOnMissingBean(UsageLogger.class)
    public UsageLogger noOpUsageLogger() {
        return new NoOpUsageLogger();
    }
}
