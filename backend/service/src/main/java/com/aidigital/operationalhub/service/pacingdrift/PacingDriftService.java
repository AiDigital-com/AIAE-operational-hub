package com.aidigital.operationalhub.service.pacingdrift;

import com.aidigital.operationalhub.service.pacingdrift.model.PacingDriftReport;

/**
 * Compares the Hub roster against Pacing's user mirror and reports where they disagree (US-106, §2 of
 * the migration plan). Read-only: unlike {@code PacingUserSyncService}, this never writes to either
 * side — it exists so a gap the sync itself cannot close (a Pacing row the sync never visits because no
 * Hub employee shares its email) is visible to an admin instead of sitting unnoticed.
 */
public interface PacingDriftService {

	/**
	 * Fetches both sides fresh and diffs them.
	 *
	 * @return the drift report for this moment
	 */
	PacingDriftReport getDrift();
}
