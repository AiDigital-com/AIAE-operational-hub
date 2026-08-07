package com.aidigital.operationalhub.application.config;

import com.aidigital.operationalhub.application.config.properties.ClerkProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link CompanyEmailDomainAuthorizationManager}.
 */
class CompanyEmailDomainAuthorizationManagerTest {

	private final CompanyEmailDomainAuthorizationManager manager =
			new CompanyEmailDomainAuthorizationManager(new ClerkProperties());

	@ParameterizedTest
	@ValueSource(strings = {
			"user@aidigital.com",
			"USER@AIDIGITAL.COM",
			" user@aidigital.com "
	})
	void shouldAllowCompanyEmail(String email) {
		// Verification
		assertThat(manager.isAllowedEmail(email)).isTrue();
	}

	@ParameterizedTest
	@ValueSource(strings = {
			"user@aidigital.com.attacker.example",
			"user@team.aidigital.com",
			"user@attacker.example",
			"not-an-email",
			"missing-domain@"
	})
	void shouldRejectOutsideOrInvalidEmail(String email) {
		// Verification
		assertThat(manager.isAllowedEmail(email)).isFalse();
	}

	@ParameterizedTest
	@NullAndEmptySource
	void shouldRejectMissingEmail(String email) {
		// Verification
		assertThat(manager.isAllowedEmail(email)).isFalse();
	}

	@Test
	void shouldEnforceConfiguredDomainOverride() {
		// Arrange
		ClerkProperties properties = new ClerkProperties();
		properties.setAllowedEmailDomain("@Example.COM");
		CompanyEmailDomainAuthorizationManager customManager =
				new CompanyEmailDomainAuthorizationManager(properties);

		// Verification
		assertThat(customManager.isAllowedEmail("dev@example.com")).isTrue();
		assertThat(customManager.isAllowedEmail("dev@aidigital.com")).isFalse();
	}

	@Test
	void shouldAllowJwtWithCompanyEmail() {
		// Arrange
		Jwt jwt = Jwt.withTokenValue("token")
				.header("alg", "none")
				.subject("user_1")
				.claim("email", "alice@aidigital.com")
				.build();

		// Act
		AuthorizationDecision decision = manager.check(
				() -> new JwtAuthenticationToken(jwt), null);

		// Verification
		assertThat(decision.isGranted()).isTrue();
	}

	@Test
	void shouldDenyJwtWithForeignEmail() {
		// Arrange
		Jwt jwt = Jwt.withTokenValue("token")
				.header("alg", "none")
				.subject("user_1")
				.claim("email", "mallory@attacker.example")
				.build();

		// Act
		AuthorizationDecision decision = manager.check(
				() -> new JwtAuthenticationToken(jwt), null);

		// Verification
		assertThat(decision.isGranted()).isFalse();
	}
}
