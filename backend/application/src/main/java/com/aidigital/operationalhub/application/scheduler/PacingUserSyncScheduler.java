package com.aidigital.operationalhub.application.scheduler;

import com.aidigital.operationalhub.service.pacingsync.PacingUserSyncService;
import com.aidigital.operationalhub.service.pacingsync.model.PacingUserSyncSummary;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Triggers the Pacing user sync on a daily schedule (§2 of the migration plan).
 *
 * <p>The eager, admin-triggered counterpart lives behind {@code POST /api/v1/sync/pacing-users}; this
 * component runs the same {@link PacingUserSyncService#sync()} unattended once a day. Scheduling is
 * enabled by {@code @EnableScheduling} on the application entry point. Guarded by a
 * {@code hub_sync_lock} row ({@link SyncLockGuard}) so only one node in a multi-node deployment
 * executes a given firing — the same mechanism {@link NetSuiteSyncScheduler} uses, with its own lock
 * name.
 */
@Component
@RequiredArgsConstructor
public class PacingUserSyncScheduler {

	private static final Logger LOG = LoggerFactory.getLogger(PacingUserSyncScheduler.class);

	/**
	 * Fixed lock name unique to the daily Pacing user sync, seeded on first use by
	 * {@code HubSyncLockServiceImpl.tryAcquire} (no Liquibase seed row needed — that call is
	 * {@code INSERT ... ON CONFLICT DO NOTHING}).
	 */
	private static final String SYNC_LOCK_NAME = "pacing_user_sync";

	private final PacingUserSyncService pacingUserSyncService;
	private final SyncLockGuard syncLockGuard;

	/**
	 * Runs the Pacing user sync daily at 01:30, 30 minutes after the NetSuite/Rippling sync
	 * ({@code NetSuiteSyncScheduler}, {@code 0 0 1 * * *}). That offset is an implicit ordering
	 * dependency, not a coincidence: the NetSuite sync is what keeps {@code hub_users} current (new
	 * hires, name changes, org moves) for the day, so this sync must run after it finishes, or it
	 * pushes yesterday's roster to Pacing instead of today's. If the NetSuite sync's schedule ever moves
	 * later than :30, this one must move with it.
	 */
	@Scheduled(cron = "0 30 1 * * *")
	public void syncDaily() {
		syncLockGuard.runIfLockAcquired(SYNC_LOCK_NAME, "Pacing user sync", this::runSync);
	}

	/**
	 * Runs the sync and logs its outcome. Failures are logged and swallowed so a transient Pacing
	 * failure does not stop the scheduler from firing again the next day.
	 */
	void runSync() {
		LOG.info("Starting scheduled Pacing user sync");
		try {
			PacingUserSyncSummary summary = pacingUserSyncService.sync();
			LOG.info(
					"Scheduled Pacing user sync finished: usersSent={}, createdInPacing={}, activated={}, "
							+ "deactivated={}, unchanged={}, idsWritten={}",
					summary.usersSent(),
					summary.createdInPacing(),
					summary.activated(),
					summary.deactivated(),
					summary.unchanged(),
					summary.idsWritten());
		} catch (RuntimeException e) {
			LOG.error("Scheduled Pacing user sync failed", e);
		}
	}
}
