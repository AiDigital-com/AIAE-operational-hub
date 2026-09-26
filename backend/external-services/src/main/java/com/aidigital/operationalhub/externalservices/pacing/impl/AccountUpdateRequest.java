package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Shape of the {@code PATCH /api/me} request body. Always carries both fields - see
 * {@code PacingAccountUpdateV1}'s own description for why the caller round-trips whichever one
 * it is not changing.
 *
 * @param notify_destination {@code auto}, {@code dm}, or {@code off}
 * @param slack_channel_id   the Slack group id, or an empty string to clear it
 */
record AccountUpdateRequest(String notify_destination, String slack_channel_id) {
}
