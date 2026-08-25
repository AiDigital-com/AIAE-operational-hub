package com.aidigital.operationalhub.service.netsuite.impl;

import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEventService;
import com.aidigital.operationalhub.domain.entity.HubAgencyOwnerOverride;
import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubScopeType;
import com.aidigital.operationalhub.domain.entity.HubTeam;
import com.aidigital.operationalhub.domain.entity.HubTeamAgency;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.entity.HubAgencyOwnerOverrideService;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubRoleService;
import com.aidigital.operationalhub.service.entity.HubScopeTypeService;
import com.aidigital.operationalhub.service.entity.HubTeamAgencyService;
import com.aidigital.operationalhub.service.entity.HubTeamService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.netsuite.model.AgencyLead;
import com.aidigital.operationalhub.service.netsuite.model.SyncSummary;
import com.aidigital.operationalhub.service.netsuite.org.NameNormalizer;
import com.aidigital.operationalhub.service.netsuite.org.OrgResolution;
import com.aidigital.operationalhub.service.netsuite.org.OrgRole;
import com.aidigital.operationalhub.service.netsuite.org.ResolvedEmployee;
import com.aidigital.operationalhub.service.netsuite.org.ResolvedTeam;
import com.aidigital.operationalhub.service.rbac.AgencyVisibilityService;
import com.aidigital.operationalhub.service.rbac.enums.RbacRoleCode;
import com.aidigital.operationalhub.service.rbac.enums.RbacScopeCode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Writes a resolved {@link OrgResolution} to the database, inside a single write transaction.
 *
 * <p>Extracted from {@link NetSuiteSyncServiceImpl} (see {@code team-by-team-lead-REMEDIATION.md} R2) so
 * that the remote BigQuery reads and the CPU-bound org-tree resolution run before any database
 * connection is acquired: {@link NetSuiteSyncServiceImpl#sync()} is non-transactional and delegates here
 * only once the resolution is ready. Self-invocation of a {@code @Transactional} method on the same bean
 * does not apply the proxy, which is why this is a separate bean rather than a method on the orchestrator.
 *
 * <p>Users, role assignments (any status), and teams are each preloaded once in bulk before the
 * per-employee loop and diffed in memory, rather than queried per employee — the per-employee loop
 * issues no repository reads at all. Writes remain one {@code save} call per
 * changed row: without Hibernate JDBC batching configured, a bulk {@code saveAll} would not reduce the
 * number of SQL statements issued, only the number of Java calls, so the fix is scoped to the reads.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NetSuiteSyncReconciler {

	private final HubTeamService teamService;
	private final HubUserService userService;
	private final HubRoleService roleService;
	private final HubScopeTypeService scopeTypeService;
	private final HubRoleAssignmentService assignmentService;
	private final HubTeamAgencyService teamAgencyService;
	private final HubAgencyOwnerOverrideService agencyOwnerOverrideService;
	private final CacheInvalidationEventService cacheInvalidationEventService;
	private final NameNormalizer nameNormalizer;

	/**
	 * Reconciles a resolved org tree and the IO Lines agency-lead pairs against the database: upserts
	 * users and Team-Lead-derived teams, reconciles every employee's RBAC role assignment, and mirrors the
	 * agency-to-team mapping. Runs inside a single write transaction and evicts the agency-visibility cache
	 * once the write commits, since the sync may have changed any user's effective team/role.
	 *
	 * @param resolution  the resolved employees and teams
	 * @param agencyLeads the agency-to-lead pairs from IO Lines
	 * @return the outcome of this reconcile run
	 */
	@Transactional
	@CacheEvict(cacheNames = AgencyVisibilityService.AGENCY_VISIBILITY_CACHE, allEntries = true)
	public SyncSummary reconcile(OrgResolution resolution, List<AgencyLead> agencyLeads) {
		HubRole teamLeadRole = roleService.existingByRoleCode(RbacRoleCode.TL.getCode());
		HubRole memberRole = roleService.existingByRoleCode(RbacRoleCode.MPO_MANAGER.getCode());
		HubRole directorRole = roleService.existingByRoleCode(RbacRoleCode.DIRECTOR.getCode());
		HubScopeType teamScope = scopeTypeService.existingByScopeCode(RbacScopeCode.TEAM.getCode());
		HubScopeType allScope = scopeTypeService.existingByScopeCode(RbacScopeCode.ALL.getCode());

		Map<String, HubUser> userByEmail = upsertUsers(resolution.employees());
		Map<String, HubTeam> existingTeamsByName = teamService.listAllOrderedByName().stream()
				.collect(Collectors.toMap(HubTeam::getTeamName, team -> team));
		Map<String, HubTeam> teamByLeadEmail =
				reconcileTeams(resolution.teams(), userByEmail, existingTeamsByName);
		Map<String, HubTeam> teamByOverriddenOwnerName = resolveOwnerOverrides(teamByLeadEmail, userByEmail);

		List<Long> userIds = userByEmail.values().stream().map(HubUser::getId).toList();
		Map<Long, List<HubRoleAssignment>> assignmentsByUserId = assignmentService.findAllByUserIds(userIds)
				.stream()
				.collect(Collectors.groupingBy(HubRoleAssignment::getUserId));

		int assignmentsUpdated = 0;
		Map<String, HubTeam> teamByEmployeeName = new HashMap<>();
		Map<String, HubTeam> teamByEmployeeEmailLocalPart = new HashMap<>();
		for (ResolvedEmployee employee : resolution.employees()) {
			HubUser user = userByEmail.get(employee.workEmail());
			if (user == null) {
				continue;
			}
			List<HubRoleAssignment> existingAssignments =
					assignmentsByUserId.getOrDefault(user.getId(), List.of());
			assignmentsUpdated += reconcileEmployeeAssignment(employee, user, teamByLeadEmail, teamLeadRole,
					memberRole, directorRole, teamScope, allScope, existingAssignments);
			if (employee.orgRole() == OrgRole.TEAM_LEAD) {
				HubTeam team = teamByLeadEmail.get(employee.workEmail());
				if (team != null) {
					if (employee.name() != null) {
						teamByEmployeeName.put(nameNormalizer.normalize(employee.name()), team);
					}
					teamByEmployeeEmailLocalPart.put(emailLocalPart(employee.workEmail()), team);
				}
			}
		}

		int agenciesMapped = reconcileAgencyMappings(
				agencyLeads, teamByOverriddenOwnerName, teamByEmployeeName, teamByEmployeeEmailLocalPart);
		int overridesApplied = countOverrideMatches(agencyLeads, teamByOverriddenOwnerName);

		// Propagate to other nodes: the sync may have changed users, assignments, and mappings. The team
		// cache is already invalidated per-write by HubTeamService.create/saveFromNetSuite, so no separate
		// end-of-run HubTeam publish is needed here (see team-by-team-lead-REMEDIATION.md R6).
		cacheInvalidationEventService.publishUpdateEvent(HubUser.class);
		cacheInvalidationEventService.publishUpdateEvent(HubRoleAssignment.class);
		cacheInvalidationEventService.publishUpdateEvent(HubTeamAgency.class);

		return new SyncSummary(
				resolution.teams().size(), userByEmail.size(), assignmentsUpdated, agenciesMapped, overridesApplied);
	}

	/**
	 * Upserts a Hub user (with grade) for every resolved employee, preloading every existing user whose
	 * email matches (case-insensitively) any resolved employee in one bulk query instead of one
	 * {@code findByEmail} per employee.
	 *
	 * @param resolvedEmployees the resolved employees
	 * @return the persisted users keyed by work email
	 */
	Map<String, HubUser> upsertUsers(List<ResolvedEmployee> resolvedEmployees) {
		Set<String> lowerCaseEmails = resolvedEmployees.stream()
				.map(employee -> employee.workEmail().toLowerCase())
				.collect(Collectors.toSet());
		Map<String, HubUser> existingByEmail = userService.findAllByEmailIgnoreCaseIn(lowerCaseEmails).stream()
				.collect(Collectors.toMap(user -> user.getEmail().toLowerCase(), user -> user));

		Map<String, HubUser> userByEmail = new HashMap<>();
		for (ResolvedEmployee employee : resolvedEmployees) {
			HubUser existing = existingByEmail.get(employee.workEmail().toLowerCase());
			userByEmail.put(employee.workEmail(), upsertUser(employee, existing));
		}
		return userByEmail;
	}

	/**
	 * Reconciles the desired team-lead-derived teams against {@code hub_teams}: creates or refreshes one
	 * team per resolved Team Lead, and deactivates {@code from_netsuite} teams no longer in the desired
	 * set (e.g. a legacy department-wide team). Admin-created ({@code from_netsuite=false}) teams are
	 * never touched, even on a {@code team_name} collision.
	 *
	 * @param resolvedTeams       the desired teams, one per Team Lead
	 * @param userByEmail         the persisted users keyed by work email, used to resolve each team's lead id
	 * @param existingTeamsByName every current {@code hub_teams} row, keyed by team name (preloaded once)
	 * @return the persisted teams keyed by Team Lead work email
	 */
	Map<String, HubTeam> reconcileTeams(
			List<ResolvedTeam> resolvedTeams, Map<String, HubUser> userByEmail,
			Map<String, HubTeam> existingTeamsByName) {
		Set<String> desiredNames = resolvedTeams.stream().map(ResolvedTeam::teamName).collect(Collectors.toSet());
		deactivateStaleNetSuiteTeams(existingTeamsByName.values(), desiredNames);

		Map<String, HubTeam> teamByLeadEmail = new HashMap<>();
		for (ResolvedTeam resolvedTeam : resolvedTeams) {
			HubUser teamLead = userByEmail.get(resolvedTeam.teamLeadEmail());
			HubTeam existing = existingTeamsByName.get(resolvedTeam.teamName());
			teamByLeadEmail.put(resolvedTeam.teamLeadEmail(), upsertTeam(resolvedTeam, teamLead, existing));
		}
		return teamByLeadEmail;
	}

	/**
	 * Deactivates every {@code from_netsuite} team not present in the desired team-name set. Teams are
	 * never hard-deleted (foreign keys reference them); admin-created teams are never touched.
	 *
	 * @param existingTeams    every current {@code hub_teams} row (preloaded once)
	 * @param desiredTeamNames the team names the current sync run wants active
	 */
	void deactivateStaleNetSuiteTeams(Collection<HubTeam> existingTeams, Set<String> desiredTeamNames) {
		for (HubTeam existing : existingTeams) {
			if (existing.isFromNetSuite()
					&& !desiredTeamNames.contains(existing.getTeamName())
					&& !HubStatus.INACTIVE.getCode().equals(existing.getStatus())) {
				existing.setStatus(HubStatus.INACTIVE.getCode());
				teamService.saveFromNetSuite(existing);
				log.warn("Deactivated superseded NetSuite team: teamName={}, teamId={}",
						existing.getTeamName(), existing.getId());
			}
		}
	}

	/**
	 * Creates or refreshes the {@code hub_teams} row for a single resolved team. A {@code team_name}
	 * collision with an admin-created team is never overwritten; the admin team is returned as-is and a
	 * warning is logged for manual review.
	 *
	 * @param resolvedTeam the desired team
	 * @param teamLead     the team's Team Lead user, or {@code null} when not yet upserted (defensive)
	 * @param existing     the current {@code hub_teams} row with this team's name, or {@code null} when
	 *                     no such row exists yet (preloaded; see {@link #reconcileTeams})
	 * @return the persisted (or, on collision, the existing admin-created) team
	 */
	HubTeam upsertTeam(ResolvedTeam resolvedTeam, HubUser teamLead, HubTeam existing) {
		if (existing != null && !existing.isFromNetSuite()) {
			log.warn("Skipping NetSuite team upsert: teamName={} collides with an admin-created team, teamId={}",
					resolvedTeam.teamName(), existing.getId());
			return existing;
		}
		Long teamLeadUserId = teamLead == null ? null : teamLead.getId();
		return existing == null
				? createNetSuiteTeam(resolvedTeam, teamLeadUserId)
				: refreshNetSuiteTeam(existing, resolvedTeam, teamLeadUserId);
	}

	/**
	 * Creates a new {@code from_netsuite} team.
	 *
	 * @param resolvedTeam   the desired team
	 * @param teamLeadUserId the team's Team Lead user id, or {@code null}
	 * @return the persisted team
	 */
	HubTeam createNetSuiteTeam(ResolvedTeam resolvedTeam, Long teamLeadUserId) {
		HubTeam team = new HubTeam();
		team.setTeamName(resolvedTeam.teamName());
		team.setPodKey(resolvedTeam.podKey());
		team.setStatus(HubStatus.ACTIVE.getCode());
		team.setFromNetSuite(true);
		team.setTeamLeadUserId(teamLeadUserId);
		return teamService.create(team);
	}

	/**
	 * Refreshes an existing {@code from_netsuite} team's pod, status, and team-lead id in place, only
	 * persisting when something actually changed.
	 *
	 * @param existing       the existing team
	 * @param resolvedTeam   the desired team
	 * @param teamLeadUserId the team's Team Lead user id, or {@code null}
	 * @return the persisted (or unchanged) team
	 */
	HubTeam refreshNetSuiteTeam(HubTeam existing, ResolvedTeam resolvedTeam, Long teamLeadUserId) {
		boolean changed = false;
		if (!Objects.equals(existing.getPodKey(), resolvedTeam.podKey())) {
			existing.setPodKey(resolvedTeam.podKey());
			changed = true;
		}
		if (!HubStatus.ACTIVE.getCode().equals(existing.getStatus())) {
			existing.setStatus(HubStatus.ACTIVE.getCode());
			changed = true;
		}
		if (!Objects.equals(existing.getTeamLeadUserId(), teamLeadUserId)) {
			existing.setTeamLeadUserId(teamLeadUserId);
			changed = true;
		}
		if (!existing.isFromNetSuite()) {
			existing.setFromNetSuite(true);
			changed = true;
		}
		return changed ? teamService.saveFromNetSuite(existing) : existing;
	}

	/**
	 * Reconciles a single resolved employee's RBAC role assignment: {@code MPO_MANAGER}/TEAM for members
	 * on a resolved team, {@code TL}/TEAM (own team) for Team Leads, and {@code DIRECTOR}/ALL (unrestricted
	 * agency visibility, per the product decision that directors see all data) for directors. A member
	 * whose team could not be resolved has any existing active assignment revoked instead — leaving them
	 * pointed at a now-deactivated legacy team would be worse than no assignment — rather than guessing a
	 * scope (see {@code team-by-team-lead-REMEDIATION.md} R1, R5).
	 *
	 * @param employee            the resolved employee
	 * @param user                the employee's persisted Hub user
	 * @param teamByLeadEmail     the persisted teams keyed by Team Lead work email
	 * @param teamLeadRole        the {@code TL} role
	 * @param memberRole          the {@code MPO_MANAGER} role
	 * @param directorRole        the {@code DIRECTOR} role
	 * @param teamScope           the {@code TEAM} scope type
	 * @param allScope            the {@code ALL} scope type
	 * @param existingAssignments this user's current role assignments, any status (preloaded; see
	 *                            {@link #reconcile})
	 * @return {@code 1} when an assignment was created or changed, {@code 0} otherwise
	 */
	int reconcileEmployeeAssignment(
			ResolvedEmployee employee,
			HubUser user,
			Map<String, HubTeam> teamByLeadEmail,
			HubRole teamLeadRole,
			HubRole memberRole,
			HubRole directorRole,
			HubScopeType teamScope,
			HubScopeType allScope,
			List<HubRoleAssignment> existingAssignments) {
		if (hasActiveAdminAssignment(existingAssignments)) {
			log.debug("Skipping NetSuite role reconcile for active admin user: userId={}, email={}",
					user.getId(), user.getEmail());
			return 0;
		}
		boolean changed = switch (employee.orgRole()) {
			case DIRECTOR -> reconcileAssignment(
					user.getId(), directorRole, allScope, null, existingAssignments);
			case TEAM_LEAD -> {
				HubTeam team = teamByLeadEmail.get(employee.workEmail());
				yield team != null
						&& reconcileAssignment(user.getId(), teamLeadRole, teamScope, team.getId(),
						existingAssignments);
			}
			case MEMBER -> {
				if (employee.teamLeadEmail() == null) {
					yield revokeActiveAssignments(existingAssignments);
				}
				HubTeam team = teamByLeadEmail.get(employee.teamLeadEmail());
				yield team != null
						&& reconcileAssignment(user.getId(), memberRole, teamScope, team.getId(), existingAssignments);
			}
		};
		return changed ? 1 : 0;
	}

	/**
	 * Detects a manually managed active administrator assignment. NetSuite/Rippling sync owns generated
	 * MPO roles, but it must not demote an admin by replacing {@code ADMIN}/ALL with a team-scoped role.
	 *
	 * @param existingAssignments this user's current role assignments, any status
	 * @return {@code true} when the user currently has an active {@code ADMIN} role
	 */
	boolean hasActiveAdminAssignment(List<HubRoleAssignment> existingAssignments) {
		return existingAssignments.stream()
				.anyMatch(assignment -> HubStatus.ACTIVE.getCode().equals(assignment.getStatus())
						&& assignment.getRole() != null
						&& RbacRoleCode.ADMIN.getCode().equals(assignment.getRole().getRoleCode()));
	}

	/**
	 * Resolves every active agency-owner override into the lookup {@link #reconcileAgencyMappings} uses:
	 * the team each overridden owner's agencies should go to, keyed by that owner's normalized
	 * {@code display_name}.
	 *
	 * <p>The row stores {@code hub_users} ids on both sides, but an agency arrives from IO Lines carrying
	 * only a {@code mpo_team_lead} display name - {@code AgencyLeadBigQueryService} selects nothing else,
	 * and the source table exposes no identifier for a person. Rather than resolve that incoming name to a
	 * user (the very step that is unreliable), this method goes the other way: it reads the owner's own
	 * {@code display_name} out of {@code hub_users} and matches on that. An override therefore only
	 * applies when NetSuite spells the owner the way Rippling does.
	 *
	 * <p>A row is logged and skipped, never silently ignored, when the owner or the Team Lead is absent
	 * from this run's synced employees (they left the company, or their employment status changed), when
	 * the named Team Lead leads no team this run, or when the owner carries no display name. A typo or a
	 * stale row is exactly the failure mode this override mechanism exists to remove.
	 *
	 * @param teamByLeadEmail the persisted teams keyed by Team Lead work email (see {@link #reconcile})
	 * @param userByEmail     the persisted users keyed by work email (see {@link #upsertUsers})
	 * @return the team each normalized override owner name maps to
	 */
	Map<String, HubTeam> resolveOwnerOverrides(
			Map<String, HubTeam> teamByLeadEmail, Map<String, HubUser> userByEmail) {
		Map<Long, HubUser> userById = userByEmail.values().stream()
				.collect(Collectors.toMap(HubUser::getId, user -> user, (first, second) -> first));
		Map<Long, HubTeam> teamByLeadUserId = new HashMap<>();
		for (Map.Entry<String, HubTeam> entry : teamByLeadEmail.entrySet()) {
			HubUser lead = userByEmail.get(entry.getKey());
			if (lead != null) {
				teamByLeadUserId.putIfAbsent(lead.getId(), entry.getValue());
			}
		}

		Map<String, HubTeam> teamByOverriddenOwnerName = new HashMap<>();
		List<HubAgencyOwnerOverride> overrides =
				agencyOwnerOverrideService.findAllByStatus(HubStatus.ACTIVE.getCode());
		for (HubAgencyOwnerOverride override : overrides) {
			HubUser owner = userById.get(override.getOwnerUserId());
			HubTeam team = teamByLeadUserId.get(override.getTeamLeadUserId());
			if (owner == null || owner.getDisplayName() == null || owner.getDisplayName().isBlank()) {
				log.warn("Agency owner override's owner is not a synced employee with a display name this "
								+ "run: overrideId={}, ownerUserId={}",
						override.getId(), override.getOwnerUserId());
				continue;
			}
			if (team == null) {
				log.warn("Agency owner override's team lead leads no team this run: overrideId={}, "
								+ "teamLeadUserId={}",
						override.getId(), override.getTeamLeadUserId());
				continue;
			}
			teamByOverriddenOwnerName.put(nameNormalizer.normalize(owner.getDisplayName()), team);
		}
		return teamByOverriddenOwnerName;
	}

	/**
	 * Counts the agencies whose IO Lines owner name matches an active override, i.e. how many entries
	 * {@link #reconcileAgencyMappings}'s override attempt (attempt zero) resolves, reported as
	 * {@link SyncSummary#overridesApplied()}. Counted in a separate pass so
	 * {@link #reconcileAgencyMappings} keeps returning a single {@code agenciesMapped} count, like every
	 * other reconcile helper.
	 *
	 * <p><strong>Keep in step with {@link #reconcileAgencyMappings}.</strong> This method re-derives which
	 * agencies the override attempt claims rather than observing what that method actually decided, so the
	 * two only agree because the override is tried first there and always wins. Any change to the skip
	 * guard, the name normalization, or the order of the match attempts in
	 * {@link #reconcileAgencyMappings} must be mirrored here, or the reported count silently stops
	 * describing the mappings that were written.
	 *
	 * @param agencyLeads               the agency-to-lead pairs from IO Lines
	 * @param teamByOverriddenOwnerName the team each normalized override owner name maps to (see
	 *                                  {@link #resolveOwnerOverrides})
	 * @return the number of agencies whose owner matched an active override
	 */
	int countOverrideMatches(List<AgencyLead> agencyLeads, Map<String, HubTeam> teamByOverriddenOwnerName) {
		int count = 0;
		for (AgencyLead lead : agencyLeads) {
			if (lead.agencyId() == null || lead.mpoTeamLead() == null) {
				continue;
			}
			if (teamByOverriddenOwnerName.containsKey(nameNormalizer.normalize(lead.mpoTeamLead()))) {
				count++;
			}
		}
		return count;
	}

	/**
	 * Mirrors the {@code hub_team_agencies} table against the IO Lines agency-to-lead pairs: each agency
	 * is mapped to the team of its MPO team lead. An active {@code hub_agency_owner_overrides} row for
	 * that owner name is tried first (attempt zero) - a deliberate human decision that must also be able
	 * to correct a wrong automatic match, not only fill a gap left by one - before falling back to the
	 * synced Team Leads themselves. A lead name with no exact match falls back to a derived-email match
	 * (see
	 * {@link #deriveEmailLocalPart(String)}), then to a first-name local-part match (see
	 * {@link #deriveFirstNameEmailLocalPart(String)}), since a synced employee's email local part can
	 * outlive a later display-name change (e.g. a handed-down mailbox) while IO Lines keeps recording the
	 * original name or a shortened legacy alias. Agencies still unresolved after these attempts are
	 * skipped; mappings no longer backed by a pair are removed.
	 *
	 * <p>The three automatic attempts below are deliberately left exactly as they were when the override
	 * layer was added, rather than widened to match against the whole roster. Roughly a dozen display-name
	 * aliases already resolve through {@link #deriveEmailLocalPart(String)} and
	 * {@link #deriveFirstNameEmailLocalPart(String)} and account for the large majority of mapped
	 * agencies; several of those keys become ambiguous against the full roster (two employees share a
	 * first name, or an email local part collides across two mail domains), and a correct widening would
	 * have to drop the ambiguous ones. That risked far more coverage than the override layer recovers, so
	 * the override is additive: anything that resolved before resolves the same way after.
	 *
	 * <p><strong>Keep in step with {@link #countOverrideMatches}.</strong> That method reports
	 * {@link SyncSummary#overridesApplied()} by re-deriving the override attempt over the same
	 * {@code agencyLeads}, duplicating this method's skip guard and name normalization. Changing either
	 * of those, or moving the override out of first position, requires the same change there - otherwise
	 * the reported count keeps describing an attempt order this method no longer uses.
	 *
	 * @param agencyLeads                  the agency-to-lead pairs from IO Lines
	 * @param teamByOverriddenOwnerName    the team each normalized override owner name maps to (see
	 *                                     {@link #resolveOwnerOverrides}), tried before automatic matching
	 * @param teamByEmployeeName           the team each (normalized) Team Lead name leads
	 * @param teamByEmployeeEmailLocalPart the team each Team Lead's email local part leads, used as a
	 *                                     fallback when the name match misses
	 * @return the number of agencies mapped to a team
	 */
	int reconcileAgencyMappings(
			List<AgencyLead> agencyLeads,
			Map<String, HubTeam> teamByOverriddenOwnerName,
			Map<String, HubTeam> teamByEmployeeName,
			Map<String, HubTeam> teamByEmployeeEmailLocalPart) {
		Map<Long, Long> desired = new HashMap<>();
		for (AgencyLead lead : agencyLeads) {
			if (lead.agencyId() == null || lead.mpoTeamLead() == null) {
				continue;
			}
			String normalizedOwner = nameNormalizer.normalize(lead.mpoTeamLead());
			HubTeam team = teamByOverriddenOwnerName.get(normalizedOwner);
			if (team == null) {
				team = teamByEmployeeName.get(normalizedOwner);
			}
			if (team == null) {
				team = teamByEmployeeEmailLocalPart.get(deriveEmailLocalPart(lead.mpoTeamLead()));
			}
			if (team == null) {
				team = teamByEmployeeEmailLocalPart.get(deriveFirstNameEmailLocalPart(lead.mpoTeamLead()));
			}
			if (team != null) {
				desired.put(lead.agencyId(), team.getId());
			} else {
				log.warn("Agency MPO team lead did not resolve to a synced Team Lead: agencyId={}, mpoTeamLead={}",
						lead.agencyId(), lead.mpoTeamLead());
			}
		}

		List<HubTeamAgency> existing = teamAgencyService.findAll();
		Map<Long, HubTeamAgency> existingByAgency = existing.stream()
				.collect(Collectors.toMap(HubTeamAgency::getAgencyId, mapping -> mapping, (first, second) -> first));

		List<HubTeamAgency> stale = existing.stream()
				.filter(mapping -> !desired.containsKey(mapping.getAgencyId()))
				.toList();
		if (!stale.isEmpty()) {
			teamAgencyService.deleteAll(stale);
		}

		for (Map.Entry<Long, Long> entry : desired.entrySet()) {
			HubTeamAgency mapping = existingByAgency.get(entry.getKey());
			if (mapping == null) {
				mapping = new HubTeamAgency();
				mapping.setAgencyId(entry.getKey());
				mapping.setTeamId(entry.getValue());
				teamAgencyService.save(mapping);
			} else if (!entry.getValue().equals(mapping.getTeamId())) {
				mapping.setTeamId(entry.getValue());
				teamAgencyService.save(mapping);
			}
		}

		return desired.size();
	}

	/**
	 * Upserts a Hub user by email, refreshing the display name and grade. New users are created
	 * deactivated (no Clerk id) until they log in; existing users keep their Clerk id and status.
	 *
	 * @param employee the resolved employee
	 * @param existing the user's current {@code hub_users} row, or {@code null} when none exists yet
	 *                 (preloaded; see {@link #upsertUsers})
	 * @return the persisted user
	 */
	HubUser upsertUser(ResolvedEmployee employee, HubUser existing) {
		String gradeCode = employee.grade() == null ? null : employee.grade().getCode();
		if (existing != null) {
			existing.setDisplayName(employee.name());
			existing.setGrade(gradeCode);
			return userService.save(existing);
		}
		HubUser user = new HubUser();
		user.setEmail(employee.workEmail());
		user.setDisplayName(employee.name());
		user.setGrade(gradeCode);
		user.setStatus(HubStatus.INACTIVE.getCode());
		return userService.save(user);
	}

	/**
	 * Revokes every currently active role assignment held by a user whose team could not be resolved this
	 * run. Never creates a replacement assignment, since no scope can be safely guessed for an unresolved
	 * member; the user is left with no active assignment until a future run resolves their team.
	 *
	 * @param existingAssignments this user's current role assignments, any status (preloaded; see
	 *                            {@link #reconcile})
	 * @return {@code true} when at least one assignment was revoked, {@code false} when none were active
	 */
	boolean revokeActiveAssignments(List<HubRoleAssignment> existingAssignments) {
		boolean changed = false;
		for (HubRoleAssignment assignment : existingAssignments) {
			if (HubStatus.ACTIVE.getCode().equals(assignment.getStatus())) {
				assignment.setStatus(HubStatus.REVOKED.getCode());
				assignmentService.save(assignment);
				changed = true;
			}
		}
		return changed;
	}

	/**
	 * Ensures the user's single active assignment is exactly the desired role/scope: revokes any other
	 * active assignment, then reactivates the matching row if it exists in any status (a manual revoke is
	 * undone rather than re-inserted, which would violate the unique index), or creates it. Returns
	 * {@code true} when an assignment was created or changed, {@code false} when already correct.
	 *
	 * @param userId              the user id
	 * @param desiredRole         the role the user should hold
	 * @param scopeType           the scope type ({@code TEAM} for members/leads, {@code ALL} for directors)
	 * @param scopeId             the scope id ({@code hub_teams.id} for {@code TEAM}); {@code null} for
	 *                            {@code ALL}, mirroring every other unscoped (global) assignment such as
	 *                            ADMIN/ALL
	 * @param existingAssignments this user's current role assignments, any status (preloaded; see
	 *                            {@link #reconcile})
	 * @return whether the assignment was created or changed
	 */
	boolean reconcileAssignment(
			Long userId, HubRole desiredRole, HubScopeType scopeType, Long scopeId,
			List<HubRoleAssignment> existingAssignments) {
		boolean changed = false;

		// Revoke any active assignment that is not the desired role/scope.
		for (HubRoleAssignment active : existingAssignments) {
			if (HubStatus.ACTIVE.getCode().equals(active.getStatus())
					&& !matches(active, desiredRole, scopeType, scopeId)) {
				active.setStatus(HubStatus.REVOKED.getCode());
				assignmentService.save(active);
				changed = true;
			}
		}

		// Reactivate the matching row if it already exists in any status; otherwise create it. The unique
		// index permits at most one row per (user, role, scope type, scope id) - including the unscoped
		// (scope_id IS NULL) case - so we never insert a duplicate.
		HubRoleAssignment desired = existingAssignments.stream()
				.filter(assignment -> matches(assignment, desiredRole, scopeType, scopeId))
				.findFirst()
				.orElse(null);
		if (desired == null) {
			HubRoleAssignment created = new HubRoleAssignment();
			created.setUserId(userId);
			created.setRole(desiredRole);
			created.setScopeType(scopeType);
			created.setScopeId(scopeId);
			created.setStatus(HubStatus.ACTIVE.getCode());
			assignmentService.save(created);
			return true;
		}
		if (!HubStatus.ACTIVE.getCode().equals(desired.getStatus())) {
			desired.setStatus(HubStatus.ACTIVE.getCode());
			assignmentService.save(desired);
			changed = true;
		}
		return changed;
	}

	/**
	 * Derives a candidate email local part from a display name, e.g. {@code "Sam Marley"} to
	 * {@code "sam.marley"}: lower-cases and joins the normalized name's words with {@code .}, mirroring
	 * the {@code firstname.lastname} convention synced employee emails follow. Used only as a fallback
	 * match against {@link #emailLocalPart(String)} when the name itself has no exact match.
	 *
	 * @param name the display name to derive a local part from
	 * @return the derived local part
	 */
	String deriveEmailLocalPart(String name) {
		return nameNormalizer.normalize(name).replace(' ', '.');
	}

	/**
	 * Derives a candidate email local part from the first word of a display-name alias, e.g.
	 * {@code "Abigail Kuras"} to {@code "abigail"}. Used after the stricter full-name local-part
	 * fallback, for inherited or shortened mailboxes where IO Lines carries the old public name but the
	 * synced employee's current display name is different.
	 *
	 * @param name the display name to derive a local part from
	 * @return the first-name local part
	 */
	String deriveFirstNameEmailLocalPart(String name) {
		String normalized = nameNormalizer.normalize(name);
		int space = normalized.indexOf(' ');
		return space < 0 ? normalized : normalized.substring(0, space);
	}

	/**
	 * Extracts the lower-cased local part (before {@code @}) of an email address.
	 *
	 * @param email the email address
	 * @return the lower-cased local part
	 */
	String emailLocalPart(String email) {
		int at = email.indexOf('@');
		return (at < 0 ? email : email.substring(0, at)).toLowerCase();
	}

	/**
	 * Tells whether an assignment already grants exactly the desired role/scope. Scope id equality is
	 * null-safe: {@code ALL}-scoped assignments (directors) carry a {@code null} scope id, like every other
	 * unscoped assignment (e.g. ADMIN/ALL), so a straight {@code .equals} would either throw or, worse,
	 * never match and insert a duplicate every run.
	 *
	 * @param assignment  the existing assignment
	 * @param desiredRole the role the user should hold
	 * @param scopeType   the scope type
	 * @param scopeId     the scope id, or {@code null} for an unscoped assignment
	 * @return {@code true} when the assignment matches role, scope type, and scope id
	 */
	boolean matches(HubRoleAssignment assignment, HubRole desiredRole, HubScopeType scopeType, Long scopeId) {
		return assignment.getRole() != null
				&& desiredRole.getId().equals(assignment.getRole().getId())
				&& assignment.getScopeType() != null
				&& scopeType.getId().equals(assignment.getScopeType().getId())
				&& Objects.equals(scopeId, assignment.getScopeId());
	}
}
