package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Shape of Pacing's {@code GET /api/me} response body. Pacing also returns {@code user_id},
 * {@code name}, {@code email}, {@code can_create} and {@code scope} - none of them read here,
 * since the Hub already knows all of them from its own RBAC - {@code ignoreUnknown} so their
 * presence does not fail deserialization.
 *
 * @param notify_destination where the Daily Summary is delivered: {@code auto}, {@code dm}, or
 *                           {@code off}
 * @param slack_channel_id   the person's own private Slack group id, or SQL NULL if none is set
 */
@com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
record MeResponse(String notify_destination, String slack_channel_id) {
}
