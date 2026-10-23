package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * The daily Slack summaries switch ({@code GET|PUT /api/admin/slack-summaries} on the Pacing side):
 * one row for the whole service. Off means no owner and no delegate gets a summary after any
 * refresh; on means everything as before.
 *
 * @param enabled   true when summaries are sent
 * @param updatedAt ISO-8601 timestamp of the last switch, or null while nobody has ever pressed it
 * @param updatedBy email of the admin who last pressed it, or null while nobody has ever pressed it
 */
public record PacingSlackSummarySwitch(boolean enabled, String updatedAt, String updatedBy) {
}
