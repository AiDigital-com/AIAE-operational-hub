package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Shape of the {@code POST /api/internal/pacings/:id/owner} request body. Snake_case on the wire.
 *
 * @param new_owner_id the recipient's Pacing user id (UUID)
 * @param actor_email  the Hub user doing it, as Pacing journals them
 */
record SystemOwnerTransferRequest(String new_owner_id, String actor_email) {
}
