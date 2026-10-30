package com.aidigital.operationalhub.externalservices.pacing;

import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDashboardStream;

/**
 * The one Pacing call the Hub copies through without reading: {@code GET /api/dashboards/:slug/data},
 * the dashboard body (DASHBOARD-DATA-PASSTHROUGH-PLAN, 2026-10-29).
 *
 * <p>Kept apart from {@link PacingClient} for two reasons. That file is at the 2000 lines this module
 * caps a source file at, like every other client split off it. And this call needs a transport of its
 * own: a cold rebuild of the biggest body takes Pacing longer than the 10 seconds the general read
 * timeout allows, so this client waits 60 ({@code app.external.pacing.dashboard-read-timeout-ms}),
 * which is the one thing the two transports differ in.
 */
public interface PacingDashboardDataClient {

	/**
	 * Opens the dashboard body for streaming, forwarding the browser's own conditional-request and
	 * content-negotiation headers so Pacing decides the 304 and the compression, not the Hub.
	 *
	 * @param assertion      who is calling and what they may see
	 * @param slug           the pacing's dash_slug
	 * @param ifNoneMatch    the browser's {@code If-None-Match}, or null/blank when it sent none
	 * @param acceptEncoding the browser's {@code Accept-Encoding}, or null/blank when it sent none
	 * @return the open answer - a 200 whose body the caller must drain and close, or a 304
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         on any other non-2xx answer (not found, no access, unknown user, bad request) or a
	 *         network failure (unchecked); nothing is left open in that case
	 */
	PacingDashboardStream open(HubAssertion assertion, String slug, String ifNoneMatch, String acceptEncoding);
}
