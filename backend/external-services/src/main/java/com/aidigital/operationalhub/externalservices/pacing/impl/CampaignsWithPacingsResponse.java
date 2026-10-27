package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Shape of Pacing's {@code GET /api/internal/campaigns-with-pacings} response body.
 *
 * @param campaignIds every NetSuite campaign id at least one pacing covers, as text
 */
record CampaignsWithPacingsResponse(@JsonProperty("campaign_ids") List<String> campaignIds) {
}
