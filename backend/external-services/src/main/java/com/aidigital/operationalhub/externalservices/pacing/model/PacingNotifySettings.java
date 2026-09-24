package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * A pacing's whole alert configuration (§14 of the migration plan) - Pacing's {@code config.notify}
 * namespace, as {@code GET /api/dashboards/:slug/data} returns it and as
 * {@code POST /api/dashboards/:slug/settings} (the {@code notify} fragment) writes it back.
 *
 * <p>Unlike {@link PacingDataSettings}, this is a WHOLE-OBJECT replace on the Pacing side, not a
 * partial patch: {@code dash-gate/lib/db.mjs:saveSettings} stores {@code notify} as one unit, and
 * its validator ({@code notify-validate.mjs}) requires every one of the 13 alert keys to be
 * present. A caller here must round-trip the whole object it read, not just the fields it changed -
 * see {@link com.aidigital.operationalhub.externalservices.pacing.PacingClient#saveNotifySettings}.
 *
 * @param alerts            the 13 configurable detectors plus the master Slack switch
 * @param metrics           the legacy VCR/ACR summary-column toggle
 * @param hidePaused        exclude paused line items from the Slack summary; wire key
 *                          {@code hide_paused}
 * @param summaryProjection which target the Slack summary's "Tgt" column prints - {@code plan} or
 *                          {@code reforecast}; wire key {@code summary_projection}. A raw string
 *                          here, like {@link PacingDataSettings#source()}: validated against the
 *                          same two-value allowlist on both sides
 */
public record PacingNotifySettings(
		PacingAlertsConfig alerts,
		PacingNotifyMetrics metrics,
		@JsonProperty("hide_paused") boolean hidePaused,
		@JsonProperty("summary_projection") String summaryProjection) {
}
