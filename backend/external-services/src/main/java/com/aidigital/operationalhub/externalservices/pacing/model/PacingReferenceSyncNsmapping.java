package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * Rows written to the four Namebuilder lookup tables by a reference-data sync.
 *
 * @param agencies   agency full name -> short code
 * @param industries industry name -> code
 * @param dropdowns  channel and tactic option lists
 * @param overrides  line items forced to the "Other" industry code
 */
public record PacingReferenceSyncNsmapping(
		int agencies,
		int industries,
		int dropdowns,
		int overrides) {
}
