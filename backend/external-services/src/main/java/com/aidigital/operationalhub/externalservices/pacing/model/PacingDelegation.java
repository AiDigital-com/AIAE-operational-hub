package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * One delegation in force, as {@code GET /api/delegations} returns it (§12 of the migration plan,
 * US-135).
 *
 * <p>Pacing returns only grants that are neither revoked nor expired, so a row arriving here IS the
 * statement that it is in force right now - there is no status to read and none to compute. An
 * expired grant leaves this list on its own.
 *
 * <p>A delegation covering several pacings is several rows, one per pacing. That is how Pacing
 * stores it, and folding them into one here would make revoking a single pacing's grant
 * unexpressible - each row carries the id the DELETE needs.
 *
 * @param delegationId   the grant's id, and what revoke/extend address
 * @param delegatorId    who gave the access
 * @param delegatorName  their name, as Pacing's user mirror holds it
 * @param delegatorEmail their email
 * @param delegateId     who received it
 * @param delegateName   their name
 * @param delegateEmail  their email
 * @param startsAt       when the grant opens
 * @param expiresAt      when it closes; Pacing reads a date-only value as the end of that day
 * @param reason         free text the delegator typed, or null
 * @param pacingId       the single pacing this grant covers, or null for everything they own
 * @param pacingName     that pacing's name; null on a portfolio-wide grant
 * @param dashSlug       that pacing's slug; null on a portfolio-wide grant
 * @param pacingCount    how many pacings the delegator owns - what "everything I own" is worth, in
 *                       one number
 */
public record PacingDelegation(
		String delegationId,
		String delegatorId,
		String delegatorName,
		String delegatorEmail,
		String delegateId,
		String delegateName,
		String delegateEmail,
		String startsAt,
		String expiresAt,
		String reason,
		String pacingId,
		String pacingName,
		String dashSlug,
		Integer pacingCount) {
}
