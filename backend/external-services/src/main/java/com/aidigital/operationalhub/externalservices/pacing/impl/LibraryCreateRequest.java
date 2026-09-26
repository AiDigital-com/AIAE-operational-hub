package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.Map;

/**
 * Shape of the {@code POST /api/library} request body.
 *
 * @param kind        {@code widget}, {@code block} or {@code layout}
 * @param name        entry display name
 * @param description entry description, or null
 * @param definition  the canonical widget/block/layout definition
 * @param writer      the fixed v2 writer capability marker, see {@link PacingClientImpl#V2_WRITER}
 */
record LibraryCreateRequest(
		String kind, String name, String description, Map<String, Object> definition, Map<String, Object> writer) {
}
