package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.Map;

/**
 * Shape of the {@code PUT /api/library/:id/visibility} request body.
 *
 * @param visibility {@code private} or {@code team}
 * @param writer     the fixed v2 writer capability marker every library write carries
 */
record LibraryVisibilityRequest(String visibility, Map<String, Object> writer) {
}
