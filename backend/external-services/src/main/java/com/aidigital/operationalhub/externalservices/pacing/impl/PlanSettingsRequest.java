package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/**
 * Shape of the plan-only {@code POST /api/dashboards/:slug/settings} request body (§9,
 * US-125/126/127) - carries {@code line_items} and, optionally, the campaign's {@code rate} and
 * {@code rate_locked}; never {@code display}, so a plan save can never accidentally touch the
 * widget/layout configuration §6's display save owns.
 *
 * <p>The rate rides in this same body on purpose: dash-gate's {@code saveSettings} stores
 * {@code config.rate} BEFORE its per-line-item merge, so the new rate governs the USD
 * re-materialization of every line item and container in this one save. NON_NULL drops both keys
 * when the caller leaves them null, so a plan save that does not touch the rate is byte-identical to
 * one sent before these fields existed.
 *
 * @param line_items  the whole line-item set to persist
 * @param rate        the campaign exchange rate, or null to omit the key
 * @param rate_locked the rate's NetSuite lock, or null to omit the key
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
record PlanSettingsRequest(List<LineItemPlanUpdateRequest> line_items, Double rate, Boolean rate_locked) {
}
