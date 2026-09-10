package com.aidigital.operationalhub.externalservices.pacing.config;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Runtime-tunable properties for the Pacing HTTP client.
 *
 * <p>All fields bind from the {@code app.external.pacing.*} namespace.
 *
 * <p>Typical {@code application.yml} stub:
 * <pre>
 * app:
 *   external:
 *     pacing:
 *       base-url: ${PACING_BASE_URL:http://localhost:3000}
 *       assertion-secret: ${PACING_ASSERTION_SECRET:}
 *       connect-timeout-ms: ${PACING_CONNECT_TIMEOUT_MS:3000}
 *       read-timeout-ms: ${PACING_READ_TIMEOUT_MS:5000}
 *       assertion-ttl-seconds: ${PACING_ASSERTION_TTL_SECONDS:90}
 * </pre>
 *
 * <p>Security: {@code assertionSecret} is the HMAC key shared with Pacing alone (dash-gate's
 * {@code HUB_ASSERTION_SECRET}); it is the whole of the authentication between the two services and
 * must never be logged. It has no safe default in the base configuration — only the {@code local}
 * profile may default it, to the value dash-gate's own local template ships
 * ({@code .env.local.example}: {@code local-dev-only}).
 *
 * <p>{@link #assertionSecret} is {@code @NotBlank}: with no {@code PACING_ASSERTION_SECRET} set (and
 * no {@code local} profile default in play), the property binds to an empty string, which
 * {@code SecretKeySpec} rejects with a bare {@code IllegalArgumentException: Empty key} the first time
 * a request tries to sign an assertion — a confusing 500 with no mention of what's actually wrong. The
 * {@code @NotBlank} constraint fails context startup instead, with a message naming the missing
 * environment variable, so a misconfigured deployment never serves a single request.
 */
@ConfigurationProperties(prefix = "app.external.pacing")
@Validated
public class PacingProperties {

	private String baseUrl = "http://localhost:3000";

	@NotBlank(message = "app.external.pacing.assertion-secret is not set. Set the PACING_ASSERTION_SECRET "
			+ "environment variable to the HMAC secret shared with Pacing (the local profile already "
			+ "defaults this; every other environment must set it explicitly).")
	private String assertionSecret = "";

	private long connectTimeoutMs = 3000;
	private long readTimeoutMs = 5000;

	/**
	 * How long a minted assertion stays valid, in seconds. Kept short (60-120s recommended): a Hub
	 * assertion is a bearer token for whatever it asserts, minted fresh per request rather than reused,
	 * so there is no benefit to a long TTL and a real cost to one leaking.
	 */
	private long assertionTtlSeconds = 90;

	/**
	 * Returns the Pacing service base URL.
	 *
	 * @return base URL, e.g. {@code http://localhost:3000}
	 */
	public String getBaseUrl() {
		return baseUrl;
	}

	/**
	 * Sets the Pacing service base URL.
	 *
	 * @param baseUrl base URL
	 */
	public void setBaseUrl(String baseUrl) {
		this.baseUrl = baseUrl;
	}

	/**
	 * Returns the HMAC secret shared with Pacing for signing the {@code X-Hub-Assertion} header.
	 *
	 * @return the shared secret; empty when not configured
	 */
	public String getAssertionSecret() {
		return assertionSecret;
	}

	/**
	 * Sets the HMAC secret shared with Pacing.
	 *
	 * @param assertionSecret the shared secret
	 */
	public void setAssertionSecret(String assertionSecret) {
		this.assertionSecret = assertionSecret;
	}

	/**
	 * Returns the connect timeout for a Pacing HTTP call, in milliseconds.
	 *
	 * @return connect timeout, in milliseconds
	 */
	public long getConnectTimeoutMs() {
		return connectTimeoutMs;
	}

	/**
	 * Sets the connect timeout for a Pacing HTTP call.
	 *
	 * @param connectTimeoutMs connect timeout, in milliseconds
	 */
	public void setConnectTimeoutMs(long connectTimeoutMs) {
		this.connectTimeoutMs = connectTimeoutMs;
	}

	/**
	 * Returns the read timeout for a Pacing HTTP call, in milliseconds.
	 *
	 * @return read timeout, in milliseconds
	 */
	public long getReadTimeoutMs() {
		return readTimeoutMs;
	}

	/**
	 * Sets the read timeout for a Pacing HTTP call.
	 *
	 * @param readTimeoutMs read timeout, in milliseconds
	 */
	public void setReadTimeoutMs(long readTimeoutMs) {
		this.readTimeoutMs = readTimeoutMs;
	}

	/**
	 * Returns how long a minted assertion stays valid, in seconds.
	 *
	 * @return assertion TTL, in seconds
	 */
	public long getAssertionTtlSeconds() {
		return assertionTtlSeconds;
	}

	/**
	 * Sets how long a minted assertion stays valid.
	 *
	 * @param assertionTtlSeconds assertion TTL, in seconds
	 */
	public void setAssertionTtlSeconds(long assertionTtlSeconds) {
		this.assertionTtlSeconds = assertionTtlSeconds;
	}
}
