package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Shape of the {@code DELETE /api/library/:id} request body.
 *
 * @param updated_at the entry's {@code updatedAt} as last read by the caller (the CAS stamp)
 */
record LibraryDeleteRequest(String updated_at) {
}
