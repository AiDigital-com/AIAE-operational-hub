package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Rows the NSMapping half wrote, as dash-gate reports them.
 *
 * @param agencies   agency full name -> short code
 * @param industries industry name -> code
 * @param dropdowns  channel and tactic option lists
 * @param overrides  line items forced to the "Other" industry code
 */
record ReferenceSyncNsmappingCounts(
		Integer agencies,
		Integer industries,
		Integer dropdowns,
		Integer overrides) {
}
