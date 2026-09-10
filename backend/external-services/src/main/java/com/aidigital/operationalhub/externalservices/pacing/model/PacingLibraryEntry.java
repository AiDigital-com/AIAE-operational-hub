package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/**
 * One entry of Pacing's shared widget/block/layout library (§6 of the migration plan, US-116/US-118),
 * as {@code GET/POST/PUT /api/library[...]} return it. Restricted to the fields the Hub surfaces;
 * Pacing's real row also carries {@code owner_id} and {@code deleted_at}, neither of which the Hub
 * needs (owner identity is exposed as {@code ownerName} only; a deleted entry is simply absent from a
 * list response).
 *
 * @param id          entry id (Pacing's UUID primary key)
 * @param kind        {@code widget} | {@code block} | {@code layout}
 * @param name        entry display name
 * @param description entry description, may be null
 * @param definition  the canonical widget/block/layout definition, opaque
 * @param ownerName   serialized as {@code owner_name}
 * @param createdAt   serialized as {@code created_at}
 * @param updatedAt   serialized as {@code updated_at}; the optimistic-concurrency stamp a later
 *                    update/delete must echo back as {@code expectedUpdatedAt}
 * @param likes       total like count
 * @param liked       whether the calling user has liked this entry
 * @param mine        whether the calling user owns this entry
 * @param usage       number of pacings currently referencing this entry
 */
public record PacingLibraryEntry(
		String id,
		String kind,
		String name,
		String description,
		Map<String, Object> definition,
		@JsonProperty("owner_name") String ownerName,
		@JsonProperty("created_at") String createdAt,
		@JsonProperty("updated_at") String updatedAt,
		int likes,
		boolean liked,
		boolean mine,
		int usage) {
}
