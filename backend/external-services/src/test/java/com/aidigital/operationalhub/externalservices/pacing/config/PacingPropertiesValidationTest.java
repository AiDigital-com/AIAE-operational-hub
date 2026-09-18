package com.aidigital.operationalhub.externalservices.pacing.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.BeanCreationException;
import org.springframework.boot.test.util.TestPropertyValues;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Proves {@link PacingProperties#getAssertionSecret()} actually enforces "fail fast at startup, not on
 * the first request" by driving real Spring {@code @ConfigurationProperties} binding + JSR-303
 * validation against a minimal context - the same mechanism {@code PacingConfig} relies on in the full
 * application context, exercised here without the rest of the application's beans (DB, security, etc.)
 * so this test says something about the properties class itself, not about wiring elsewhere.
 */
class PacingPropertiesValidationTest {

	@ParameterizedTest
	@ValueSource(strings = {"", "   "})
	void shouldFailToRefreshContextWhenAssertionSecretIsBlankOrMissingTest(String blankSecret) {
		// Given: no PACING_ASSERTION_SECRET configured (base application.yml provides no default) and no
		// local-profile default in play, matching a deployed environment where the env var was forgotten
		try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
			TestPropertyValues.of("app.external.pacing.assertion-secret=" + blankSecret)
					.applyTo(context);
			context.register(PacingPropertiesOnlyConfig.class);

			// When-Then: context refresh fails instead of starting up with a key that will blow up on
			// the first signed request
			assertThatThrownBy(context::refresh)
					.isInstanceOf(BeanCreationException.class)
					.rootCause()
					.hasMessageContaining("PACING_ASSERTION_SECRET");
		}
	}

	@Test
	void shouldRefreshSuccessfullyWhenAssertionSecretIsSetTest() {
		// Given: the local profile's own default value
		try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
			TestPropertyValues.of("app.external.pacing.assertion-secret=local-dev-only")
					.applyTo(context);
			context.register(PacingPropertiesOnlyConfig.class);

			// When:
			context.refresh();

			// Then:
			PacingProperties properties = context.getBean(PacingProperties.class);
			assertThat(properties.getAssertionSecret()).isEqualTo("local-dev-only");
		}
	}

	/**
	 * Registers only {@link PacingProperties} with configuration-properties validation enabled - not the
	 * whole {@link PacingConfig} - so this test does not also need a {@code RestClient} or
	 * {@code HubAssertionSigner} to stand up a context.
	 */
	@org.springframework.boot.context.properties.EnableConfigurationProperties(PacingProperties.class)
	static class PacingPropertiesOnlyConfig {
	}
}
