package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * All 13 configurable alert detectors, plus the master Slack switch (§14 of the migration plan).
 * Field names are camelCase on this side; {@link com.fasterxml.jackson.annotation.JsonProperty}
 * translates each one to the snake_case key Pacing stores it under (its own
 * {@code shared/alerts-core.js} run() calls). Two more detectors exist on the Pacing side -
 * {@code post_flight_delivery} and {@code paused_li_delivering} - with no configuration entry at
 * all; they are not represented here because there is nothing to edit for them.
 *
 * @param enabled              master "send alerts to Slack" switch; off leaves every alert on the
 *                             dashboard only
 * @param bidFactAbovePlan     wire key {@code bid_fact_above_plan}
 * @param dataGap              wire key {@code data_gap}
 * @param ctrBelowTarget       wire key {@code ctr_below_target}
 * @param vcrBelowTarget       wire key {@code vcr_below_target}
 * @param ctrAboveTarget       wire key {@code ctr_above_target}
 * @param vcrOver100           wire key {@code vcr_over_100}
 * @param noImpressionsYet     wire key {@code no_impressions_yet}
 * @param pacingOffPace        wire key {@code pacing_off_pace}
 * @param marginBelowTarget    wire key {@code margin_below_target}
 * @param spendOverspend       wire key {@code spend_overspend}
 * @param dspForecastOverspend wire key {@code dsp_forecast_overspend}
 * @param staleData            wire key {@code stale_data}
 * @param rateCostAbovePlan    wire key {@code rate_cost_above_plan}
 */
public record PacingAlertsConfig(
		boolean enabled,
		@JsonProperty("bid_fact_above_plan") PacingAlertRuleWindowThreshold bidFactAbovePlan,
		@JsonProperty("data_gap") PacingAlertRuleGapDays dataGap,
		@JsonProperty("ctr_below_target") PacingAlertRuleFactor ctrBelowTarget,
		@JsonProperty("vcr_below_target") PacingAlertRuleFactor vcrBelowTarget,
		@JsonProperty("ctr_above_target") PacingAlertRuleFactor ctrAboveTarget,
		@JsonProperty("vcr_over_100") PacingAlertRuleBase vcrOver100,
		@JsonProperty("no_impressions_yet") PacingAlertRuleBase noImpressionsYet,
		@JsonProperty("pacing_off_pace") PacingAlertRuleBand pacingOffPace,
		@JsonProperty("margin_below_target") PacingAlertRuleGapPp marginBelowTarget,
		@JsonProperty("spend_overspend") PacingAlertRuleSpend spendOverspend,
		@JsonProperty("dsp_forecast_overspend") PacingAlertRuleBase dspForecastOverspend,
		@JsonProperty("stale_data") PacingAlertRuleDays staleData,
		@JsonProperty("rate_cost_above_plan") PacingAlertRuleThresholdPct rateCostAbovePlan) {
}
