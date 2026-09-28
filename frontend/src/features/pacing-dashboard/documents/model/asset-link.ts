import type { PacingCampaignLinkV1 } from "../../types";

/** How a campaign link is classified for the header chip row (§16): a DSP console (surfaced
 *  first - the team's primary jump), one of the four preset slots, or a custom link. */
export type AssetLinkKind = "dsp" | "preset" | "other";

/** A campaign link enriched with its classification, as `orderAssetLinks` returns it. */
export interface OrderedAssetLink extends PacingCampaignLinkV1 {
  kind: AssetLinkKind;
  /** Canonical DSP key (`dv360`, `ttd`, ...) when the name reads as a DSP, else null. */
  dsp: string | null;
}

/** One DSP the name detector knows: its canonical key, display label, and every spelling the team
 *  uses for it ("DV360", "dv 360", "dv", "The Trade Desk", "TTD", ...). */
export interface DspRegistryEntry {
  key: string;
  label: string;
  aliases: string[];
}

/** One of the four preset slots the Documents panel shows as a labelled field. */
export interface AssetPreset {
  /** The stored link `name` this slot owns - preset matching is by exact name. */
  key: string;
  /** The two-tone letter mark drawn beside the label (a class + its letter, never an image). */
  iconCls: string;
  iconText: string;
}
