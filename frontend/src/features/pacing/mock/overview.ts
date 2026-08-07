import type { CampaignV1 } from "../../campaigns/types";
import { campaignDisplayName } from "../../../shared/format/names";
import { toPacingCampaign } from "./adapter";
import { campPacing, paceOf } from "./pacing";
import type { Overview, OwnerCampaign } from "./types";

/**
 * Builds the operational overview from the user's REAL, RBAC-scoped campaigns: pacing is generated per
 * real campaign id (`campPacing`). Never invents a campaign: every row traces back to a real campaign in
 * `campaigns`.
 *
 * @param campaigns the real, RBAC-scoped campaigns to build the overview from
 * @return the campaign table plus its rollup summary
 */
export function buildOverview(campaigns: CampaignV1[]): Overview {
  const rows: OwnerCampaign[] = campaigns.map((campaign) => {
    const mockCam = toPacingCampaign(campaign);
    const pacing = campPacing(mockCam);
    const isNoData = pacing.budget === 0;

    return {
      id: mockCam.id,
      name: campaignDisplayName(campaign.name),
      agency: campaign.agency_name ?? "",
      client: campaign.client_name ?? "",
      status: campaign.status ?? "",
      budget: pacing.budget,
      // Real, not mock: line_item_count comes straight from the same BigQuery IO Lines table the
      // Setup tab reads (a real COUNT(DISTINCT line_item_id) per campaign) - only budget/margin/pace
      // below are still the mock pacing overlay.
      li: campaign.line_item_count ?? 0,
      marginA: isNoData ? null : pacing.marginA,
      marginT: pacing.marginT,
      pp: isNoData ? null : pacing.pp,
      pace: paceOf({ budget: pacing.budget, pp: pacing.pp }),
      flight: pacing.flight,
      days: pacing.days,
    };
  });

  let lineItems = 0;
  let budget = 0;
  for (const row of rows) {
    lineItems += row.li;
    budget += row.budget;
  }

  return {
    campaigns: rows,
    summary: { campaigns: campaigns.length, lineItems, budget },
  };
}
