import { PRESET_ORDER } from "./constants/asset-presets";
import { detectDsp } from "./dsp-detect";
import type { AssetLinkKind, OrderedAssetLink } from "./model/asset-link";
import type { PacingCampaignLinkV1 } from "../types";

/**
 * Classifies and orders campaign links for the header chip row (§16). A TypeScript port of the
 * retired SPA's `asset-links.js`, behaviour-identical and covered by the same golden cases.
 *
 * DSP links first (the team's primary jump: glance pacing -> act in the DSP), then the preset
 * tools, then everything else.
 */

const RANK: Record<AssetLinkKind, number> = { dsp: 0, preset: 1, other: 2 };

/**
 * Links with a non-blank url, enriched and sorted: DSP (alphabetical) -> preset (in
 * `PRESET_ORDER`) -> other (alphabetical). A link with no url is dropped, not rendered dead.
 */
export function orderAssetLinks(links: PacingCampaignLinkV1[] | null | undefined): OrderedAssetLink[] {
  const enriched: OrderedAssetLink[] = (links ?? [])
    .filter((link) => link && link.url && String(link.url).trim())
    .map((link) => {
      const dsp = detectDsp(link.name);
      const kind: AssetLinkKind = dsp
        ? "dsp"
        : (PRESET_ORDER as readonly string[]).includes(link.name ?? "")
          ? "preset"
          : "other";
      return { ...link, kind, dsp: dsp ?? null };
    });

  return enriched.sort((a, b) => {
    if (RANK[a.kind] !== RANK[b.kind]) return RANK[a.kind] - RANK[b.kind];
    if (a.kind === "preset") {
      return (
        (PRESET_ORDER as readonly string[]).indexOf(a.name ?? "") -
        (PRESET_ORDER as readonly string[]).indexOf(b.name ?? "")
      );
    }
    return String(a.name).localeCompare(String(b.name));
  });
}
