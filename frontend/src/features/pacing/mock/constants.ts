/**
 * The mock's own internal status vocabulary — used only for pacing-generation math (e.g. the
 * archived/complete "done" check in `campPacing`). Display always uses the real campaign's own status
 * string via `StatusBadge`, never this narrowed set.
 */
export type MockStatus = "live" | "paused" | "complete" | "archived" | "draft";

export const STATUS: Record<MockStatus, { label: string; color: string }> = {
  live: { label: "Live", color: "var(--good)" },
  paused: { label: "Paused", color: "var(--attention)" },
  complete: { label: "Complete", color: "var(--primary)" },
  archived: { label: "Archived", color: "var(--muted)" },
  draft: { label: "Draft", color: "var(--muted-strong)" },
};

/** Pacing-deviation classification, driving the Overview's per-campaign alert count. */
export type PaceState = "on" | "over" | "under" | "nodata";

export const CHANNELS = ["Display", "Video", "Search", "Social", "CTV", "Email", "Audio"] as const;
export type MockChannel = (typeof CHANNELS)[number];

export const TACTICS: Record<MockChannel, string[]> = {
  Display: ["Prospecting", "Retargeting"],
  Video: ["Pre-roll", "In-stream"],
  Search: ["Brand", "Non-brand"],
  Social: ["Awareness", "Conversion"],
  CTV: ["Live Sports", "Genre"],
  Email: ["Newsletter"],
  Audio: ["Podcast"],
};
