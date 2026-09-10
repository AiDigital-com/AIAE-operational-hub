package com.aidigital.operationalhub.externalservices.pacing.exception;

/**
 * Why a call to Pacing failed, carried by {@link PacingExternalException} so the application layer can
 * answer the Hub's own caller with an honest status code instead of collapsing every Pacing failure
 * into a single 500.
 *
 * @see PacingExternalException#getReason()
 */
public enum PacingFailureReason {

	/**
	 * Pacing never answered: connection refused, or a connect/read timeout. The Hub's dependency is
	 * down, which the Hub's own caller should see as {@code 503}, not {@code 500}.
	 */
	UNREACHABLE,

	/**
	 * Pacing answered {@code 401}: the two services' shared HMAC secrets disagree. This is a server
	 * misconfiguration, never something the calling user did - deliberately mapped to {@code 500}, not
	 * passed through as {@code 401}, because the Hub's frontend logs a user out on any {@code 401} it
	 * sees from the Hub (see {@code frontend/src/shared/api/client.ts}).
	 */
	UPSTREAM_UNAUTHORIZED,

	/**
	 * Pacing answered {@code 403} with {@code unknown_user}: the Hub knows this user, but Pacing's user
	 * mirror does not (yet). Mapped to {@code 409}, not passed through as {@code 403} - the truth is a
	 * sync gap, not "you are forbidden".
	 */
	UPSTREAM_USER_NOT_SYNCED,

	/**
	 * Pacing answered {@code 404}.
	 */
	UPSTREAM_NOT_FOUND,

	/**
	 * Any other non-2xx response from Pacing, or a failure that happened entirely on the Hub's side
	 * (e.g. signing the assertion). Mapped to {@code 500}.
	 */
	OTHER
}
