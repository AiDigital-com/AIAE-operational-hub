package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * Rows written to the two tables the create screen pre-fills a new pacing's plan from.
 *
 * <p>A zero in either is the failure worth seeing: it means the next pacing created will take the
 * create screen's fallback margin and zero KPI targets, and nothing later repairs that - the
 * tables feed the pre-fill, never a pacing that already exists.
 *
 * @param margin target margin rows, by tactic
 * @param kpi    target CTR/VCR rows, by tactic and pricing model
 */
public record PacingReferenceSyncMarginKpi(
		int margin,
		int kpi) {
}
