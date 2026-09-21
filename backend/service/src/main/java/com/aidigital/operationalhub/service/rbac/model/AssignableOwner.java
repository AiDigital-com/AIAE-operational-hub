package com.aidigital.operationalhub.service.rbac.model;

/**
 * One person the current user may hand a pacing to (§11 of the migration plan, US-131).
 *
 * @param pacingUserId this person's id in PACING, not the Hub — the value Pacing's
 *                     {@code PATCH /api/pacings/:id/owner} expects. Never null: somebody the §2 sync
 *                     has not reached has no Pacing identity, so they cannot be named to Pacing at
 *                     all and are left out of the list rather than offered and then refused.
 * @param name         display name, as the Hub knows it
 * @param email        work email, to tell apart two colleagues who share a name — and this
 *                     organisation has fourteen people called Daria
 */
public record AssignableOwner(String pacingUserId, String name, String email) {
}
