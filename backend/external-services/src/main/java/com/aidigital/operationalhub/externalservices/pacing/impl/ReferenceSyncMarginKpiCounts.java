package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Rows the Margin+KPI half wrote - the two tables the create screen pre-fills from.
 *
 * @param margin target margin rows, by tactic
 * @param kpi    target CTR/VCR rows, by tactic and pricing model
 */
record ReferenceSyncMarginKpiCounts(
		Integer margin,
		Integer kpi) {
}
