package com.aidigital.operationalhub.application.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Configures Springdoc OpenAPI metadata used by Swagger UI.
 */
@Configuration
public class SwaggerOpenApiConfig {

	private static final String BEARER_AUTH_SECURITY_SCHEME = "bearerAuth";
	private static final String BEARER_SCHEME = "bearer";
	private static final String JWT_BEARER_FORMAT = "JWT";

	/**
	 * Adds Bearer JWT authentication to generated {@code /v3/api-docs}.
	 *
	 * @return OpenAPI customization with the Swagger UI Authorize button enabled
	 */
	@Bean
	public OpenAPI operationalHubOpenApi() {
		SecurityScheme bearerJwt = new SecurityScheme()
				.type(SecurityScheme.Type.HTTP)
				.scheme(BEARER_SCHEME)
				.bearerFormat(JWT_BEARER_FORMAT)
				.description("Paste a Clerk-issued JWT. Swagger UI will send it as Authorization: Bearer <token>.");

		return new OpenAPI()
				.components(new Components().addSecuritySchemes(
						BEARER_AUTH_SECURITY_SCHEME, bearerJwt))
				.addSecurityItem(new SecurityRequirement().addList(BEARER_AUTH_SECURITY_SCHEME));
	}
}
