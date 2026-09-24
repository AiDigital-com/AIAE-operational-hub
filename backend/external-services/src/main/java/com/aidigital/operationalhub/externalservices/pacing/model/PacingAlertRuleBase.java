package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * A detector with no threshold of its own - just whether it runs and whether it also posts to
 * Slack (§14 of the migration plan). Used for {@code vcr_over_100}, {@code no_impressions_yet} and
 * {@code dsp_forecast_overspend} - the three of the 13 configurable alert keys that carry no
 * threshold field on the Pacing side.
 *
 * @param enabled whether this detector runs at all
 * @param slack   whether a firing alert also posts to Slack; has no effect while {@code enabled} is
 *                false, or while the master {@code alerts.enabled} switch is off
 */
public record PacingAlertRuleBase(boolean enabled, boolean slack) {
}
