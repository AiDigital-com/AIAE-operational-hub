import type { PacingAlertV1 } from "./types";

/** Dot color for the pacing's own administrative status — a different vocabulary from the campaign
 *  statuses `StatusBadge` is normally fed (Live/Paused/Complete/Archive vs. NetSuite's own set), so
 *  Pacing screens resolve their own colors rather than reusing `resolveStatusStyle`. Shared between
 *  the Overview (§4) and a campaign's Pacing tab (§5) so a pacing reads identically on both. */
export const PACING_STATUS_STYLE: Record<string, { color: string; glow?: boolean }> = {
  Live: { color: "var(--good)", glow: true },
  Paused: { color: "var(--attention)" },
  Complete: { color: "var(--primary)" },
  Archive: { color: "var(--muted)" },
};

export const PACE_STATUS_LABEL: Record<string, string> = {
  on_pace: "On pace",
  over: "Over pace",
  under: "Under pace",
  no_data: "No data",
  inactive: "Inactive",
};

export const PACE_STATUS_COLOR: Record<string, string> = {
  on_pace: "var(--good)",
  over: "var(--attention-text)",
  under: "var(--bad)",
  no_data: "var(--muted)",
  inactive: "var(--muted)",
};

export const ALERT_SEVERITY_ORDER = ["critical", "warning", "info"] as const;

export function groupAlertsBySeverity(alerts: readonly PacingAlertV1[]): Record<string, PacingAlertV1[]> {
  const out: Record<string, PacingAlertV1[]> = {};
  for (const alert of alerts) {
    (out[alert.severity] ??= []).push(alert);
  }
  return out;
}
