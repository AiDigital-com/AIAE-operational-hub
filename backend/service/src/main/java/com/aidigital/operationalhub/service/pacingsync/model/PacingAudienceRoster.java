package com.aidigital.operationalhub.service.pacingsync.model;

import java.util.List;
import java.util.Map;

/**
 * The Hub-RBAC audience material for one push run, resolved in a single transactional read (see
 * {@code PacingAudienceResolver}) so the push itself can run with no database transaction held
 * across the HTTP calls.
 *
 * @param globalEmails                    emails of active employees who see every pacing: holders of
 *                                        an active ADMIN role or any ALL-scoped assignment (how
 *                                        DIRECTOR is provisioned)
 * @param teamViewerEmailsByOwnerPacingId emails of active employees who see a given owner's pacings
 *                                        through TEAM-scoped assignments, keyed by the owner's
 *                                        Pacing {@code user_id} ({@code hub_users.pacing_user_id});
 *                                        an owner with no team simply has no entry
 */
public record PacingAudienceRoster(
		List<String> globalEmails,
		Map<String, List<String>> teamViewerEmailsByOwnerPacingId) {
}
