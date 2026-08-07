package com.aidigital.operationalhub.application.config.properties;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Clerk SSO configuration bound from the {@code app.auth.*} properties.
 *
 * <p>Used to build the resource-server {@code JwtDecoder}, validate the Clerk JWT contract, and
 * enforce the company email domain. No mock-auth fallback is provided.
 */
@Getter
@Setter
@Validated
@ConfigurationProperties(prefix = "app.auth")
public class ClerkProperties {

	/**
	 * Company email domain without a leading {@code @}.
	 */
	private String allowedEmailDomain = "aidigital.com";

	/**
	 * Clerk publishable key used to derive issuer/JWKS when explicit URIs are blank.
	 */
	private String publishableKey;

	/**
	 * Comma-separated exact trusted browser origins for the JWT {@code azp} claim.
	 */
	private String authorizedParties = "";

	/**
	 * Clerk/OIDC resource-server endpoints.
	 */
	@Valid
	@NotNull
	private Sso sso = new Sso();

	/**
	 * Clerk or compatible OIDC resource-server settings.
	 */
	@Getter
	@Setter
	public static class Sso {

		/**
		 * Clerk issuer URI, for example {@code https://clean-clerk.clerk.accounts.dev}.
		 */
		private String issuerUri;

		/**
		 * Optional JWKS override; usually derived from the issuer URI.
		 */
		private String jwkSetUri;

		/**
		 * Expected {@code aud} claim value.
		 */
		private String audience;
	}
}
