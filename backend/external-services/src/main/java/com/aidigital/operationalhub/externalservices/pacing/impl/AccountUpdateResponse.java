package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Shape of Pacing's {@code PATCH /api/me} success response body. Pacing also returns {@code ok};
 * not read here, since a non-2xx status already answers whether the save happened.
 *
 * @param notify_destination the value Pacing now has stored
 * @param slack_channel_id   the value Pacing now has stored, or SQL NULL if cleared/never set
 * @param slack_warning      set only when {@code slack_channel_id} changed and Pacing could not
 *                           check it against Slack; null on every other response
 */
@com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
record AccountUpdateResponse(String notify_destination, String slack_channel_id, String slack_warning) {
}
