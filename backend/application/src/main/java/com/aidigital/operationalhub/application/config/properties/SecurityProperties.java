package com.aidigital.operationalhub.application.config.properties;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Typed browser security configuration bound from {@code app.security.*}.
 */
@Getter
@Validated
@ConfigurationProperties(prefix = "oph.security")
public class SecurityProperties {

	private final Cors cors = new Cors();
	private final Csp csp = new Csp();

	/**
	 * Cross-origin resource sharing settings.
	 */
	@Setter
	@Getter
	public static class Cors {

		@NotBlank
		private String allowedOrigins = "http://localhost:5173,http://localhost:5000";

		private long maxAgeSeconds = 3600L;
	}

	/**
	 * Content Security Policy settings.
	 */
	@Setter
	@Getter
	public static class Csp {

		private String frameAncestors = "'self'";

	}
}
