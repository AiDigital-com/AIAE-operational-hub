package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * The outcome of {@code POST /api/dashboards/:slug/third-party/refetch} - "pull the ad-server rows
 * again now".
 *
 * <p>Two non-2xx answers are not failures and must not reach the caller as errors. A 409 means the
 * pacing has no CM360 source configured, so there is nothing to fetch - a statement about the
 * pacing, not a fault. A 429 means the caller has spent the shared refresh budget; the UI shows a
 * wait, the same way it does for a dashboard refresh. Everything else still throws.
 *
 * @param started        true when the pull was started
 * @param notConfigured  true when the pacing has no CM360 source to pull
 * @param rateLimited    true when the refresh budget is spent
 */
public record PacingThirdPartyRefetchOutcome(
		boolean started,
		boolean notConfigured,
		boolean rateLimited) {

	public static PacingThirdPartyRefetchOutcome triggered() {
		return new PacingThirdPartyRefetchOutcome(true, false, false);
	}

	public static PacingThirdPartyRefetchOutcome noSource() {
		return new PacingThirdPartyRefetchOutcome(false, true, false);
	}

	public static PacingThirdPartyRefetchOutcome budgetSpent() {
		return new PacingThirdPartyRefetchOutcome(false, false, true);
	}
}
