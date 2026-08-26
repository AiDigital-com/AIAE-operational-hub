package com.aidigital.operationalhub.application.config;

import com.aidigital.operationalhub.application.config.properties.ClerkProperties;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ClerkJwtClaimsValidator}.
 */
class ClerkJwtClaimsValidatorTest {

	private static final String TRUSTED_ORIGIN = "http://localhost:5173";
	private static final String SECOND_TRUSTED_ORIGIN = "https://dev.example.com";

	@Test
	void shouldAcceptValidAidigitalApiTemplateClaims() {
		// Arrange
		Jwt jwt = baseJwt().claim("azp", TRUSTED_ORIGIN).build();

		// Act
		OAuth2TokenValidatorResult result = validator(TRUSTED_ORIGIN).validate(jwt);

		// Verification
		assertThat(result.hasErrors()).isFalse();
	}

	@Test
	void shouldRejectMissingUserId() {
		// Arrange
		Jwt jwt = Jwt.withTokenValue("token")
				.header("alg", "none")
				.subject("user_123")
				.claim("azp", TRUSTED_ORIGIN)
				.build();

		// Act
		OAuth2TokenValidatorResult result = validator(TRUSTED_ORIGIN).validate(jwt);

		// Verification
		assertThat(result.hasErrors()).isTrue();
	}

	@Test
	void shouldRejectMismatchedSubjectAndUserId() {
		// Arrange
		Jwt jwt = baseJwt()
				.claim("user_id", "user_456")
				.claim("azp", TRUSTED_ORIGIN)
				.build();

		// Act
		OAuth2TokenValidatorResult result = validator(TRUSTED_ORIGIN).validate(jwt);

		// Verification
		assertThat(result.hasErrors()).isTrue();
	}

	@Test
	void shouldRejectUntrustedAuthorizedParty() {
		// Arrange
		Jwt jwt = baseJwt().claim("azp", "https://attacker.example").build();

		// Act
		OAuth2TokenValidatorResult result = validator(TRUSTED_ORIGIN).validate(jwt);

		// Verification
		assertThat(result.hasErrors()).isTrue();
	}

	@Test
	void shouldParseCommaSeparatedAuthorizedParties() {
		// Arrange
		Jwt jwt = baseJwt().claim("azp", SECOND_TRUSTED_ORIGIN).build();

		// Act
		OAuth2TokenValidatorResult result = validator(
				TRUSTED_ORIGIN + ", " + SECOND_TRUSTED_ORIGIN).validate(jwt);

		// Verification
		assertThat(result.hasErrors()).isFalse();
	}

	private Jwt.Builder baseJwt() {
		return Jwt.withTokenValue("token")
				.header("alg", "none")
				.subject("user_123")
				.claim("user_id", "user_123")
				.claim("email", "user@aidigital.com")
				.claim("full_name", "AI Digital User");
	}

	private ClerkJwtClaimsValidator validator(String authorizedParties) {
		ClerkProperties properties = new ClerkProperties();
		properties.setAuthorizedParties(authorizedParties);
		return new ClerkJwtClaimsValidator(properties);
	}
}
