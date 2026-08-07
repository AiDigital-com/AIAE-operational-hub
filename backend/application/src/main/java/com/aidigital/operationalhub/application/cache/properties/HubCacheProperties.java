package com.aidigital.operationalhub.application.cache.properties;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.validation.annotation.Validated;

/**
 * Cache configuration of Operational Hub.
 */
@Setter
@Getter
@Validated
@Component
@ConfigurationProperties(prefix = "oph.cache")
public class HubCacheProperties {

	private boolean warmupEnabled = true;
}
