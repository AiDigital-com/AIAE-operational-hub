package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.Map;

/**
 * Wire shape of {@code POST /api/internal/users/sync}'s response.
 *
 * <p>DEVIATION FROM THE MIGRATION PLAN: §2 of the plan describes this endpoint as returning a bare
 * {@code { email -> user_id }} map. Pacing now wraps that map alongside {@link PacingSyncStats}, since
 * only Pacing can answer "what actually changed" (see {@link PacingSyncStats}'s Javadoc). Kept as two
 * fields rather than flattened so the id map keeps exactly its original shape.
 *
 * @param users Pacing's {@code user_id} (a UUID, as text) keyed by email exactly as sent; an email
 *              Pacing did not return a mapping for is simply absent from the map
 * @param stats what the upsert actually did, computed by Pacing from the previous row state
 */
public record PacingUserSyncResult(Map<String, String> users, PacingSyncStats stats) {
}
