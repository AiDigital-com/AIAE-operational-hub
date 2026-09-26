package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Shape of the {@code PATCH /api/pacings/:id/owner} request body (§11, US-131). Snake_case on the
 * wire: Pacing reads {@code body.new_owner_id}.
 *
 * @param new_owner_id the recipient's Pacing user id (UUID)
 */
record OwnerTransferRequest(String new_owner_id) {
}
