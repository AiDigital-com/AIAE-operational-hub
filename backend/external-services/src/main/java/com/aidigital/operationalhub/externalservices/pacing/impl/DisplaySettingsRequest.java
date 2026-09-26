package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.Map;

/**
 * Shape of Pacing's {@code POST /api/dashboards/:slug/settings} request body, for a display-only
 * save (the Hub never writes any of the other config fields that endpoint also accepts).
 *
 * @param display     the display patch being saved
 * @param display_rev the revision this save was read at, matched against Pacing's own CAS counter
 * @param display_writer which display grammar this client can write. Transport, never stored, and
 *                       NOT optional: a save that changes a v2 widget without it comes back 409
 *                       {@code v2_writer_required}, which reads to a user as "the editor needs to
 *                       reload" — a stale-bundle message for a bundle that is not stale. The
 *                       values are Pacing's own, echoed from the dashboard payload's
 *                       {@code capabilities}, so this client never asserts a version it invented.
 */
record DisplaySettingsRequest(
		Map<String, Object> display, int display_rev, Map<String, Object> display_writer) {
}
