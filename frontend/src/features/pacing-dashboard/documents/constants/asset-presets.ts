import type { AssetPreset } from "../model/asset-link";

/**
 * The four preset link slots (§16, matching the reference implementation exactly - the plan's
 * fifth "Dashboard" slot was deliberately not added, per the owner's decision to follow the
 * reference). Matching is by exact stored `name`; anything else is a custom link. Also the order
 * presets sort in inside the header chip row.
 */
export const PRESET_ORDER = ["Asana", "IO", "Media Plan", "Slack"] as const;

/** The same four slots with their editor letter-marks, in editor display order. */
export const PRESETS: AssetPreset[] = [
  { key: "Asana", iconCls: "asana", iconText: "A" },
  { key: "IO", iconCls: "io", iconText: "IO" },
  { key: "Media Plan", iconCls: "mp", iconText: "M" },
  { key: "Slack", iconCls: "slack", iconText: "S" },
];
