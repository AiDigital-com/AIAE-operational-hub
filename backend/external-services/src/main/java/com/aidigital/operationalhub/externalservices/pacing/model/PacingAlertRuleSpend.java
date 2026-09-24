package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Spend overspend (§14 of the migration plan) - two thresholds against percent of cost budget
 * spent: {@code warnPct} for a warning, {@code badPct} for critical. Pacing refuses a save where
 * {@code badPct} is below {@code warnPct}.
 *
 * @param enabled whether this detector runs at all
 * @param slack   whether a firing alert also posts to Slack
 * @param warnPct percent of cost budget spent that triggers a warning; wire key {@code warn_pct}
 * @param badPct  percent of cost budget spent that triggers critical; wire key {@code bad_pct}
 */
public record PacingAlertRuleSpend(
		boolean enabled,
		boolean slack,
		@JsonProperty("warn_pct") double warnPct,
		@JsonProperty("bad_pct") double badPct) {
}
