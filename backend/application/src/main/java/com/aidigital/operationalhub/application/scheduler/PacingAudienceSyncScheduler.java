package com.aidigital.operationalhub.application.scheduler;

import com.aidigital.operationalhub.service.pacingsync.PacingAudienceSyncService;
import com.aidigital.operationalhub.service.pacingsync.model.PacingAudienceSyncSummary;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Triggers the daily Pacing audience push: for every pacing, the emails Hub RBAC entitles to open it
 * (admins, ALL-scoped roles, the owner's team co-members), pushed to Pacing so its mirror Google
 * Sheets stay shared with the same people who can see the pacing in the app. Guarded by a
 * {@code hub_sync_lock} row ({@link SyncLockGuard}) with its own lock name so only one node in a
 * multi-node deployment executes a given firing — the same mechanism {@link PacingUserSyncScheduler}
 * uses.
 */
@Component
@RequiredArgsConstructor
public class PacingAudienceSyncScheduler {

	private static final Logger LOG = LoggerFactory.getLogger(PacingAudienceSyncScheduler.class);

	/**
	 * Fixed lock name unique to the daily Pacing audience push, seeded on first use by
	 * {@code HubSyncLockServiceImpl.tryAcquire} (no Liquibase seed row needed — that call is
	 * {@code INSERT ... ON CONFLICT DO NOTHING}).
	 */
	private static final String SYNC_LOCK_NAME = "pacing_audience_sync";

	private final PacingAudienceSyncService pacingAudienceSyncService;
	private final SyncLockGuard syncLockGuard;

	/**
	 * Runs the audience push daily at 01:45, 15 minutes after the Pacing user sync
	 * ({@link PacingUserSyncScheduler}, {@code 0 30 1 * * *}). That offset is an implicit ordering
	 * dependency, not a coincidence: the push names owners by {@code hub_users.pacing_user_id}, which
	 * the 01:30 user sync is what populates and corrects — running before it would resolve today's new
	 * hires as unknown owners and push audiences one roster behind. If the user sync's schedule ever
	 * moves later than :45, this one must move with it (the same chain already binds the user sync to
	 * the 01:00 NetSuite sync).
	 */
	@Scheduled(cron = "0 45 1 * * *")
	public void syncDaily() {
		syncLockGuard.runIfLockAcquired(SYNC_LOCK_NAME, "Pacing audience push", this::runSync);
	}

	/**
	 * Runs the push and logs its outcome. Failures are logged and swallowed so a transient Pacing
	 * failure does not stop the scheduler from firing again the next day — Pacing's ACL sweep simply
	 * keeps applying the previous day's lists until a push succeeds.
	 */
	void runSync() {
		LOG.info("Starting scheduled Pacing audience push");
		try {
			PacingAudienceSyncSummary summary = pacingAudienceSyncService.sync();
			LOG.info(
					"Scheduled Pacing audience push finished: pacingsSent={}, created={}, replaced={}, "
							+ "unknown={}, ownersUnresolved={}",
					summary.pacingsSent(),
					summary.created(),
					summary.replaced(),
					summary.unknown(),
					summary.ownersUnresolved());
		} catch (RuntimeException e) {
			LOG.error("Scheduled Pacing audience push failed", e);
		}
	}
}
