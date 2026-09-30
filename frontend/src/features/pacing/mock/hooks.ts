import { useQuery } from "@tanstack/react-query";
import type { CampaignV1 } from "../../campaigns/types";
import { toPacingCampaign } from "./adapter";
import { campPacing } from "./pacing";

// Components never call the generators in ./pacing directly — always through this hook, so the
// eventual real-API swap (see 03-REAL-DASHBOARD-INTEGRATION.md) touches only this file. The
// Overview's own mock rollup (`useOverviewPacing`/`buildOverview`) is gone: `/` now renders the
// real pacing list (`usePacingOverview`, features/pacing-overview) grouped by owner.

/**
 * A single real campaign's mock pacing overlay, stable across re-renders (seeded by its real id).
 *
 * The key is "pacing-mock", NOT "pacing": the real campaign Pacing tab (`useCampaignPacings`, §5)
 * keys on `["pacing", "campaign", id]`, and while this hook used that same key the two queries
 * shared one cache entry. Whoever ran first won it - so opening a campaign from the campaigns list,
 * which renders this overlay, left the Pacing tab reading THIS object: no `pacings` array (so "No
 * pacings yet") and no `scope` (so no Create Pacing button), with no request of its own, and
 * staleTime Infinity here meaning it never corrected itself until a full page reload. It also put
 * this mock query in the path of every `invalidateQueries(["pacing", "campaign"])` the real feature
 * fires. Mock data must not share a cache namespace with real data.
 */
export function useCampaignPacing(campaign: CampaignV1 | undefined) {
  return useQuery({
    queryKey: ["pacing-mock", "campaign", campaign?.id],
    queryFn: () => campPacing(toPacingCampaign(campaign as CampaignV1)),
    enabled: campaign != null,
    staleTime: Infinity,
  });
}
