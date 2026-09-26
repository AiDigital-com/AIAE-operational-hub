package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Shape of the {@code POST /api/pacings/validate} request body for the campaign-scoped selector
 * (§8 of the migration plan) - the only selector the Hub uses.
 *
 * @param campaign_id the NetSuite campaign id to validate
 */
record ValidateRequest(String campaign_id) {
}
