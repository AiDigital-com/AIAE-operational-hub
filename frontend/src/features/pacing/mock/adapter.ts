import type { CampaignV1 } from "../../campaigns/types";
import type { MockStatus } from "./constants";
import { parseMoney } from "./format";
import type { MockCam } from "./types";

const KNOWN_STATUSES: readonly MockStatus[] = ["live", "paused", "complete", "archived", "draft"];

/**
 * Narrows a real campaign's free-form status string (e.g. "Live", "To Be Launched", "Finished") to the
 * mock's internal 5-value vocabulary, used only for pacing-generation math. Unrecognized real statuses
 * (there are more of them than the mock models) default to "live" so pacing still generates; the real
 * status string itself is what the UI actually displays.
 */
function toMockStatus(status?: string | null): MockStatus {
  const lower = (status ?? "").trim().toLowerCase();
  return (KNOWN_STATUSES as readonly string[]).includes(lower) ? (lower as MockStatus) : "live";
}

/**
 * Adapts a real, RBAC-scoped campaign into the shape the mock pacing generators expect. `id` is always
 * the real campaign's own id, so every generator seeded from it is stable per real campaign and
 * identical across every screen that shows it (see 02-MOCK-PACING-SPEC.md, "In-sync requirement").
 *
 * @param campaign the real campaign, as returned by `searchCampaigns`
 * @return the mock-generator input derived from it
 */
export function toPacingCampaign(campaign: CampaignV1): MockCam {
  return {
    id: String(campaign.id),
    name: campaign.name,
    status: toMockStatus(campaign.status),
    start: campaign.start_date ?? "",
    end: campaign.end_date ?? "",
    budget: parseMoney(campaign.budget ?? 0),
    channels: (campaign.channels ?? []).filter(Boolean),
  };
}
