package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignLink;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Shape of the links-only {@code POST /api/dashboards/:slug/settings} request body (§16 of the
 * migration plan) - carries {@code campaign_links} only, so a links save can never accidentally
 * touch the display, the plan, or any other stored namespace. Pacing's {@code saveSettings}
 * replaces the stored array with this one wholesale ({@code dash-gate/lib/db.mjs}: a present
 * {@code campaign_links} key overwrites, never merges).
 *
 * @param campaignLinks every link the pacing should keep, serialized under the snake_case wire key
 *                      {@code campaign_links} Pacing stores
 */
record CampaignLinksRequest(@JsonProperty("campaign_links") List<PacingCampaignLink> campaignLinks) {
}
