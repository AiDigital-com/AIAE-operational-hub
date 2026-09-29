package com.aidigital.operationalhub.service.pacingsync.impl;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.pacingsync.model.PacingAudienceRoster;
import com.aidigital.operationalhub.service.rbac.enums.RbacRoleCode;
import com.aidigital.operationalhub.service.rbac.enums.RbacScopeCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Resolves the RBAC half of the Pacing audience push: who sees every pacing (globals), and who sees
 * a given owner's pacings through team co-membership.
 *
 * <p>This is {@link com.aidigital.operationalhub.service.rbac.PacingScopeResolver} run in reverse.
 * The forward resolver answers "which owners may user X see": ADMIN or any ALL-scoped assignment →
 * everyone; TEAM-scoped assignments on teams {T} → every holder of an active assignment scoped to
 * any T. Inverting it: a pacing owned by O is visible to every global viewer, plus every holder of a
 * TEAM-scoped assignment on any team where O also holds an active TEAM-scoped assignment. Client
 * Services contributes nobody, exactly as the forward resolver entitles it to nothing (its campaign
 * scoping has no Hub-side id source yet — see the forward resolver's comment). Keeping both
 * directions derived from the same assignment rows is what keeps sheet access aligned with app
 * access.
 *
 * <p>A separate bean from the sync service so the whole read runs inside one read-only transaction
 * (lazy {@code role}/{@code scopeType} associations resolve here, never outside a session) while the
 * sync service holds NO transaction across its Pacing HTTP calls — the same split as
 * {@code PacingUserSyncServiceImpl} / {@code PacingUserSyncReconciler}, for the same
 * no-transaction-across-slow-I/O rule.
 *
 * <p>Only ACTIVE employees with a non-blank email are ever emitted: these lists become Google Drive
 * grants on the mirror sheets, and a departed employee must fall out of them on the next push.
 */
@Component
@RequiredArgsConstructor
public class PacingAudienceResolver {

	private final HubUserService hubUserService;
	private final HubRoleAssignmentService hubRoleAssignmentService;

	/**
	 * Resolves the current audience roster from the Hub's users and active role assignments.
	 *
	 * <p>The returned map holds an entry for EVERY employee with a {@code pacing_user_id} (empty when
	 * they have no team viewers), so the caller can tell "known owner with no team" apart from "owner
	 * id the Hub does not know at all" — the latter is a §2-sync gap worth logging.
	 *
	 * @return the roster: global viewer emails plus team-viewer emails keyed by owner pacing user id
	 */
	@Transactional(readOnly = true)
	public PacingAudienceRoster resolve() {
		List<HubUser> users = hubUserService.findAll();
		Map<Long, HubUser> activeById = new HashMap<>();
		for (HubUser user : users) {
			boolean active = HubStatus.ACTIVE.getCode().equals(user.getStatus());
			boolean hasEmail = user.getEmail() != null && !user.getEmail().isBlank();
			if (active && hasEmail) {
				activeById.put(user.getId(), user);
			}
		}

		Set<String> globalEmails = new TreeSet<>();
		Map<Long, Set<Long>> memberIdsByTeamId = new HashMap<>();
		Map<Long, Set<Long>> teamIdsByUserId = new HashMap<>();
		for (HubRoleAssignment assignment : hubRoleAssignmentService.findAllActive()) {
			String roleCode = assignment.getRole() == null ? null : assignment.getRole().getRoleCode();
			String scopeCode =
					assignment.getScopeType() == null ? null : assignment.getScopeType().getScopeCode();
			boolean global = RbacRoleCode.ADMIN.getCode().equals(roleCode)
					|| RbacScopeCode.ALL.getCode().equals(scopeCode);
			if (global) {
				HubUser holder = activeById.get(assignment.getUserId());
				if (holder != null) {
					globalEmails.add(holder.getEmail());
				}
			}
			if (RbacScopeCode.TEAM.getCode().equals(scopeCode) && assignment.getScopeId() != null) {
				memberIdsByTeamId
						.computeIfAbsent(assignment.getScopeId(), teamId -> new HashSet<>())
						.add(assignment.getUserId());
				teamIdsByUserId
						.computeIfAbsent(assignment.getUserId(), userId -> new HashSet<>())
						.add(assignment.getScopeId());
			}
		}

		Map<String, List<String>> teamViewersByOwner = new HashMap<>();
		for (HubUser owner : users) {
			if (owner.getPacingUserId() == null) {
				continue;
			}
			Set<String> viewerEmails = new TreeSet<>();
			for (Long teamId : teamIdsByUserId.getOrDefault(owner.getId(), Set.of())) {
				for (Long memberId : memberIdsByTeamId.getOrDefault(teamId, Set.of())) {
					HubUser member = activeById.get(memberId);
					if (member != null) {
						viewerEmails.add(member.getEmail());
					}
				}
			}
			teamViewersByOwner.put(owner.getPacingUserId(), List.copyOf(viewerEmails));
		}

		return new PacingAudienceRoster(List.copyOf(globalEmails), Map.copyOf(teamViewersByOwner));
	}
}
