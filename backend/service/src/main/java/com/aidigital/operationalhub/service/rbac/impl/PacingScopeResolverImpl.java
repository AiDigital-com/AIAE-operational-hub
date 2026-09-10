package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.enums.RbacRoleCode;
import com.aidigital.operationalhub.service.rbac.enums.RbacScopeCode;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import com.aidigital.operationalhub.service.rbac.model.RoleAssignmentModel;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * Default {@link PacingScopeResolver}. Reads the user's effective access (the same source
 * {@link AgencyVisibilityServiceImpl} reads) and translates it into a {@link PacingEntitlement}.
 *
 * <p>Not cached, unlike {@link AgencyVisibilityServiceImpl}'s {@code AgencyVisibility}: caching an
 * entitlement without also wiring its invalidation into every place a role assignment changes (see
 * {@code HubCacheNamesByClassRegistry}) risks a user keeping wider Pacing access than their current
 * roles grant, which is the one mistake this resolver exists to avoid. Correctness first; revisit
 * caching once eviction can be wired in with the same care as {@code AGENCY_VISIBILITY_CACHE}.
 *
 * <p><b>Why Pacing {@code user_id}s and not emails.</b> The {@code owners} scope's ids used to be
 * email addresses — a deliberate, temporary deviation, because §1 (this resolver) shipped before §2
 * (the employee sync) existed to populate an id to name a person by. Now that §2 has run and every
 * synced Hub employee carries a {@code pacing_user_id}, this resolver follows the migration plan's
 * actual wording ({@code owner_id = ANY($1)}, a flat filter over Pacing's uuid column) and emits those
 * ids instead. UUIDs are also the more durable identifier of the two: an email address changes with a
 * surname or a domain migration; a {@code user_id} never does.
 *
 * <p><b>Deploy order.</b> This only works once {@code hub_users.pacing_user_id} is populated — i.e.
 * after the §2 sync ({@code PacingUserSyncService}) has run at least once in the target environment.
 * Deploying this resolver before that sync has run resolves every {@code owners} scope to an empty id
 * list, so nobody sees anything until the sync catches up. See {@code docs/local-development.md} in
 * the Pacing repo for the matching note on the id-shape contract itself.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PacingScopeResolverImpl implements PacingScopeResolver {

	private final RbacQueryService rbacQueryService;
	private final HubRoleAssignmentService hubRoleAssignmentService;
	private final HubUserService hubUserService;

	@Override
	public PacingEntitlement resolveForCurrentUser(CurrentUserModel user) {
		EffectiveAccessContext access = rbacQueryService.getEffectiveAccess(user.clerkUserId());
		// Not a placeholder: checked against the production dump (178 users). All 90 adops users have
		// can_create = true, as do 100% of senior, team_lead and director. The old Pacing rule was
		// `if (role === 'adops' && !can_create) -> 403`; since no flagless adops user exists in
		// production, that gate never actually denied anyone. So "any active role may create"
		// reproduces production behaviour exactly - it only looks like a widening on paper.
		// Client Services is the one exception, excluded on purpose rather than reproduced verbatim:
		// creating a pacing is MPO work, and CS is the one role where the answer is genuinely doubtful.
		// Erring closed there costs nothing.
		boolean canCreate = !access.assignments().isEmpty()
				&& !access.roleCodes().contains(RbacRoleCode.CLIENT_SERVICES.getCode());

		if (access.admin() || hasUnscopedGrant(access)) {
			return new PacingEntitlement(PacingScope.all(), canCreate);
		}

		// Client Services scoping (by NetSuite campaign) needs pacings.campaign_ids, which is not on the
		// Hub side yet (§3 of the migration plan adds it). Until then, Client Services is entitled to
		// nothing rather than guessing at a scope this resolver cannot correctly compute.
		if (access.roleCodes().contains(RbacRoleCode.CLIENT_SERVICES.getCode())) {
			return new PacingEntitlement(PacingScope.owners(List.of()), canCreate);
		}

		List<Long> teamIds = access.assignments().stream()
				.filter(assignment -> RbacScopeCode.TEAM.getCode().equals(assignment.scopeCode()))
				.map(assignment -> assignment.assignment().getScopeId())
				.filter(Objects::nonNull)
				.distinct()
				.toList();

		if (teamIds.isEmpty()) {
			return new PacingEntitlement(PacingScope.owners(List.of()), canCreate);
		}

		Set<Long> memberUserIds = new LinkedHashSet<>();
		memberUserIds.add(user.id());
		hubRoleAssignmentService
				.findActiveByScopeTypeCodeAndScopeIds(RbacScopeCode.TEAM.getCode(), teamIds).stream()
				.map(HubRoleAssignment::getUserId)
				.filter(Objects::nonNull)
				.forEach(memberUserIds::add);

		List<HubUser> members = hubUserService.findAllByIds(memberUserIds);

		// A member with no pacing_user_id yet cannot be named in a UUID scope at all - not "resolves to
		// an empty string", simply absent from the list this resolver can build. Skipping them here (as
		// opposed to letting a null slip into the scope and fail elsewhere) is a silent narrowing of
		// their team's visibility into their pacings, which is exactly the failure mode this whole
		// design exists to avoid — so it is never silent: logged with a count, because it means the §2
		// sync has not reached this person yet, not that they legitimately own nothing.
		Set<String> pacingUserIds = new LinkedHashSet<>();
		int skipped = 0;
		for (HubUser member : members) {
			String pacingUserId = member.getPacingUserId();
			if (pacingUserId == null) {
				skipped++;
				continue;
			}
			pacingUserIds.add(pacingUserId);
		}
		if (skipped > 0) {
			log.warn(
					"Pacing scope for {} omits {} of {} team member(s) with no pacing_user_id yet - "
							+ "the §2 Pacing user sync has not reached them, so their pacings are "
							+ "temporarily invisible to this scope",
					user.email(), skipped, members.size());
		}

		return new PacingEntitlement(PacingScope.owners(List.copyOf(pacingUserIds)), canCreate);
	}

	/**
	 * Tells whether the user holds any ALL-scoped (global) role, which sees every pacing like an admin.
	 *
	 * @param access the user's effective access
	 * @return {@code true} when an ALL-scoped assignment is present
	 */
	private boolean hasUnscopedGrant(EffectiveAccessContext access) {
		return access.assignments().stream()
				.map(RoleAssignmentModel::scopeCode)
				.anyMatch(RbacScopeCode.ALL.getCode()::equals);
	}
}
