package com.aidigital.operationalhub.application.config;

import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Derives Clerk issuer and JWKS endpoints from a Clerk publishable key.
 *
 * <p>A publishable key has the form {@code pk_test_<base64>} or {@code pk_live_<base64>}. The
 * payload decodes to the Clerk Frontend API host, sometimes with a trailing {@code $} delimiter.
 */
@Component
public class ClerkPublishableKeyDecoder {

	private static final Pattern KEY_PATTERN = Pattern.compile("^pk_(test|live)_([A-Za-z0-9_=-]+)$");
	private static final Pattern DNS_LABEL_PATTERN = Pattern.compile(
			"^[a-zA-Z0-9]([a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?$");
	private static final String SCHEME = "https://";
	private static final String JWKS_PATH = "/.well-known/jwks.json";
	private static final String TRAILING_DELIMITER = "$";

	/**
	 * Decodes the Clerk Frontend API host embedded in a publishable key.
	 *
	 * @param publishableKey Clerk publishable key
	 * @return bare DNS hostname, or {@code null} when the key is blank
	 */
	public String decodeFrontendApiHost(String publishableKey) {
		if (publishableKey == null || publishableKey.isBlank()) {
			return null;
		}
		Matcher matcher = KEY_PATTERN.matcher(publishableKey.trim());
		if (!matcher.matches()) {
			throw new IllegalStateException(
					"Malformed CLERK_PUBLISHABLE_KEY: expected pk_test_<base64> or pk_live_<base64>.");
		}
		String host;
		try {
			byte[] decoded = Base64.getUrlDecoder().decode(matcher.group(2));
			host = new String(decoded, StandardCharsets.UTF_8);
		} catch (IllegalArgumentException exception) {
			throw new IllegalStateException(
					"Malformed CLERK_PUBLISHABLE_KEY: payload is not valid base64.", exception);
		}
		if (host.endsWith(TRAILING_DELIMITER)) {
			host = host.substring(0, host.length() - TRAILING_DELIMITER.length());
		}
		validateHost(host);
		return host;
	}

	/**
	 * Builds the Clerk issuer URI from a publishable key.
	 *
	 * @param publishableKey Clerk publishable key
	 * @return issuer URI, or {@code null} when the key is blank
	 */
	public String issuerFromPublishableKey(String publishableKey) {
		String host = decodeFrontendApiHost(publishableKey);
		return host == null ? null : SCHEME + host;
	}

	/**
	 * Builds the Clerk JWKS URI from a publishable key.
	 *
	 * @param publishableKey Clerk publishable key
	 * @return JWKS URI, or {@code null} when the key is blank
	 */
	public String jwksUriFromPublishableKey(String publishableKey) {
		String issuer = issuerFromPublishableKey(publishableKey);
		return issuer == null ? null : issuer + JWKS_PATH;
	}

	/**
	 * Validates that the decoded value is a bare DNS hostname.
	 *
	 * @param host decoded host value
	 */
	public void validateHost(String host) {
		if (host == null || host.isBlank()) {
			throw new IllegalStateException(
					"Malformed CLERK_PUBLISHABLE_KEY: decoded host is blank.");
		}
		if (host.contains("://") || host.contains("/") || host.contains("?")
				|| host.contains("#") || host.contains("@") || host.contains(":")
				|| host.contains(" ") || host.contains("\t")) {
			throw new IllegalStateException(
					"Malformed CLERK_PUBLISHABLE_KEY: decoded host must be a bare DNS hostname.");
		}
		String[] labels = host.split("\\.", -1);
		if (labels.length == 0) {
			throw new IllegalStateException(
					"Malformed CLERK_PUBLISHABLE_KEY: decoded host has no DNS labels.");
		}
		for (String label : labels) {
			if (label.isEmpty() || !DNS_LABEL_PATTERN.matcher(label).matches()) {
				throw new IllegalStateException(
						"Malformed CLERK_PUBLISHABLE_KEY: invalid DNS label '" + label + "'.");
			}
		}
	}
}
