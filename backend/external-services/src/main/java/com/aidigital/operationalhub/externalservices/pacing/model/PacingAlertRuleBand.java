package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * Pacing off-pace (§14 of the migration plan) - a two-sided band in percentage points around
 * on-pace (0). {@code low} must be strictly less than {@code high}: Pacing refuses a save where it
 * is not, because an inverted band would fire for every settled line item on every refresh rather
 * than merely misfiring once.
 *
 * @param enabled whether this detector runs at all
 * @param slack   whether a firing alert also posts to Slack
 * @param low     lower bound, in percentage points
 * @param high    upper bound, in percentage points
 */
public record PacingAlertRuleBand(boolean enabled, boolean slack, double low, double high) {
}
