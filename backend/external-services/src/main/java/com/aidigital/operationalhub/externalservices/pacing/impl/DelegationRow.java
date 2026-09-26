package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * One delegation as Pacing's {@code GET /api/delegations} returns it - {@code SELECT d.*} plus the
 * joined names, so the field names are the column names.
 *
 * @param delegation_id     the grant's id
 * @param delegator_id      who gave the access
 * @param delegator_name    their name
 * @param delegator_email   their email
 * @param delegate_id       who received it
 * @param delegate_name     their name
 * @param delegate_email    their email
 * @param starts_at         when the grant opens
 * @param expires_at        when it closes
 * @param reason            free text, or null
 * @param pacing_id         the scoped pacing, or null for everything the delegator owns
 * @param scope_pacing_name that pacing's name
 * @param scope_dash_slug   that pacing's slug
 * @param pacing_count      how many pacings the delegator owns
 */
@com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
record DelegationRow(
		String delegation_id,
		String delegator_id,
		String delegator_name,
		String delegator_email,
		String delegate_id,
		String delegate_name,
		String delegate_email,
		String starts_at,
		String expires_at,
		String reason,
		String pacing_id,
		String scope_pacing_name,
		String scope_dash_slug,
		Integer pacing_count) {
}
