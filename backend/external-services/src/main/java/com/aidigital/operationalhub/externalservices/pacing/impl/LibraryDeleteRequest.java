package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.Map;

/**
 * Shape of the {@code DELETE /api/library/:id} request body.
 *
 * @param updated_at the entry's {@code updatedAt} as last read by the caller (the CAS stamp)
 * @param writer     the fixed v2 writer capability marker, see {@link PacingClientImpl#V2_WRITER}.
 *                   Pacing refuses a library DELETE without it ({@code v2_writer_required})
 */
record LibraryDeleteRequest(String updated_at, Map<String, Object> writer) {
}
