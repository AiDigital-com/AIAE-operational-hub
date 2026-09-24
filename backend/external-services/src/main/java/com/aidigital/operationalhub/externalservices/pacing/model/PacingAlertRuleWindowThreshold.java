package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Bid Fact above plan (§14 of the migration plan) - the only one of the 13 configurable alert keys
 * with both a lookback window and a threshold.
 *
 * @param enabled      whether this detector runs at all
 * @param slack        whether a firing alert also posts to Slack
 * @param window       lookback window in days with data; Pacing only accepts 1, 2 or 3
 * @param thresholdPct how far above the plan CPM triggers the alert, in percent; wire key
 *                     {@code threshold_pct}
 */
public record PacingAlertRuleWindowThreshold(
		boolean enabled,
		boolean slack,
		int window,
		@JsonProperty("threshold_pct") double thresholdPct) {
}
