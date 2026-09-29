package com.aidigital.operationalhub.service.pacingsync.impl;

import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAudienceEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAudiencePushResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingOwnerEntry;
import com.aidigital.operationalhub.service.pacingsync.PacingAudienceSyncService;
import com.aidigital.operationalhub.service.pacingsync.model.PacingAudienceRoster;
import com.aidigital.operationalhub.service.pacingsync.model.PacingAudienceSyncSummary;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

/**
 * Default {@link PacingAudienceSyncService}. Reads Pacing's pacing/owner list and the Hub RBAC
 * roster, then pushes one audience list per pacing — with no database transaction held across either
 * HTTP call: the transactional read lives on {@link PacingAudienceResolver} (its own bean, so the
 * proxy applies), mirroring the {@code PacingUserSyncServiceImpl}/{@code PacingUserSyncReconciler}
 * split.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PacingAudienceSyncServiceImpl implements PacingAudienceSyncService {

	private final PacingClient pacingClient;
	private final PacingAudienceResolver resolver;

	@Override
	public PacingAudienceSyncSummary sync() {
		List<PacingOwnerEntry> pacings = pacingClient.listPacingOwners();
		if (pacings.isEmpty()) {
			return new PacingAudienceSyncSummary(0, 0, 0, 0, 0);
		}
		PacingAudienceRoster roster = resolver.resolve();

		int ownersUnresolved = 0;
		List<PacingAudienceEntry> entries = new ArrayList<>(pacings.size());
		for (PacingOwnerEntry pacing : pacings) {
			List<String> teamViewers = pacing.ownerId() == null
					? null
					: roster.teamViewerEmailsByOwnerPacingId().get(pacing.ownerId());
			if (pacing.ownerId() != null && teamViewers == null) {
				// The owner's Pacing user_id matches no hub_users.pacing_user_id: the §2 user sync has
				// not linked this person yet (or the owner row predates the Hub). The pacing still gets
				// its globals-only audience below - admins and ALL-scoped roles see every pacing
				// regardless of owner - but the team leg is unresolvable, which is worth counting.
				ownersUnresolved++;
			}
			// Every pacing is pushed, even with an empty list: full-replacement semantics are what let
			// a Hub-side revocation (role removed, team change, employee deactivated) land as the
			// email's absence in the next push.
			TreeSet<String> emails = new TreeSet<>(roster.globalEmails());
			if (teamViewers != null) {
				emails.addAll(teamViewers);
			}
			entries.add(new PacingAudienceEntry(pacing.pacingId(), List.copyOf(emails)));
		}

		PacingAudiencePushResult result = pacingClient.pushPacingAudience(entries);
		if (!result.unknownPacingIds().isEmpty()) {
			log.warn(
					"Pacing audience push: {} pacing id(s) unknown on the Pacing side (roster drift): {}",
					result.unknownPacingIds().size(),
					result.unknownPacingIds());
		}
		return new PacingAudienceSyncSummary(
				entries.size(),
				result.stats().created(),
				result.stats().replaced(),
				result.stats().unknown(),
				ownersUnresolved);
	}
}
