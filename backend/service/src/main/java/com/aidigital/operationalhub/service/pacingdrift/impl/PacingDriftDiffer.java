package com.aidigital.operationalhub.service.pacingdrift.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserMirrorEntry;
import com.aidigital.operationalhub.service.pacingdrift.model.PacingDriftCategory;
import com.aidigital.operationalhub.service.pacingdrift.model.PacingDriftRow;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Pure diffing logic for the US-106 drift report (§2 of the migration plan), kept separate from {@link
 * PacingDriftServiceImpl} so it is unit-testable without a network call — mirroring how {@code
 * PacingUserSyncReconciler} keeps its diffing logic separate from its own orchestrator.
 *
 * <p>Matches by email, case-insensitively (both sides already treat email as their natural join key —
 * see Pacing's {@code users_email_lower_key} and the Hub's {@code uq_hub_users_email_lower}). A Hub user
 * with no email cannot be matched against anything and is skipped: there is no key to diff on.
 */
@Component
public class PacingDriftDiffer {

	/**
	 * Diffs the given Hub roster against the given Pacing user mirror.
	 *
	 * @param hubUsers    every Hub user considered (preloaded by the caller)
	 * @param pacingUsers every row of Pacing's user mirror (preloaded by the caller)
	 * @return one row per disagreement found; empty when both sides fully agree
	 */
	public List<PacingDriftRow> diff(List<HubUser> hubUsers, List<PacingUserMirrorEntry> pacingUsers) {
		Map<String, HubUser> hubByLowerEmail = new LinkedHashMap<>();
		for (HubUser user : hubUsers) {
			if (user.getEmail() != null && !user.getEmail().isBlank()) {
				hubByLowerEmail.putIfAbsent(user.getEmail().toLowerCase(), user);
			}
		}
		Map<String, PacingUserMirrorEntry> pacingByLowerEmail = new LinkedHashMap<>();
		for (PacingUserMirrorEntry entry : pacingUsers) {
			pacingByLowerEmail.putIfAbsent(entry.email().toLowerCase(), entry);
		}

		Set<String> allLowerEmails = new LinkedHashSet<>(hubByLowerEmail.keySet());
		allLowerEmails.addAll(pacingByLowerEmail.keySet());

		List<PacingDriftRow> rows = new ArrayList<>();
		for (String lowerEmail : allLowerEmails) {
			HubUser hubUser = hubByLowerEmail.get(lowerEmail);
			PacingUserMirrorEntry pacingUser = pacingByLowerEmail.get(lowerEmail);

			if (hubUser == null) {
				rows.add(new PacingDriftRow(
						pacingUser.email(), PacingDriftCategory.MISSING_IN_HUB,
						null, pacingUser.name(), null, pacingUser.active()));
				continue;
			}
			if (pacingUser == null) {
				rows.add(new PacingDriftRow(
						hubUser.getEmail(), PacingDriftCategory.MISSING_IN_PACING,
						hubUser.getDisplayName(), null, isActive(hubUser), null));
				continue;
			}

			boolean hubActive = isActive(hubUser);
			String hubName = hubUser.getDisplayName() == null ? "" : hubUser.getDisplayName().trim();
			String pacingName = pacingUser.name() == null ? "" : pacingUser.name().trim();
			if (!hubName.equals(pacingName)) {
				rows.add(new PacingDriftRow(
						hubUser.getEmail(), PacingDriftCategory.NAME_MISMATCH,
						hubUser.getDisplayName(), pacingUser.name(), hubActive, pacingUser.active()));
			}
			if (hubActive != pacingUser.active()) {
				rows.add(new PacingDriftRow(
						hubUser.getEmail(), PacingDriftCategory.ACTIVE_MISMATCH,
						hubUser.getDisplayName(), pacingUser.name(), hubActive, pacingUser.active()));
			}
		}
		return rows;
	}

	private boolean isActive(HubUser user) {
		return HubStatus.ACTIVE.getCode().equals(user.getStatus());
	}
}
