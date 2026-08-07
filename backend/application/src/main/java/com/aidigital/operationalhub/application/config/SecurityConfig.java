package com.aidigital.operationalhub.application.config;

import com.aidigital.operationalhub.application.config.properties.ClerkProperties;
import com.aidigital.operationalhub.application.config.properties.SecurityProperties;
import com.aidigital.operationalhub.service.rbac.enums.ClerkJwtClaim;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.annotation.web.configurers.HeadersConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtDecoders;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.Collection;
import java.util.List;

/**
 * Spring Security configuration for the Operational Hub.
 *
 * <p>Configures an OAuth2 resource server validating Clerk-issued JWTs. Everything under
 * {@code /api/v1/**} requires an authenticated JWT; the actuator health endpoint and the OpenAPI
 * documentation endpoints are permitted anonymously. There is no mock-auth fallback.
 */
@Configuration
@RequiredArgsConstructor
@EnableConfigurationProperties(ClerkProperties.class)
public class SecurityConfig {

	private static final String API_PATTERN = "/api/v1/**";
	private static final String[] PUBLIC_PATHS = {
			"/actuator/health",
			"/actuator/health/**",
			"/v3/api-docs/**",
			"/swagger-ui/**",
			"/swagger-ui.html",
			"/",
			"/index.html",
			"/clerk-test.html",
			"/favicon.ico",
			"/assets/**",
			"/css/**",
			"/js/**",
			// BrowserRouter client-side routes: a full page load/refresh on a deep link must serve the
			// SPA shell anonymously (see SpaWebConfig) - the app's own auth gate runs client-side.
			"/agencies",
			"/agencies/**",
			"/clients/**",
			"/campaigns/**",
			"/teams"
	};
	private static final List<String> CORS_METHODS = List.of(
			"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS");
	private static final List<String> CORS_HEADERS = List.of(
			"Authorization", "Content-Type", "X-Correlation-Id", "Accept");
	private static final List<String> CORS_EXPOSED_HEADERS = List.of("X-Correlation-Id");
	private static final long CORS_MAX_AGE_SECONDS = 3600L;

	private final ClerkProperties clerkProperties;
	private final SecurityProperties securityProperties;
	private final ClerkJwtClaimsValidator clerkJwtClaimsValidator;
	private final ClerkPublishableKeyDecoder publishableKeyDecoder;
	private final CompanyEmailDomainAuthorizationManager companyEmailDomainAuthorizationManager;

	/**
	 * Builds the security filter chain: stateless, JWT resource server, public health/docs.
	 *
	 * @param http the {@link HttpSecurity} to configure
	 * @return the configured {@link SecurityFilterChain}
	 * @throws Exception if the chain cannot be built
	 */
	@Bean
	public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
		http
				.csrf(AbstractHttpConfigurer::disable)
				.cors(cors -> cors.configurationSource(corsConfigurationSource()))
				.headers(h -> h
						.frameOptions(HeadersConfigurer.FrameOptionsConfig::disable)
						.contentSecurityPolicy(csp -> csp.policyDirectives(
								"default-src 'self'; "
										+ "frame-ancestors " + securityProperties.getCsp().getFrameAncestors() + "; "
										+ "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev "
										+ "https://*.clerk.com https://clerk.aidigital.tech https://challenges" +
										".cloudflare.com; "
										+ "worker-src 'self' blob:; "
										+ "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
										+ "img-src 'self' data: https: blob:; "
										+ "connect-src 'self' https:; "
										+ "frame-src 'self' https://*.clerk.accounts.dev "
										+ "https://clerk.aidigital.tech https://challenges.cloudflare.com; "
										+ "font-src 'self' data: https://fonts.gstatic.com"))
						.referrerPolicy(r -> r.policy(
								ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN))
						.contentTypeOptions(opts -> {
						})
						.httpStrictTransportSecurity(hsts -> hsts
								.includeSubDomains(true)
								.maxAgeInSeconds(31_536_000L)))
				.sessionManagement(session ->
						session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
				.authorizeHttpRequests(authorize -> authorize
						.requestMatchers(PUBLIC_PATHS).permitAll()
						.requestMatchers(API_PATTERN)
						.access(companyEmailDomainAuthorizationManager)
						.anyRequest()
						.authenticated())
				.oauth2ResourceServer(oauth2 ->
						oauth2.jwt(jwt -> jwt.jwtAuthenticationConverter(userIdAsPrincipalConverter())));
		return http.build();
	}

	/**
	 * Binds {@code Authentication#getName()} to the stable Clerk {@code user_id} claim.
	 *
	 * @return JWT authentication converter
	 */
	public JwtAuthenticationConverter userIdAsPrincipalConverter() {
		JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
		converter.setPrincipalClaimName(ClerkJwtClaim.USER_ID.getClaimName());
		return converter;
	}

