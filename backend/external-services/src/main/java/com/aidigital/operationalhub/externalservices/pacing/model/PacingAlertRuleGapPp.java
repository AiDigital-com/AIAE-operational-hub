package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Margin below target (§14 of the migration plan) - how many percentage points below target margin
 * triggers the alert.
 *
 * @param enabled whether this detector runs at all
 * @param slack   whether a firing alert also posts to Slack
 * @param gapPp   the margin gap, in percentage points; wire key {@code gap_pp}
 */
public record PacingAlertRuleGapPp(boolean enabled, boolean slack, @JsonProperty("gap_pp") double gapPp) {
}
