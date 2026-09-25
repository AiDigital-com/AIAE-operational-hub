package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * The current user's own Pacing account preferences (Account Settings, "Daily Summary"). Pacing's
 * {@code GET /api/me} returns identity fields (name, email, scope, {@code can_create}) alongside
 * these two - none of those are carried here, because the Hub already knows all of them from its
 * own RBAC. This narrows to the two things Pacing itself owns, validates and stores.
 *
 * @param notifyDestination where the Daily Summary is delivered: {@code auto}, {@code dm}, or
 *                           {@code off}
 * @param slackChannelId    the id of the person's own private Slack group ({@code
 *                           access.users.slack_channel_id}), or an empty string when none is set
 * @param slackWarning      set only when a {@code PATCH} changed {@code slackChannelId} and Pacing
 *                           could not check the new value against Slack (an outage, or no bot
 *                           token configured on Pacing's side) - the value was still saved. {@code
 *                           null} on every other response, including every {@code GET}.
 */
public record PacingAccount(String notifyDestination, String slackChannelId, String slackWarning) {
}
