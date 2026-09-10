package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * Provenance wrapper for a validate line item's target margin, as Pacing's {@code mrg_source} object
 * (§8 of the migration plan, US-124). {@code value} is null wherever {@code access.mrg_by_tactic} has
 * no row for this line item's tactic - a local-database gap in dev/test, not a bug (the reference
 * table is populated in production).
 *
 * @param value the tactic's target margin percentage, or null when the reference table has no row
 */
public record PacingMrgSource(Double value) {
}
