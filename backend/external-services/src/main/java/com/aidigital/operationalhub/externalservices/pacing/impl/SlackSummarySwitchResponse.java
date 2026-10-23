package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Shape of Pacing's {@code GET|PUT /api/admin/slack-summaries} response body, under the snake_case
 * keys dash-gate answers with.
 *
 * @param enabled    true when summaries are sent; Pacing reads a missing row as true
 * @param updated_at ISO-8601 timestamp of the last switch, or null
 * @param updated_by email of the admin who last pressed it, or null
 */
@com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
record SlackSummarySwitchResponse(Boolean enabled, String updated_at, String updated_by) {
}
