package com.aidigital.operationalhub.application.scheduler;

import com.aidigital.operationalhub.service.netsuite.NetSuiteSyncService;
import com.aidigital.operationalhub.service.netsuite.model.SyncSummary;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Triggers the NetSuite/Rippling sync on a daily schedule.
 *
 * <p>The eager, admin-triggered counterpart lives behind {@code POST /api/v1/sync}; this component
 * runs the same {@link NetSuiteSyncService#sync()} unattended at 01:00 every day. Scheduling is
 * enabled by {@code @EnableScheduling} on the application entry point. Guarded by a {@code hub_sync_lock}
 * row ({@link SyncLockGuard}) so only one node in a multi-node deployment executes a given firing.
 */
@Component
@RequiredArgsConstructor
public class NetSuiteSyncScheduler {

	private static final Logger LOG = LoggerFactory.getLogger(NetSuiteSyncScheduler.class);

	/**
	 * Fixed lock name unique to the daily NetSuite/Rippling sync, seeded as a row in
	 * {@code hub_sync_lock}.
	 */
	private static final String SYNC_LOCK_NAME = "netsuite_sync";

	private final NetSuiteSyncService netSuiteSyncService;
	private final SyncLockGuard syncLockGuard;

	/**
	 * Runs the NetSuite/Rippling sync daily at 01:00, guarded so only one node executes a given firing.
	 */
	@Scheduled(cron = "0 0 1 * * *")
	public void syncDaily() {
		syncLockGuard.runIfLockAcquired(SYNC_LOCK_NAME, "NetSuite/Rippling sync", this::runSync);
	}

	/**
	 * Runs the sync and logs its outcome. Failures are logged and swallowed so a transient BigQuery
	 * error does not stop the scheduler from firing again the next day.
	 */
	void runSync() {
		LOG.info("Starting scheduled BQ NetSuite/Rippling sync");
		try {
			SyncSummary summary = netSuiteSyncService.sync();
			LOG.info(
					"Scheduled BQ NetSuite/Rippling sync finished: teams={}, users={}, assignmentsUpdated={}, "
							+ "agenciesMapped={}",
					summary.teams(),
					summary.users(),
					summary.assignmentsUpdated(),
					summary.agenciesMapped());
		} catch (RuntimeException e) {
			LOG.error("Scheduled BQ NetSuite/Rippling sync failed", e);
		}
	}
}
