import type { CampaignRefV1, PacingRowV1 } from "./types";

/**
 * Router state carried when navigating to a campaign's Pacing tab to open one specific pacing
 * (US-113): set once by the Overview when a pacing is opened, and re-set by the Pacing tab itself
 * when the user follows an "also covers" link to another campaign that shares the same pacing — so
 * that campaign's tab opens the same pacing too.
 */
export interface OpenPacingState {
  openPacingId: string;
}

/**
 * Resolves the URL US-113 navigates to when a pacing is opened from the Overview: the FIRST campaign
 * in the pacing's own campaign list, with the Pacing tab open. `null` when the pacing has no campaign
 * to navigate to (an unresolved/pre-§3 pacing) — the caller keeps the row inert rather than routing
 * to a broken page.
 *
 * Pacing's campaign ids are NetSuite campaign ids, always numeric on the wire, serialized as strings
 * (see `PacingCampaignRef`, the Pacing-service Java model). The Hub's own campaign route uses the same
 * underlying NetSuite `campaign_id` as a number (`CampaignModel.id`, grouped from the same BigQuery IO
 * Lines table Pacing itself reads via NetSuite) — so the two are the same id, just typed differently.
 */
export function pacingRoute(row: Pick<PacingRowV1, "id" | "campaigns">): { path: string; state: OpenPacingState } | null {
  const primary: CampaignRefV1 | undefined = (row.campaigns ?? [])[0];
  if (!primary) return null;
  const campaignId = Number(primary.id);
  if (!Number.isFinite(campaignId)) return null;
  return { path: `/campaigns/${campaignId}/pacing`, state: { openPacingId: row.id } };
}
