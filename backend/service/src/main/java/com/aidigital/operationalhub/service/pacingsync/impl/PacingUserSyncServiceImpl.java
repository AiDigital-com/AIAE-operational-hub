package com.aidigital.operationalhub.service.pacingsync.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncResult;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.pacingsync.PacingUserSyncService;
import com.aidigital.operationalhub.service.pacingsync.model.PacingUserSyncSummary;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Default {@link PacingUserSyncService}. Reads the current Hub roster and calls Pacing with no
 * database transaction held, then delegates the write-back to {@link PacingUserSyncReconciler} inside
 * its own transaction — mirroring {@code NetSuiteSyncServiceImpl}, which keeps its slow external read
 * (BigQuery there, Pacing's HTTP call here) outside any transaction and hands the result to a separate
 * reconciler bean for the writes. Self-invocation of a {@code @Transactional} method on this bean would
 * not apply the proxy, which is why the write side lives on a separate bean rather than a private
 * method here.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PacingUserSyncServiceImpl implements PacingUserSyncService {

	private final HubUserService hubUserService;
	private final PacingClient pacingClient;
	private final PacingUserSyncReconciler reconciler;

	/**
	 * Runs a full Pacing user sync: reads every {@code hub_users} row, sends it to Pacing, then
	 * delegates the write-back of returned {@code pacing_user_id}s to {@link PacingUserSyncReconciler}.
	 *
	 * @return the outcome of this sync run
	 */
	@Override
	public PacingUserSyncSummary sync() {
		List<HubUser> hubUsers = hubUserService.findAll();
		List<PacingUserSyncEntry> entries = hubUsers.stream()
				.filter(this::isSyncable)
				.map(this::toEntry)
				.toList();

		PacingUserSyncResult result = pacingClient.syncUsers(entries);

		return reconciler.reconcile(hubUsers, entries, result.users(), result.stats());
	}

	/**
	 * Whether a Hub user has enough data to send to Pacing. Pacing's sync endpoint fails its ENTIRE
	 * batch on one malformed entry (a deliberate design choice on that side: a silently-skipped bad
	 * row would look like a successful sync), so a Hub user missing either field required there —
	 * email or a display name — is skipped here instead of let through to break every other
	 * employee's update this run.
	 *
	 * @param user the Hub user
	 * @return {@code true} when this user has both an email and a display name
	 */
	boolean isSyncable(HubUser user) {
		boolean hasEmail = user.getEmail() != null && !user.getEmail().isBlank();
		boolean hasName = user.getDisplayName() != null && !user.getDisplayName().isBlank();
		if (!hasEmail || !hasName) {
			log.warn("Skipping Hub user in Pacing sync (missing email or display name): userId={}", user.getId());
		}
		return hasEmail && hasName;
	}

	/**
	 * Maps one {@code hub_users} row to the wire shape Pacing's sync endpoint expects. "Active" here
	 * means "the Hub currently considers this person an employee" ({@link HubStatus#ACTIVE}) — the same
	 * status column every other Hub entity (teams, role assignments) uses for exactly this question.
	 *
	 * @param user the Hub user
	 * @return the entry to send to Pacing
	 */
	PacingUserSyncEntry toEntry(HubUser user) {
		boolean active = HubStatus.ACTIVE.getCode().equals(user.getStatus());
		return new PacingUserSyncEntry(user.getEmail(), user.getDisplayName(), active, null);
	}
}
