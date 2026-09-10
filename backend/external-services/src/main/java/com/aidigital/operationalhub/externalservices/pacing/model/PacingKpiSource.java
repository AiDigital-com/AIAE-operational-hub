package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Provenance wrapper for a validate line item's target CTR/VCR, as Pacing's {@code kpi_source} object
 * (§8 of the migration plan, US-124). Both figures are null wherever {@code access.kpi_by_tactic} has
 * no row for this line item's tactic - a local-database gap in dev/test, not a bug (the reference
 * table is populated in production).
 *
 * @param ctr      the tactic's target CTR percentage, or null
 * @param vcr      the tactic's target VCR percentage, or null
 * @param matchedBy serialized as {@code matched_by} - which reference-table row matched (tactic +
 *                  pricing model, or the tactic default); not surfaced to the UI today, kept for
 *                  parity with Pacing's own shape
 */
public record PacingKpiSource(Double ctr, Double vcr, @JsonProperty("matched_by") String matchedBy) {
}
