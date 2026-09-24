package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Data gap (§14 of the migration plan) - missing days between two dates that both have data.
 *
 * @param enabled whether this detector runs at all
 * @param slack   whether a firing alert also posts to Slack
 * @param gapDays how many missing days between two data-bearing dates triggers the alert; wire key
 *                {@code gap_days}
 */
public record PacingAlertRuleGapDays(boolean enabled, boolean slack, @JsonProperty("gap_days") int gapDays) {
}
