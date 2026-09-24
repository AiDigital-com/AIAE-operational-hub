package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * Stale data (§14 of the migration plan) - how many days old the latest data point must be to
 * trigger the alert.
 *
 * @param enabled whether this detector runs at all
 * @param slack   whether a firing alert also posts to Slack
 * @param days    data age, in days, that triggers the alert
 */
public record PacingAlertRuleDays(boolean enabled, boolean slack, int days) {
}
