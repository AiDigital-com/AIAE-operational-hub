package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * One pacing's audience in a {@code POST /api/internal/pacing-audience} batch — the wire shape
 * Pacing's {@code validatePacingAudienceBody} expects, field for field.
 *
 * <p>The emails are the people the Hub's RBAC grants visibility into this pacing (admins, holders of
 * an ALL-scoped role, and the owner's team co-members) — everything Pacing cannot resolve itself
 * since §1 moved the role model out. Pacing stores the list whole (full replacement per pacing) and
 * its ACL sweep UNIONs it with the owner and active delegates it still computes locally.
 *
 * @param pacingId Pacing's {@code pacing_id} (a UUID, as text), serialized as {@code pacing_id}
 * @param emails   the email addresses entitled to this pacing's mirror sheet beyond the owner and
 *                 delegates; an empty list is meaningful ("nobody beyond them") and revokes any
 *                 previously pushed audience on Pacing's next ACL sweep
 */
public record PacingAudienceEntry(
		@JsonProperty("pacing_id") String pacingId,
		List<String> emails) {
}
