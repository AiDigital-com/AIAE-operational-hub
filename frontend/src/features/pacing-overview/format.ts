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

/**
 * Who NetSuite thinks runs this pacing, if it disagrees with Pacing's own owner (§11, US-132).
 *
 * Returns the NetSuite name only when the two genuinely differ, so a caller can render the
 * disagreement and nothing otherwise. Null means "nothing to say": they agree, or NetSuite named
 * nobody, or this pacing has not revalidated since the field started being stored.
 *
 * COMPARED VERBATIM, and that is deliberate. There is no key shared between the two systems — the
 * match is a convention people maintain by typing the same name into both, and Pacing's own query
 * rejects a non-Latin name loudly for exactly this reason. Trimming, case-folding or stripping
 * diacritics here would paper over a real mismatch (`Mimic` is not how `Mimić` is spelled in
 * NetSuite) and hide the very disagreement this exists to surface.
 *
 * A pacing spanning several campaigns can name several leads; the first that disagrees is enough to
 * flag it, and the row shows that one. Which of the two is wrong is the reader's call — Pacing's
 * owner keeps driving access regardless.
 */
export function netSuiteLeadMismatch(
  ownerName: string | null | undefined,
  campaigns: ReadonlyArray<{ mpoTeamLead?: string | null }> | null | undefined,
): string | null {
  const owner = ownerName ?? "";
  for (const campaign of campaigns ?? []) {
    const lead = campaign.mpoTeamLead;
    if (lead && lead !== owner) return lead;
  }
  return null;
}
