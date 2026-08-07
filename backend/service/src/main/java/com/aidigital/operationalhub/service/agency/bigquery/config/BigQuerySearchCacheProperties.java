package com.aidigital.operationalhub.service.agency.bigquery.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.validation.annotation.Validated;

/**
 * Runtime toggle for {@code CachedBigQuerySearchExecutor}'s cache, under the same {@code oph.cache}
 * namespace as the application module's other cache toggles.
 */
@Setter
@Getter
@Validated
@Component
@ConfigurationProperties(prefix = "oph.cache")
public class BigQuerySearchCacheProperties {

	/**
	 * Whether the BigQuery search-results cache ({@code bigQuerySearchResults}) is used. Disabling it
	 * lets every paged search hit BigQuery directly, e.g. while diagnosing a staleness report.
	 */
	private boolean searchEnabled = true;
}
