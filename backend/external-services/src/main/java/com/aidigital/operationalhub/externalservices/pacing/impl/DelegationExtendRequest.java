package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * The {@code PATCH /api/delegations/:id} body - only the end date can move.
 *
 * @param expires_at the new end date, date-only and inclusive
 */
record DelegationExtendRequest(String expires_at) {
}
