package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Rate cost (CPC/CPV) above plan (§14 of the migration plan) - how far above plan cost-per-unit
 * triggers the alert.
 *
 * @param enabled      whether this detector runs at all
 * @param slack        whether a firing alert also posts to Slack
 * @param thresholdPct how far above plan cost-per-unit triggers the alert, in percent; wire key
 *                     {@code threshold_pct}
 */
public record PacingAlertRuleThresholdPct(
		boolean enabled, boolean slack, @JsonProperty("threshold_pct") double thresholdPct) {
}
