package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.List;

/**
 * The {@code POST /api/delegations} body.
 *
 * <p>NON_NULL for {@link LineItemPlanUpdateRequest}'s reason: Pacing reads an ABSENT
 * {@code starts_at} as "now" and an absent {@code pacing_ids} as "everything I own", and both of
 * those are decisions - sending them as explicit nulls would have Pacing parse a null date and
 * scope a grant to nothing.
 *
 * @param delegate_id who receives the access
 * @param starts_at   date-only, or absent for now
 * @param expires_at  date-only and inclusive
 * @param reason      free text, or absent
 * @param pacing_ids  the scoped pacings, or absent for everything the delegator owns
 */
@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
record DelegationCreateRequest(
		String delegate_id,
		String starts_at,
		String expires_at,
		String reason,
		List<String> pacing_ids) {
}
