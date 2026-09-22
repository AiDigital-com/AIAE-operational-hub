import type { PacingAlertV1, PacingNsDiffCountsV1, PacingNsDiffSummaryV1 } from "./types";

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

/**
 * The single number the Overview's "NS diff" column sorts and displays by (§13, US-136). Sums ALL
 * SIX classes - none is filtered out, since a difference that looks routine to an engineer (e.g. a
 * fee line's `foreign_campaign`) might not be routine to the person looking, and hiding a class in
 * advance takes that judgement away from them. A pacing never checked (no summary) counts as 0 here;
 * callers that need to rank "never checked" below "confirmed in sync" do that themselves, the same
 * `?? -Infinity` way `MARGIN`/`PACING` sorting already does.
 */
export function totalNsDiffCount(summary: PacingNsDiffSummaryV1 | null | undefined): number {
  if (!summary) return 0;
  const { counts } = summary;
  return (
    counts.missingInNetsuite +
    counts.missingInPacing +
    counts.fieldDiff +
    counts.planDiff +
    counts.foreignCampaign +
    counts.ownerDiff
  );
}

const NS_DIFF_CLASS_LABEL: Record<keyof PacingNsDiffCountsV1, [singular: string, plural: string]> = {
  missingInNetsuite: ["missing in NetSuite", "missing in NetSuite"],
  missingInPacing: ["missing in Pacing", "missing in Pacing"],
  fieldDiff: ["field difference", "field differences"],
  planDiff: ["plan difference", "plan differences"],
  foreignCampaign: ["foreign campaign", "foreign campaigns"],
  ownerDiff: ["owner mismatch", "owner mismatches"],
};

/**
 * One line per non-zero class in a nightly NS-diff summary (§13, US-136), e.g. "2 field
 * differences" - a zero-count class is left out entirely, so a tooltip built to be scanned quickly
 * never pads itself with six lines when only one class actually fired.
 */
export function nsDiffBreakdownLines(summary: PacingNsDiffSummaryV1 | null | undefined): string[] {
  if (!summary) return [];
  const { counts } = summary;
  return (Object.keys(NS_DIFF_CLASS_LABEL) as Array<keyof PacingNsDiffCountsV1>)
    .filter((key) => counts[key] > 0)
    .map((key) => {
      const [singular, plural] = NS_DIFF_CLASS_LABEL[key];
      const count = counts[key];
      return `${count} ${count === 1 ? singular : plural}`;
    });
}
