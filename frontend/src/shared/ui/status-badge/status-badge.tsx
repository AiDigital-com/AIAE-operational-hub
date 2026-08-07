import { cn } from "../../style/cn";
import "./status-badge.css";

// Maps a real (BigQuery-sourced) campaign or insertion-order status to its dot color; "Live" gets a
// glowing ring. Shared across every surface that shows one of these statuses (Overview, Campaigns
// table, campaign hero, Setup tab) so they read identically.
const STATUS_STYLE: Record<string, { color: string; glow?: boolean }> = {
  Live: { color: "var(--good)", glow: true },
  Finished: { color: "var(--primary)" },
  Complete: { color: "var(--primary)" },
  "To Be Launched": { color: "var(--attention)" },
  Paused: { color: "var(--attention)" },
  Postponed: { color: "var(--muted)" },
  "Canceled After Launch": { color: "var(--bad)" },
  Archived: { color: "var(--muted)" },
  Draft: { color: "var(--muted-strong)" },
};

/**
 * Resolves a real campaign status string to a {@link StatusBadge} color/glow pair. Unrecognized
 * statuses fall back to a neutral muted dot rather than guessing.
 */
export function resolveStatusStyle(status?: string | null): { color: string; glow?: boolean } {
  return (status ? STATUS_STYLE[status] : undefined) ?? { color: "var(--muted)" };
}

/**
 * "Finished" reads as unfinished business in NetSuite's own vocabulary, but "Complete" is the clearer
 * word for this app's users - swapped at display time only. Every other real status renders verbatim;
 * the underlying value used for filtering/matching is never touched.
 */
export function displayStatusLabel(status?: string | null): string {
  if (!status) return "—";
  return status === "Finished" ? "Complete" : status;
}

/** One segmented-filter option: `value` is the exact real NetSuite status it matches ("" = no filter). */
export interface StatusSegment {
  key: string;
  label: string;
  value: string;
}

/**
 * The real, exhaustive NetSuite order-status vocabulary as segmented-filter options - shared by Overview
 * and the client's Campaigns table so both filter the same way instead of drifting apart. "All" always
 * comes first; every other real status has its own segment (no status is reachable only via "All").
 */
export const CAMPAIGN_STATUS_SEGMENTS: StatusSegment[] = [
  { key: "all", label: "All", value: "" },
  { key: "live", label: "Live", value: "Live" },
  { key: "paused", label: "Paused", value: "Paused" },
  { key: "completed", label: "Complete", value: "Finished" },
  { key: "postponed", label: "Postponed", value: "Postponed" },
  { key: "canceled", label: "Canceled", value: "Canceled After Launch" },
  { key: "toBeLaunched", label: "To Be Launched", value: "To Be Launched" },
];

interface StatusBadgeProps {
  label: string;
  color: string;
  /** Pulsing ring around the dot — used for "Live"-style actively-running states. */
  glow?: boolean;
  className?: string;
}

/**
 * A status pill: a colored LED dot + label. Deliberately decoupled from any specific status
 * vocabulary (real campaign statuses and the mock's internal ones differ) — callers resolve their own
 * label/color. Ported from the mockup's `statusBadge()`.
 */
export function StatusBadge({ label, color, glow, className }: StatusBadgeProps) {
  return (
    <span className={cn("status-badge", glow && "status-badge--glow", className)}>
      <span className="status-badge__led" style={{ background: color }} />
      {label}
    </span>
  );
}
