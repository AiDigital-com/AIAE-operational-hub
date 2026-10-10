package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

/**
 * Shape of the mapping-only {@code POST /api/dashboards/:slug/settings} request body - carries
 * {@code mappings_v3} only, for the same reason {@link ThirdPartySettingsRequest} carries only its
 * own key.
 *
 * <p>The entities stay maps: a mapping body is a dimension library with values and aliases, Pacing
 * validates it ({@code safeMappingEntity}), and restating that shape here would be a second copy of
 * a contract that changes with the feature.
 *
 * @param mappingsV3 the whole {@code mappings_v3} list to store, or null to clear it - Pacing reads
 *                   null and an empty list as different things, so a caller must mean the one it
 *                   sends
 */
record MappingsSettingsRequest(@JsonProperty("mappings_v3") List<Map<String, Object>> mappingsV3) {
}
