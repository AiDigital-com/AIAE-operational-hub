package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.List;

/**
 * The CM360 campaign list a user picks a pacing's third-party source from, as
 * {@code GET /api/dashboards/:slug/third-party/campaigns} returns it.
 *
 * <p>GLOBAL, not per pacing - the slug in the path only authorises the read. Pacing holds one
 * ten-minute cache for every dashboard and answers a failed upstream read with its last good copy
 * rather than an empty picker, which is what {@code stale} says.
 *
 * @param ok         Pacing's own envelope flag
 * @param campaigns  every campaign the export carries, ranked by impressions
 * @param stale      true when this is the cached copy served after an upstream failure
 */
public record PacingThirdPartyCampaigns(
		boolean ok,
		List<PacingThirdPartyCampaign> campaigns,
		boolean stale) {
}
