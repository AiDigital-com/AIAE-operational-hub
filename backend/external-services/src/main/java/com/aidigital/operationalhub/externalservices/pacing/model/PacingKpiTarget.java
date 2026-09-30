package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * One KPI target on a line item's health entry, as Pacing builds it from the pacing's own notify
 * config ({@code dash-gate/lib/health.mjs}) — the Overview's KPI sparkline colors by
 * {@code value / tgt} against {@code low}/{@code high}; the Hub evaluates no threshold itself.
 *
 * <p>Already camelCase-free on the wire (single words), so no renames are needed.
 *
 * @param type KPI kind: {@code CTR}, {@code VCR}, or {@code ACR} (audio completion rate — same
 *             completes-over-impressions series as VCR)
 * @param tgt  target percentage, or null on the placeholder entry Pacing sends for a line item with
 *             no KPI target at all
 * @param low  lower band bound as a ratio of target (e.g. 0.7); null when that side is disabled in
 *             the pacing's alert config
 * @param high upper band bound as a ratio of target; null when disabled
 */
public record PacingKpiTarget(
		String type,
		Double tgt,
		Double low,
		Double high) {
}
