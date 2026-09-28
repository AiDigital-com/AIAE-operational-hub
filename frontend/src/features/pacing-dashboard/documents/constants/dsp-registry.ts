import type { DspRegistryEntry } from "../model/asset-link";

/**
 * Every DSP the link-name detector recognises, ported verbatim from the retired SPA's
 * `dsp-detect.js` registry (17 platforms) - §16's owner decision was "port as is", so an alias
 * added here should be added there in spirit only: the SPA is retired and this list is now the
 * live one. Order matters for exactly one case: DV360 first, because it owns the short, ambiguous
 * "dv" alias the team uses.
 */
export const DSP_REGISTRY: DspRegistryEntry[] = [
  {
    key: "dv360",
    label: "DV360",
    aliases: [
      "dv360",
      "dv 360",
      "dv-360",
      "dv",
      "dbm",
      "display video 360",
      "display and video 360",
      "doubleclick bid manager",
      "google dv360",
    ],
  },
  { key: "ttd", label: "The Trade Desk", aliases: ["ttd", "the trade desk", "trade desk", "tradedesk"] },
  { key: "beeswax", label: "Beeswax", aliases: ["beeswax"] },
  { key: "amazon", label: "Amazon DSP", aliases: ["amazon", "amazon dsp", "amzn", "aap", "amazon advertising"] },
  { key: "xandr", label: "Xandr", aliases: ["xandr", "appnexus", "app nexus"] },
  { key: "meta", label: "Meta", aliases: ["meta", "facebook", "fb", "meta ads", "facebook ads", "instagram"] },
  { key: "google_ads", label: "Google Ads", aliases: ["google ads", "googleads", "adwords", "google adwords"] },
  { key: "linkedin", label: "LinkedIn", aliases: ["linkedin", "linked in", "linkedin ads"] },
  { key: "tiktok", label: "TikTok", aliases: ["tiktok", "tik tok"] },
  { key: "spotify", label: "Spotify", aliases: ["spotify", "spotify ads"] },
  { key: "vistar", label: "Vistar", aliases: ["vistar", "vistar media"] },
  { key: "yahoo", label: "Yahoo DSP", aliases: ["yahoo", "yahoo dsp", "verizon media"] },
  { key: "mediamath", label: "MediaMath", aliases: ["mediamath", "media math"] },
  { key: "adform", label: "Adform", aliases: ["adform", "ad form"] },
  { key: "stackadapt", label: "StackAdapt", aliases: ["stackadapt", "stack adapt"] },
  { key: "criteo", label: "Criteo", aliases: ["criteo"] },
  { key: "pubmatic", label: "PubMatic", aliases: ["pubmatic", "pub matic"] },
];
