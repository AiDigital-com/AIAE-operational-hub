package com.aidigital.operationalhub.service.pacingsync;

import com.aidigital.operationalhub.service.pacingsync.model.PacingUserSyncSummary;

/**
 * Synchronizes Hub employees into Pacing's user mirror (§2 of the migration plan). Runs on a schedule
 * and on demand (admin-triggered), the same shape as {@link
 * com.aidigital.operationalhub.service.netsuite.NetSuiteSyncService} for the NetSuite/Rippling sync.
 */
public interface PacingUserSyncService {

	/**
	 * Performs a full, idempotent sync: sends every Hub employee's email, name and active status to
	 * Pacing's {@code POST /api/internal/users/sync}, and writes each returned {@code pacing_user_id}
	 * back onto the matching {@code hub_users} row.
	 *
	 * @return a summary of what was sent and changed
	 */
	PacingUserSyncSummary sync();
}
