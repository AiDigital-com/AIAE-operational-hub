package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.Map;

/**
 * Shape of the {@code PUT /api/library/:id} request body.
 *
 * @param name        entry display name
 * @param description entry description, or null
 * @param definition  the canonical widget definition
 * @param updated_at  the entry's {@code updatedAt} as last read by the caller (the CAS stamp)
 */
record LibraryUpdateRequest(
		String name, String description, Map<String, Object> definition, String updated_at) {
}
