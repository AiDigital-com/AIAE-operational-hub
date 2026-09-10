package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.config.PacingProperties;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Cross-language contract test for {@link HubAssertionSignerImpl}.
 *
 * <p>The expected tokens below were captured by actually running dash-gate's own reference
 * implementation locally:
 * <pre>
 * cd AIAE-paicing/dash-gate
 * HUB_ASSERTION_SECRET=local-dev-only node tools/mint-assertion.mjs --email=x@y.com --scope=all --verbose
 * HUB_ASSERTION_SECRET=local-dev-only node tools/mint-assertion.mjs --email=a@x.com --scope=owners --ids=a@x.com,b@x.com --verbose
 * </pre>
 *
 * <p>Each test pins the signer's clock to the exact {@code exp} Node computed for its run (with
 * {@code assertionTtlSeconds=0}, so {@code exp = clock.millis()}), so the Java implementation is
 * asked to sign byte-for-byte the same payload Node signed. This is the single most important test in
 * this change: a signature mismatch here is the most likely way this integration silently fails,
 * since dash-gate fails closed (401) on any assertion it cannot verify.
 */
class HubAssertionSignerImplTest {

	private static final String SECRET = "local-dev-only";

	@Test
	void shouldMatchNodeReferenceTokenForAllScopeTest() {
		// Given: captured verbatim from `node tools/mint-assertion.mjs --email=x@y.com --scope=all`
		String expectedToken = "eyJlbWFpbCI6InhAeS5jb20iLCJzY29wZSI6eyJraW5kIjoiYWxsIn0sImNhbl9jcmVhdGUiOmZhbHNlLC"
				+ "JleHAiOjE3ODg4ODI4NzA2Nzd9.J8liddUD8lKsUux2-rLTGA7BOkaaKvYJE5uFqW0BwEw";
		long capturedExp = 1788882870677L;
		HubAssertionSignerImpl signer = signerFixedAt(capturedExp);
		HubAssertion assertion = new HubAssertion("x@y.com", HubAssertion.KIND_ALL, List.of(), false);

		// When:
		String token = signer.sign(assertion);

		// Then: byte-identical to the Node-signed token, not merely independently valid
		assertThat(token).isEqualTo(expectedToken);
		assertPayloadDecodesTo(token, "{\"email\":\"x@y.com\",\"scope\":{\"kind\":\"all\"},"
				+ "\"can_create\":false,\"exp\":" + capturedExp + "}");
	}

	@Test
	void shouldMatchNodeReferenceTokenForOwnersScopeTest() {
		// Given: captured verbatim from
		// `node tools/mint-assertion.mjs --email=a@x.com --scope=owners --ids=a@x.com,b@x.com`
		String expectedToken = "eyJlbWFpbCI6ImFAeC5jb20iLCJzY29wZSI6eyJraW5kIjoib3duZXJzIiwiaWRzIjpbImFAeC5jb20i"
				+ "LCJiQHguY29tIl19LCJjYW5fY3JlYXRlIjpmYWxzZSwiZXhwIjoxNzg4ODgyODcyNTk1fQ."
				+ "1q8Y7A1sVTxcqGVzrW8D80Ow6mbIa8Cyst66iq_5F8A";
		long capturedExp = 1788882872595L;
		HubAssertionSignerImpl signer = signerFixedAt(capturedExp);
		HubAssertion assertion =
				new HubAssertion("a@x.com", HubAssertion.KIND_OWNERS, List.of("a@x.com", "b@x.com"), false);

		// When:
		String token = signer.sign(assertion);

		// Then:
		assertThat(token).isEqualTo(expectedToken);
		assertPayloadDecodesTo(token, "{\"email\":\"a@x.com\",\"scope\":{\"kind\":\"owners\","
				+ "\"ids\":[\"a@x.com\",\"b@x.com\"]},\"can_create\":false,\"exp\":" + capturedExp + "}");
	}

	@Test
	void shouldSerializeCanCreateAsSnakeCaseTest() {
		// Given:
		HubAssertionSignerImpl signer = signerFixedAt(1_000_000L);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), true);

		// When:
		String token = signer.sign(assertion);

		// Then:
		assertPayloadDecodesTo(token,
				"{\"email\":\"me@aidigital.com\",\"scope\":{\"kind\":\"all\"},\"can_create\":true,\"exp\":1000000}");
	}

	@Test
	void shouldMatchNodeReferenceSystemAssertionTokenTest() {
		// Given: captured by computing the same HMAC dash-gate's verifySignedPayload expects, over the
		// SYSTEM payload shape {system: true, exp} - there is no Node reference-minting tool for this
		// shape (only the Hub ever mints it), unlike the USER-shape tokens above.
		String expectedToken = "eyJzeXN0ZW0iOnRydWUsImV4cCI6MTAwMDAwMH0"
				+ ".gBoXvw4Vnwo1-vnqYiLPm-ZXU6tjdKE14o7RY9amPwk";
		HubAssertionSignerImpl signer = signerFixedAt(1_000_000L);

		// When:
		String token = signer.signSystem();

		// Then: byte-identical to the independently-computed reference token
		assertThat(token).isEqualTo(expectedToken);
		assertPayloadDecodesTo(token, "{\"system\":true,\"exp\":1000000}");
	}

	@Test
	void shouldMatchNodeReferenceSystemAssertionTokenForALaterExpTest() {
		// Given:
		String expectedToken = "eyJzeXN0ZW0iOnRydWUsImV4cCI6MTc4ODg4Mjg3MDY3N30"
				+ ".kCk1xquK34XLA0Yw21mURLsTSUXfSEXsmPo7K5NaxgU";
		HubAssertionSignerImpl signer = signerFixedAt(1788882870677L);

		// When:
		String token = signer.signSystem();

		// Then:
		assertThat(token).isEqualTo(expectedToken);
		assertPayloadDecodesTo(token, "{\"system\":true,\"exp\":1788882870677}");
	}

	/**
	 * Builds a signer with {@code assertionTtlSeconds=0} and a clock fixed at {@code expMillis}, so
	 * {@code exp = clock.millis() + 0 == expMillis} — reproducing exactly the {@code exp} a captured
	 * Node run computed, regardless of this test's own wall-clock time.
	 */
	private static HubAssertionSignerImpl signerFixedAt(long expMillis) {
		PacingProperties properties = new PacingProperties();
		properties.setAssertionSecret(SECRET);
		properties.setAssertionTtlSeconds(0);
		Clock clock = Clock.fixed(Instant.ofEpochMilli(expMillis), ZoneOffset.UTC);
		return new HubAssertionSignerImpl(properties, clock);
	}

	private static void assertPayloadDecodesTo(String token, String expectedJson) {
		String payloadB64 = token.split("\\.")[0];
		String decoded = new String(
				Base64.getUrlDecoder().decode(payloadB64), StandardCharsets.UTF_8);
		assertThat(decoded).isEqualTo(expectedJson);
	}
}
