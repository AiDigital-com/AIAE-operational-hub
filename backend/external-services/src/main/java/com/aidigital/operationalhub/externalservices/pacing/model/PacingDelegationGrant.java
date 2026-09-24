package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.List;

/**
 * A delegation to grant (§12 of the migration plan, US-133/134).
 *
 * <p>The rules - at most 30 days, no delegating to yourself, no start in the past, at most 50
 * pacings, and every pacing owned by the delegator - live in Pacing, as database constraints and
 * endpoint checks. They are deliberately not re-stated on this side: a second copy of a rule is a
 * rule that will eventually disagree with itself, and the one that governs access should be the one
 * the database enforces. A date picker bounded at 30 days is still worth having, so the refusal is
 * rare rather than routine - but it is a courtesy, not the gate.
 *
 * @param delegateId who receives the access - a person's Pacing user id
 * @param startsAt   date-only (YYYY-MM-DD), or null for "now"
 * @param expiresAt  date-only and INCLUSIVE - Pacing reads it as the end of that day
 * @param reason     free text, or null
 * @param pacingIds  the pacings to scope the grant to; empty or null grants everything the
 *                   delegator owns, which is a different and much larger promise
 */
public record PacingDelegationGrant(
		String delegateId,
		String startsAt,
		String expiresAt,
		String reason,
		List<String> pacingIds) {
}
