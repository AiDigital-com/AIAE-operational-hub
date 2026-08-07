package com.aidigital.operationalhub.application.config;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit tests for {@link ClerkPublishableKeyDecoder}.
 */
class ClerkPublishableKeyDecoderTest {

	private static final String FRONTEND_HOST = "clean-clerk.clerk.accounts.dev";

	private final ClerkPublishableKeyDecoder decoder = new ClerkPublishableKeyDecoder();

	@Test
	void shouldDecodeFrontendApiHost() {
		// Arrange
		String publishableKey = publishableKey(FRONTEND_HOST);

		// Verification
		assertThat(decoder.decodeFrontendApiHost(publishableKey)).isEqualTo(FRONTEND_HOST);
		assertThat(decoder.issuerFromPublishableKey(publishableKey))
				.isEqualTo("https://" + FRONTEND_HOST);
		assertThat(decoder.jwksUriFromPublishableKey(publishableKey))
				.isEqualTo("https://" + FRONTEND_HOST + "/.well-known/jwks.json");
	}

	@Test
	void shouldReturnNullForBlankKey() {
		// Verification
		assertThat(decoder.decodeFrontendApiHost(" ")).isNull();
		assertThat(decoder.issuerFromPublishableKey(null)).isNull();
	}

	@Test
	void shouldRejectMalformedKeyPrefix() {
		// Verification
		assertThatThrownBy(() -> decoder.decodeFrontendApiHost("sk_test_secret"))
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("Malformed CLERK_PUBLISHABLE_KEY");
	}

	@Test
	void shouldRejectDecodedUrlInsteadOfBareHost() {
		// Arrange
		String payload = Base64.getUrlEncoder().withoutPadding()
				.encodeToString("https://bad.example".getBytes(StandardCharsets.UTF_8));

		// Verification
		assertThatThrownBy(() -> decoder.decodeFrontendApiHost("pk_test_" + payload))
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("bare DNS hostname");
	}

	private String publishableKey(String host) {
		String payload = Base64.getUrlEncoder().withoutPadding()
				.encodeToString((host + "$").getBytes(StandardCharsets.UTF_8));
		return "pk_test_" + payload;
	}
}
