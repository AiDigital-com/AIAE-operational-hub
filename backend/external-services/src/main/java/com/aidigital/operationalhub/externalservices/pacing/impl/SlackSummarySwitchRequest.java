package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Shape of the {@code PUT /api/admin/slack-summaries} request body. Pacing refuses (400) anything
 * that is not a real boolean, so a malformed call can never read as "off".
 *
 * @param enabled the new state of the switch
 */
record SlackSummarySwitchRequest(boolean enabled) {
}
