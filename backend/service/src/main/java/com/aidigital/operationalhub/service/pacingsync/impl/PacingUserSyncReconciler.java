package com.aidigital.operationalhub.service.pacingsync.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSyncStats;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncEntry;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.pacingsync.model.PacingUserSyncSummary;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

/**
 * Writes back the {@code pacing_user_id}s Pacing returned, inside a single write transaction.
 *
 * <p>Extracted from {@link PacingUserSyncServiceImpl} (mirroring {@code NetSuiteSyncReconciler}) so the
 * outbound HTTP call to Pacing runs before any database connection is acquired for the write-back:
 * {@link PacingUserSyncServiceImpl#sync()} is non-transactional and delegates here only once Pacing has
 * already answered. Self-invocation of a {@code @Transactional} method on the same bean does not apply
 * the proxy, which is why this is a separate bean rather than a method on the orchestrator.
 *
 * <p>Every write here is local and fast (one {@code UPDATE} per row whose id actually changed) — unlike
 * the call that produced {@code pacingIdsByEmail}, which already happened by the time this runs.
 *
 * <p>Unlike an earlier version of this class, {@code createdInPacing}/{@code activated}/
 * {@code deactivated}/{@code unchanged} are no longer computed here from {@code sentEntries} — that only
 * ever reflected what was SENT (e.g. "sent with active=false", true on every re-run forever), never what
 * actually changed. Only Pacing sees a row's previous state, so those four numbers are taken verbatim
 * from the {@link PacingSyncStats} Pacing returned alongside the id map.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PacingUserSyncReconciler {

	private final HubUserService hubUserService;

	/**
	 * Reconciles the Hub roster against what Pacing returned: writes a new or corrected
	 * {@code pacing_user_id} onto every {@code hub_users} row Pacing answered for, and leaves everything
	 * else untouched. Pacing itself decides create-vs-update and active-vs-inactive; this method only
	 * records what Pacing said, it never re-derives it.
	 *
	 * @param hubUsers         every Hub user considered for this run (preloaded by the caller)
	 * @param sentEntries      the entries actually sent to Pacing (a subset of {@code hubUsers} — see
	 *                         {@link PacingUserSyncServiceImpl#isSyncable})
	 * @param pacingIdsByEmail Pacing's {@code user_id} keyed by email exactly as sent, as returned by
	 *                         {@code PacingClient#syncUsers}
	 * @param stats            Pacing's own account of what the upsert did this run
	 * @return the outcome of this reconcile run
	 */
	@Transactional
	public PacingUserSyncSummary reconcile(
			List<HubUser> hubUsers,
			List<PacingUserSyncEntry> sentEntries,
			Map<String, String> pacingIdsByEmail,
			PacingSyncStats stats) {
		int idsWritten = 0;
		for (HubUser user : hubUsers) {
			String pacingUserId = pacingIdsByEmail.get(user.getEmail());
			if (pacingUserId == null || pacingUserId.equals(user.getPacingUserId())) {
				continue;
			}
			user.setPacingUserId(pacingUserId);
			hubUserService.save(user);
			idsWritten++;
		}

		if (sentEntries.size() < hubUsers.size()) {
			log.warn("Pacing user sync skipped {} of {} Hub users this run (missing email or display name)",
					hubUsers.size() - sentEntries.size(), hubUsers.size());
		}

		return new PacingUserSyncSummary(
				sentEntries.size(), stats.created(), stats.activated(), stats.deactivated(), stats.unchanged(),
				idsWritten);
	}
}
