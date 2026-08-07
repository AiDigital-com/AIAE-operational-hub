package com.aidigital.operationalhub.service.netsuite;

import com.aidigital.operationalhub.service.netsuite.model.SyncSummary;

/**
 * Synchronizes Hub users, teams, and team role assignments from the NetSuite/Rippling BigQuery
 * sources. Runs on a schedule and on demand (admin-triggered).
 */
public interface NetSuiteSyncService {

	/**
	 * Performs a full, idempotent sync: ensures a team per Rippling department, upserts a Hub user per
	 * active employee, and reconciles each user's single team role assignment (team leads get
	 * {@code TL}, everyone else {@code MPO_MANAGER}).
	 *
	 * @return a summary of what was touched
	 */
	SyncSummary sync();
}
