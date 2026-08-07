package com.aidigital.operationalhub.application.config.properties;

import jakarta.validation.constraints.Min;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.validation.annotation.Validated;

/**
 * Concurrency configuration for the streamed .xlsx report/bulk-template export endpoints, bound from
 * {@code oph.report-export.*}.
 */
@Setter
@Getter
@Validated
@Component
@ConfigurationProperties(prefix = "oph.report-export")
public class ReportExportProperties {

	@Min(1)
	private int maxConcurrentExports = 4;
}
