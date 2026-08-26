// UsageLoggingProperties — @ConfigurationProperties("app.usage-logging").
// Binding spec: observability/usage-logging-rules.md → "Required env placeholders".

package com.aidigital.operationalhub.usagelogging.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Typed configuration for usage event persistence.
 */
@ConfigurationProperties(prefix = "app.usage-logging")
public class UsageLoggingProperties {

    /** Master switch. Set to false to silence the aspect via NoOpUsageLogger. */
    private boolean enabled = true;

    /** Stable lowercase-hyphen identifier (e.g. `employee-directory`). Must
     *  NOT remain a template placeholder in deployment. */
    private String serviceName;

    /** `prod` | `staging` | `dev`. */
    private String environment = "dev";

    private int executorCorePoolSize = 1;
    private int executorMaxPoolSize = 2;
    private int executorQueueCapacity = 200;
    private int maxErrorMessageLength = 500;
    private int maxUserAgentLength = 500;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getServiceName() {
        return serviceName;
    }

    public void setServiceName(String s) {
        this.serviceName = s;
    }

    public String getEnvironment() {
        return environment;
    }

    public void setEnvironment(String e) {
        this.environment = e;
    }

    public int getExecutorCorePoolSize() {
        return executorCorePoolSize;
    }

    public void setExecutorCorePoolSize(int executorCorePoolSize) {
        this.executorCorePoolSize = executorCorePoolSize;
    }

    public int getExecutorMaxPoolSize() {
        return executorMaxPoolSize;
    }

    public void setExecutorMaxPoolSize(int executorMaxPoolSize) {
        this.executorMaxPoolSize = executorMaxPoolSize;
    }

    public int getExecutorQueueCapacity() {
        return executorQueueCapacity;
    }

    public void setExecutorQueueCapacity(int executorQueueCapacity) {
        this.executorQueueCapacity = executorQueueCapacity;
    }

    public int getMaxErrorMessageLength() {
        return maxErrorMessageLength;
    }

    public void setMaxErrorMessageLength(int maxErrorMessageLength) {
        this.maxErrorMessageLength = maxErrorMessageLength;
    }

    public int getMaxUserAgentLength() {
        return maxUserAgentLength;
    }

    public void setMaxUserAgentLength(int maxUserAgentLength) {
        this.maxUserAgentLength = maxUserAgentLength;
    }
}
