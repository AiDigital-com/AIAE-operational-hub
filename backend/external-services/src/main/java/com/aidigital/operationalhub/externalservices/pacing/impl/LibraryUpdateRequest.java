package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.Map;

/**
 * Shape of the {@code PUT /api/library/:id} request body.
 *
 * @param name        entry display name
 * @param description entry description, or null
 * @param definition  the canonical widget definition
 * @param updated_at  the entry's {@code updatedAt} as last read by the caller (the CAS stamp)
 * @param writer      the fixed v2 writer capability marker, see {@link PacingClientImpl#V2_WRITER}.
 *                    Pacing refuses a library PUT without it ({@code v2_writer_required}), as it does a
 *                    POST
 */
record LibraryUpdateRequest(
		String name, String description, Map<String, Object> definition, String updated_at,
		Map<String, Object> writer) {
}
