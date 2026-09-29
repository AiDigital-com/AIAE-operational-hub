package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One row of Pacing's {@code GET /api/internal/pacings} response: a pacing and who owns it — the
 * minimal read that lets the audience push ({@code POST /api/internal/pacing-audience}) be keyed by
 * pacing id. Internal (system-assertion) on purpose: the push runs from a scheduler with no acting
 * user, so it cannot call the per-user {@code GET /api/pacings}.
 *
 * @param pacingId Pacing's {@code pacing_id} (a UUID, as text), serialized as {@code pacing_id}
 * @param ownerId  the owner's Pacing {@code user_id} (a UUID, as text), serialized as
 *                 {@code owner_id} — the same identifier {@code hub_users.pacing_user_id} carries
 *                 after the §2 sync; {@code null} for an ownerless pacing, which still gets a
 *                 globals-only audience (admins and ALL-scoped roles see every pacing)
 */
public record PacingOwnerEntry(
		@JsonProperty("pacing_id") String pacingId,
		@JsonProperty("owner_id") String ownerId) {
}
