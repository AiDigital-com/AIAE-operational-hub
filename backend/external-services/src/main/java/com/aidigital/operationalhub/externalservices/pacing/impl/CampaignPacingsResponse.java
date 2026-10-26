package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignPacing;

import java.util.List;

/**
 * Shape of Pacing's {@code GET /api/internal/campaign-pacings} response body.
 *
 * @param pacings the pacings on the campaign, by name
 */
record CampaignPacingsResponse(List<PacingCampaignPacing> pacings) {
}
