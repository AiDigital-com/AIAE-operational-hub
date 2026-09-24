package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * Legacy metrics namespace beside the alerts (§14 of the migration plan), unrelated to any
 * detector: whether the Slack summary's daily table includes a VCR/ACR column.
 *
 * @param vcr include the VCR/ACR column in the Slack daily summary
 */
public record PacingNotifyMetrics(boolean vcr) {
}
