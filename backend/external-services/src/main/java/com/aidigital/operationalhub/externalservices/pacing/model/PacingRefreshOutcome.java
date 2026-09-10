package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * The outcome of {@code POST /api/pacings/:id/refresh} (US-119). Not every non-2xx from this endpoint
 * is a failure: a 429 inside the two-minute cooldown carries the remaining seconds so the caller can
 * show a countdown instead of a bare error, so {@link com.aidigital.operationalhub.externalservices
 * .pacing.PacingClient#refreshPacing} returns this instead of throwing for that specific case.
 * Genuine failures (unreachable, unrecognized status, the pacing not being Live, not found, an
 * unsynced caller) still throw {@code PacingExternalException}.
 *
 * @param started            true if the refresh was triggered
 * @param retryAfterSeconds  seconds remaining in the cooldown; null when {@code started} is true
 */
public record PacingRefreshOutcome(boolean started, Integer retryAfterSeconds) {

	public static PacingRefreshOutcome triggered() {
		return new PacingRefreshOutcome(true, null);
	}

	public static PacingRefreshOutcome cooldown(int retryAfterSeconds) {
		return new PacingRefreshOutcome(false, retryAfterSeconds);
	}
}