	/**
	 * Builds CORS policy from the same exact origins trusted in Clerk {@code azp}.
	 *
	 * @return CORS configuration source
	 */
	@Bean
	public CorsConfigurationSource corsConfigurationSource() {
		CorsConfiguration configuration = new CorsConfiguration();
		configuration.setAllowedOriginPatterns(parseCsv(clerkProperties.getAuthorizedParties()));
		configuration.setAllowedMethods(CORS_METHODS);
		configuration.setAllowedHeaders(CORS_HEADERS);
		configuration.setExposedHeaders(CORS_EXPOSED_HEADERS);
		configuration.setAllowCredentials(true);
		configuration.setMaxAge(CORS_MAX_AGE_SECONDS);
		UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
		source.registerCorsConfiguration("/**", configuration);
		return source;
	}

	/**
	 * Parses a comma-separated property value.
	 *
	 * @param raw raw property value
	 * @return trimmed non-empty values
	 */
	public List<String> parseCsv(String raw) {
		if (raw == null || raw.isBlank()) {
			return List.of();
		}
		return Arrays.stream(raw.split(","))
				.map(String::trim)
				.filter(value -> !value.isEmpty())
				.toList();
	}

	/**
	 * Builds the {@link JwtDecoder} from the configured Clerk JWKS URI, falling back to the issuer.
	 *
	 * @param clerkProperties the Clerk configuration
	 * @return a {@link JwtDecoder} validating tokens against the Clerk JWKS
	 */
	@Bean
	public JwtDecoder jwtDecoder(ClerkProperties clerkProperties) {
		return buildSsoDecoder(clerkProperties);
	}

	/**
	 * Builds a Nimbus JWT decoder with issuer, audience, and Clerk claim validation.
	 *
	 * @param properties Clerk authentication properties
	 * @return configured JWT decoder
	 */
	public JwtDecoder buildSsoDecoder(ClerkProperties properties) {
		resolveSsoEndpoints(properties);

		String issuer = properties.getSso().getIssuerUri();
		String jwkSetUri = properties.getSso().getJwkSetUri();
		String audience = properties.getSso().getAudience();

		if ((issuer == null || issuer.isBlank()) && (jwkSetUri == null || jwkSetUri.isBlank())) {
			throw new IllegalStateException(
					"Clerk SSO is required but unconfigured: set CLERK_PUBLISHABLE_KEY or "
							+ "AUTH_ISSUER_URI / AUTH_JWKS_URI.");
		}

		NimbusJwtDecoder decoder = (jwkSetUri != null && !jwkSetUri.isBlank())
				? NimbusJwtDecoder.withJwkSetUri(jwkSetUri).build()
				: (NimbusJwtDecoder) JwtDecoders.fromIssuerLocation(issuer);

		OAuth2TokenValidator<Jwt> defaultValidator = (issuer != null && !issuer.isBlank())
				? JwtValidators.createDefaultWithIssuer(issuer)
				: JwtValidators.createDefault();

		OAuth2TokenValidator<Jwt> audienceValidator = null;
		if (audience != null && !audience.isBlank()) {
			audienceValidator = new JwtClaimValidator<>(
					JwtClaimNames.AUD,
					claim -> claim instanceof Collection<?> collection
							? collection.contains(audience)
							: audience.equals(claim));
		}

		OAuth2TokenValidator<Jwt> composite = audienceValidator == null
				? new DelegatingOAuth2TokenValidator<>(defaultValidator, clerkJwtClaimsValidator)
				: new DelegatingOAuth2TokenValidator<>(
				defaultValidator, audienceValidator, clerkJwtClaimsValidator);
		decoder.setJwtValidator(composite);
		return decoder;
	}

	/**
	 * Fills issuer and JWKS from {@code CLERK_PUBLISHABLE_KEY} when explicit URIs are blank.
	 *
	 * @param properties Clerk authentication properties
	 */
	public void resolveSsoEndpoints(ClerkProperties properties) {
		ClerkProperties.Sso sso = properties.getSso();
		if ((sso.getIssuerUri() == null || sso.getIssuerUri().isBlank())
				&& (sso.getJwkSetUri() == null || sso.getJwkSetUri().isBlank())
				&& properties.getPublishableKey() != null
				&& !properties.getPublishableKey().isBlank()) {
			sso.setIssuerUri(publishableKeyDecoder.issuerFromPublishableKey(
					properties.getPublishableKey()));
			sso.setJwkSetUri(publishableKeyDecoder.jwksUriFromPublishableKey(
					properties.getPublishableKey()));
		}
	}
}
