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
import com.aidigital.operationalhub.service.netsuite.model.AgencyTeam;
import com.aidigital.operationalhub.service.netsuite.model.DesiredAssignment;
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

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
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
 *
 * <p>Directors see their own streams (2026-10-23): a Director holds {@code DIRECTOR}/TEAM on every team
 * whose Team Lead's manager chain reaches them ({@link ResolvedTeam#directorEmails()}), plus their own
 * <em>direct team</em> - the managers reporting straight to them and the agencies NetSuite names them
 * on - which exists as a {@code hub_teams} row only while it has one or the other (see
 * {@link #neededDirectorTeamLeadEmails}). Nobody gets an ALL scope from the sync any more; Senior
 * Directors and the SVP are given ADMIN by hand, and an active admin is skipped here as before.
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

		Map<String, HubUser> userByEmail = upsertUsers(resolution.employees());
		Map<String, HubTeam> existingTeamsByName = teamService.listAllOrderedByName().stream()
				.collect(Collectors.toMap(HubTeam::getTeamName, team -> team));
		Map<String, String> leadEmailByOverriddenOwnerName = resolveOwnerOverrides(resolution.teams(), userByEmail);

		// A Director's direct team is a row only while it has something in it; the TL teams always are.
		Set<String> neededDirectorTeams = neededDirectorTeamLeadEmails(
				resolution, agencyLeads, leadEmailByOverriddenOwnerName.keySet());
		List<ResolvedTeam> desiredTeams = resolution.teams().stream()
				.filter(team -> !team.directorTeam() || neededDirectorTeams.contains(team.teamLeadEmail()))
				.toList();
		Map<String, HubTeam> teamByLeadEmail = reconcileTeams(desiredTeams, userByEmail, existingTeamsByName);
		Map<String, HubTeam> teamByOverriddenOwnerName = new HashMap<>();
		leadEmailByOverriddenOwnerName.forEach((ownerName, leadEmail) -> {
			HubTeam team = teamByLeadEmail.get(leadEmail);
			if (team != null) {
				teamByOverriddenOwnerName.put(ownerName, team);
			}
		});
		Map<String, List<HubTeam>> teamsByDirectorEmail = teamsByDirectorEmail(desiredTeams, teamByLeadEmail);

		List<Long> userIds = userByEmail.values().stream().map(HubUser::getId).toList();
		Map<Long, List<HubRoleAssignment>> assignmentsByUserId = assignmentService.findAllByUserIds(userIds)
				.stream()
				.collect(Collectors.groupingBy(HubRoleAssignment::getUserId));

		int assignmentsUpdated = 0;
		// Team Leads first, Directors after (putIfAbsent): on a name collision the TL's team wins the
		// agency, as it did before Directors could lead a team at all.
		Map<String, HubTeam> teamByEmployeeName = new HashMap<>();
		Map<String, HubTeam> teamByEmployeeEmailLocalPart = new HashMap<>();
		List<ResolvedEmployee> directorsWithTeams = new ArrayList<>();
		for (ResolvedEmployee employee : resolution.employees()) {
			HubUser user = userByEmail.get(employee.workEmail());
			if (user == null) {
				continue;
			}
			List<HubRoleAssignment> existingAssignments =
					assignmentsByUserId.getOrDefault(user.getId(), List.of());
			assignmentsUpdated += reconcileEmployeeAssignments(employee, user, teamByLeadEmail, teamsByDirectorEmail,
					teamLeadRole, memberRole, directorRole, teamScope, existingAssignments);
			HubTeam ownTeam = teamByLeadEmail.get(employee.workEmail());
			if (ownTeam == null) {
				continue;
			}
			if (employee.orgRole() == OrgRole.TEAM_LEAD) {
				indexTeamByLead(employee, ownTeam, teamByEmployeeName, teamByEmployeeEmailLocalPart);
			} else if (employee.orgRole() == OrgRole.DIRECTOR) {
				directorsWithTeams.add(employee);
			}
		}
		for (ResolvedEmployee director : directorsWithTeams) {
			indexTeamByLead(director, teamByLeadEmail.get(director.workEmail()), teamByEmployeeName,
					teamByEmployeeEmailLocalPart);
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
				desiredTeams.size(), userByEmail.size(), assignmentsUpdated, agenciesMapped, overridesApplied);
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
		clearDepartmentOfLeavers(userByEmail.values());
		return userByEmail;
	}

	/**
	 * Clears the department of every Hub user who is no longer in Rippling's active roster. The roster
	 * only carries people still employed, so this is how a leaver drops out of "Add people": the
	 * campaign people list keys on the department, not on {@code hub_users.status}, which only says
	 * whether somebody has ever logged in. An empty roster is a failed read, not the whole company
	 * leaving, and clears nothing.
	 *
	 * @param currentUsers the users this run upserted from the roster
	 */
	void clearDepartmentOfLeavers(Collection<HubUser> currentUsers) {
		if (currentUsers.isEmpty()) {
			return;
		}
		Set<Long> currentIds = currentUsers.stream().map(HubUser::getId).collect(Collectors.toSet());
		for (HubUser user : userService.findAll()) {
			if (user.getDepartment() != null && !currentIds.contains(user.getId())) {
				log.info("Cleared the department of a user no longer in Rippling: email={}", user.getEmail());
				user.setDepartment(null);
				userService.save(user);
			}
		}
	}

	/**
	 * Records a lead's team under the two keys {@link #reconcileAgencyMappings} matches an IO Lines
	 * owner name against: the normalized display name and the email local part. {@code putIfAbsent},
	 * so the order of calls decides who wins a collision.
	 *
	 * @param lead                         the Team Lead or Director
	 * @param team                         the team they lead
	 * @param teamByEmployeeName           the mutable name index
	 * @param teamByEmployeeEmailLocalPart the mutable email-local-part index
	 */
	void indexTeamByLead(
			ResolvedEmployee lead, HubTeam team, Map<String, HubTeam> teamByEmployeeName,
			Map<String, HubTeam> teamByEmployeeEmailLocalPart) {
		if (lead.name() != null) {
			teamByEmployeeName.putIfAbsent(nameNormalizer.normalize(lead.name()), team);
		}
		teamByEmployeeEmailLocalPart.putIfAbsent(emailLocalPart(lead.workEmail()), team);
	}

	/**
	 * Decides which Directors' direct teams this run materializes: those with at least one manager
	 * resolved straight to them (no Team Lead in between), and those NetSuite names as
	 * {@code mpo_team_lead} on some agency - by the same name / derived-email / first-name attempts
	 * {@link #reconcileAgencyMappings} makes - unless an active owner override already sends that name
	 * elsewhere. A Director with neither gets no team of their own; their stream's teams are enough.
	 *
	 * @param resolution           the resolved employees and teams
	 * @param agencyLeads          the agency-to-lead pairs from IO Lines
	 * @param overriddenOwnerNames the normalized owner names an active override claims
	 * @return the Director work emails whose direct team should exist
	 */
	Set<String> neededDirectorTeamLeadEmails(
			OrgResolution resolution, List<AgencyLead> agencyLeads, Set<String> overriddenOwnerNames) {
		Set<String> directorEmails = resolution.teams().stream()
				.filter(ResolvedTeam::directorTeam)
				.map(ResolvedTeam::teamLeadEmail)
				.collect(Collectors.toSet());
		Set<String> needed = new HashSet<>();
		for (ResolvedEmployee employee : resolution.employees()) {
			if (employee.orgRole() == OrgRole.MEMBER && employee.teamLeadEmail() != null
					&& directorEmails.contains(employee.teamLeadEmail())) {
				needed.add(employee.teamLeadEmail());
			}
		}
		Map<String, String> directorEmailByName = new HashMap<>();
		Map<String, String> directorEmailByLocalPart = new HashMap<>();
		for (ResolvedEmployee employee : resolution.employees()) {
			if (employee.orgRole() == OrgRole.DIRECTOR) {
				if (employee.name() != null) {
					directorEmailByName.putIfAbsent(nameNormalizer.normalize(employee.name()), employee.workEmail());
				}
				directorEmailByLocalPart.putIfAbsent(emailLocalPart(employee.workEmail()), employee.workEmail());
			}
		}
		for (AgencyLead lead : agencyLeads) {
			if (lead.agencyId() == null || lead.mpoTeamLead() == null) {
				continue;
			}
			String normalizedOwner = nameNormalizer.normalize(lead.mpoTeamLead());
			if (overriddenOwnerNames.contains(normalizedOwner)) {
				continue;
			}
			String email = directorEmailByName.get(normalizedOwner);
			if (email == null) {
				email = directorEmailByLocalPart.get(deriveEmailLocalPart(lead.mpoTeamLead()));
			}
			if (email == null) {
				email = directorEmailByLocalPart.get(deriveFirstNameEmailLocalPart(lead.mpoTeamLead()));
			}
			if (email != null) {
				needed.add(email);
			}
		}
		return needed;
	}

	/**
	 * Lists, per Director, every persisted team they see: each team whose lead's manager chain reaches
	 * them, plus their own direct team when it was materialized.
	 *
	 * @param desiredTeams    the teams this run materializes
	 * @param teamByLeadEmail the persisted teams keyed by lead work email
	 * @return the teams keyed by Director work email; a Director with none is absent
	 */
	Map<String, List<HubTeam>> teamsByDirectorEmail(
			List<ResolvedTeam> desiredTeams, Map<String, HubTeam> teamByLeadEmail) {
		Map<String, List<HubTeam>> result = new LinkedHashMap<>();
		for (ResolvedTeam resolvedTeam : desiredTeams) {
			HubTeam team = teamByLeadEmail.get(resolvedTeam.teamLeadEmail());
			if (team == null) {
				continue;
			}
			if (resolvedTeam.directorTeam()) {
				result.computeIfAbsent(resolvedTeam.teamLeadEmail(), email -> new ArrayList<>()).add(team);
			}
			for (String directorEmail : resolvedTeam.directorEmails()) {
				result.computeIfAbsent(directorEmail, email -> new ArrayList<>()).add(team);
			}
		}
		return result;
	}

	/**
	 * Reconciles the desired teams against {@code hub_teams}: creates or refreshes one team per resolved
	 * Team Lead (and per materialized Director direct team), and deactivates {@code from_netsuite} teams
	 * no longer in the desired set (e.g. a legacy department-wide team, or a Director's direct team that
	 * emptied). Admin-created ({@code from_netsuite=false}) teams are never touched, even on a
	 * {@code team_name} collision.
	 *
	 * @param resolvedTeams       the desired teams, one per Team Lead and per needed Director
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
	 * Reconciles a single resolved employee's RBAC role assignments: {@code MPO_MANAGER}/TEAM for members
	 * on a resolved team (a Team Lead's, or a Director's direct team), {@code TL}/TEAM (own team) for Team
	 * Leads, and {@code DIRECTOR}/TEAM on every team of their stream for Directors - one assignment per
	 * team, never an ALL scope (2026-10-23; "directors see all" is withdrawn). A member whose team could
	 * not be resolved, or a Director whose stream reaches no team, has any existing active assignment
	 * revoked instead - leaving them pointed at a now-deactivated legacy team would be worse than no
	 * assignment - rather than guessing a scope (see {@code team-by-team-lead-REMEDIATION.md} R1, R5).
	 *
	 * @param employee             the resolved employee
	 * @param user                 the employee's persisted Hub user
	 * @param teamByLeadEmail      the persisted teams keyed by Team Lead (or Director) work email
	 * @param teamsByDirectorEmail the persisted teams each Director sees, keyed by work email
	 * @param teamLeadRole         the {@code TL} role
	 * @param memberRole           the {@code MPO_MANAGER} role
	 * @param directorRole         the {@code DIRECTOR} role
	 * @param teamScope            the {@code TEAM} scope type
	 * @param existingAssignments  this user's current role assignments, any status (preloaded; see
	 *                             {@link #reconcile})
	 * @return {@code 1} when an assignment was created or changed, {@code 0} otherwise
	 */
	int reconcileEmployeeAssignments(
			ResolvedEmployee employee,
			HubUser user,
			Map<String, HubTeam> teamByLeadEmail,
			Map<String, List<HubTeam>> teamsByDirectorEmail,
			HubRole teamLeadRole,
			HubRole memberRole,
			HubRole directorRole,
			HubScopeType teamScope,
			List<HubRoleAssignment> existingAssignments) {
		if (hasActiveAdminAssignment(existingAssignments)) {
			log.debug("Skipping NetSuite role reconcile for active admin user: userId={}, email={}",
					user.getId(), user.getEmail());
			return 0;
		}
		List<DesiredAssignment> desired = switch (employee.orgRole()) {
			case DIRECTOR -> teamsByDirectorEmail.getOrDefault(employee.workEmail(), List.of()).stream()
					.map(team -> new DesiredAssignment(directorRole, teamScope, team.getId()))
					.toList();
			case TEAM_LEAD -> {
				HubTeam team = teamByLeadEmail.get(employee.workEmail());
				yield team == null ? List.of() : List.of(new DesiredAssignment(teamLeadRole, teamScope, team.getId()));
			}
			case MEMBER -> {
				HubTeam team = employee.teamLeadEmail() == null ? null : teamByLeadEmail.get(employee.teamLeadEmail());
				yield team == null ? List.of() : List.of(new DesiredAssignment(memberRole, teamScope, team.getId()));
			}
		};
		if (desired.isEmpty() && employee.orgRole() == OrgRole.DIRECTOR) {
			log.warn("Director's stream reaches no team this run; revoking their assignments: userId={}, email={}",
					user.getId(), user.getEmail());
		}
		boolean changed = desired.isEmpty()
				? revokeActiveAssignments(existingAssignments)
				: reconcileAssignments(user.getId(), desired, existingAssignments);
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
	 * the Team Lead whose team each overridden owner's agencies should go to, keyed by that owner's
	 * normalized {@code display_name}. Resolved before any team row is written - the set of overridden
	 * names also decides which Directors need a direct team of their own (see
	 * {@link #neededDirectorTeamLeadEmails}) - so it answers with the lead's email, which
	 * {@link #reconcile} turns into the persisted team once the teams exist.
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
	 * @param resolvedTeams the resolved teams (see {@link OrgResolution#teams()}), whose leads an override
	 *                      may point at - a Director's direct team included
	 * @param userByEmail   the persisted users keyed by work email (see {@link #upsertUsers})
	 * @return the lead work email each normalized override owner name maps to
	 */
	Map<String, String> resolveOwnerOverrides(List<ResolvedTeam> resolvedTeams, Map<String, HubUser> userByEmail) {
		Map<Long, HubUser> userById = userByEmail.values().stream()
				.collect(Collectors.toMap(HubUser::getId, user -> user, (first, second) -> first));
		Map<Long, String> leadEmailByLeadUserId = new HashMap<>();
		for (ResolvedTeam resolvedTeam : resolvedTeams) {
			HubUser lead = userByEmail.get(resolvedTeam.teamLeadEmail());
			if (lead != null) {
				leadEmailByLeadUserId.putIfAbsent(lead.getId(), resolvedTeam.teamLeadEmail());
			}
		}

		Map<String, String> leadEmailByOverriddenOwnerName = new HashMap<>();
		List<HubAgencyOwnerOverride> overrides =
				agencyOwnerOverrideService.findAllByStatus(HubStatus.ACTIVE.getCode());
		for (HubAgencyOwnerOverride override : overrides) {
			HubUser owner = userById.get(override.getOwnerUserId());
			String leadEmail = leadEmailByLeadUserId.get(override.getTeamLeadUserId());
			if (owner == null || owner.getDisplayName() == null || owner.getDisplayName().isBlank()) {
				log.warn("Agency owner override's owner is not a synced employee with a display name this "
								+ "run: overrideId={}, ownerUserId={}",
						override.getId(), override.getOwnerUserId());
				continue;
			}
			if (leadEmail == null) {
				log.warn("Agency owner override's team lead leads no team this run: overrideId={}, "
								+ "teamLeadUserId={}",
						override.getId(), override.getTeamLeadUserId());
				continue;
			}
			leadEmailByOverriddenOwnerName.put(nameNormalizer.normalize(owner.getDisplayName()), leadEmail);
		}
		return leadEmailByOverriddenOwnerName;
	}

	/**
	 * Counts the distinct agencies whose IO Lines owner name matches an active override, i.e. how many
	 * agencies {@link #reconcileAgencyMappings}'s override attempt (attempt zero) resolves, reported as
	 * {@link SyncSummary#overridesApplied()}. Counted in a separate pass so
	 * {@link #reconcileAgencyMappings} keeps returning a single {@code agenciesMapped} count, like every
	 * other reconcile helper.
	 *
	 * <p>Counted by distinct {@code agencyId} rather than by matching row, since {@code agencyLeads} now
	 * carries one row per (agency, owner) pair: a co-owned agency with two owners who both match an
	 * override would otherwise be counted twice.
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
	 * @return the number of distinct agencies whose owner matched an active override
	 */
	int countOverrideMatches(List<AgencyLead> agencyLeads, Map<String, HubTeam> teamByOverriddenOwnerName) {
		Set<Long> matchedAgencyIds = new HashSet<>();
		for (AgencyLead lead : agencyLeads) {
			if (lead.agencyId() == null || lead.mpoTeamLead() == null) {
				continue;
			}
			if (teamByOverriddenOwnerName.containsKey(nameNormalizer.normalize(lead.mpoTeamLead()))) {
				matchedAgencyIds.add(lead.agencyId());
			}
		}
		return matchedAgencyIds.size();
	}

	/**
	 * Mirrors the {@code hub_team_agencies} table against the IO Lines agency-to-lead pairs: each
	 * (agency, owner) pair is mapped to the owner's team, and an agency co-owned by several teams
	 * therefore yields several {@code hub_team_agencies} rows - one per owning team - rather than one row
	 * per agency. An active {@code hub_agency_owner_overrides} row for that owner name is tried first
	 * (attempt zero) - a deliberate human decision that must also be able to correct a wrong automatic
	 * match, not only fill a gap left by one - before falling back to the synced Team Leads themselves. A
	 * lead name with no exact match falls back to a derived-email match (see
	 * {@link #deriveEmailLocalPart(String)}), then to a first-name local-part match (see
	 * {@link #deriveFirstNameEmailLocalPart(String)}), since a synced employee's email local part can
	 * outlive a later display-name change (e.g. a handed-down mailbox) while IO Lines keeps recording the
	 * original name or a shortened legacy alias. A Director NetSuite names as the lead resolves through
	 * the same three attempts to their direct team (2026-10-23), indexed after every Team Lead so a TL
	 * wins any collision. Agencies still unresolved after these attempts are skipped; mappings no longer
	 * backed by a pair are removed.
	 *
	 * <p>Retargeting an existing mapping to a different team is a delete of the old
	 * {@code (agency_id, team_id)} row plus an insert of the new one, not an in-place {@code team_id}
	 * update: {@code hub_team_agencies} is now keyed by {@code (team_id, agency_id)} together (see
	 * {@code 0016-team-agency-multi-team.xml}), so the pair itself is the identity of a mapping, and there
	 * is no single existing row to update onto a new team id without first knowing there is only one.
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
	 * @param teamByEmployeeName           the team each (normalized) Team Lead or Director name leads
	 * @param teamByEmployeeEmailLocalPart the team each Team Lead's or Director's email local part leads,
	 *                                     used as a fallback when the name match misses
	 * @return the number of distinct agencies mapped to at least one team
	 */
	int reconcileAgencyMappings(
			List<AgencyLead> agencyLeads,
			Map<String, HubTeam> teamByOverriddenOwnerName,
			Map<String, HubTeam> teamByEmployeeName,
			Map<String, HubTeam> teamByEmployeeEmailLocalPart) {
		Set<AgencyTeam> desired = new HashSet<>();
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
				desired.add(new AgencyTeam(lead.agencyId(), team.getId()));
			} else {
				log.warn("Agency MPO team lead did not resolve to a synced Team Lead: agencyId={}, mpoTeamLead={}",
						lead.agencyId(), lead.mpoTeamLead());
			}
		}

		List<HubTeamAgency> existing = teamAgencyService.findAll();
		Set<AgencyTeam> existingPairs = existing.stream()
				.map(mapping -> new AgencyTeam(mapping.getAgencyId(), mapping.getTeamId()))
				.collect(Collectors.toSet());

		List<HubTeamAgency> stale = existing.stream()
				.filter(mapping -> !desired.contains(new AgencyTeam(mapping.getAgencyId(), mapping.getTeamId())))
				.toList();
		if (!stale.isEmpty()) {
			teamAgencyService.deleteAll(stale);
		}

		for (AgencyTeam pair : desired) {
			if (!existingPairs.contains(pair)) {
				HubTeamAgency mapping = new HubTeamAgency();
				mapping.setAgencyId(pair.agencyId());
				mapping.setTeamId(pair.teamId());
				teamAgencyService.save(mapping);
			}
		}

		return (int) desired.stream().map(AgencyTeam::agencyId).distinct().count();
	}

	/**
	 * Upserts a Hub user by email, refreshing the display name, grade and Rippling department. New users
	 * are created deactivated (no Clerk id) until they log in; existing users keep their Clerk id and
	 * status.
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
			existing.setDepartment(employee.department());
			return userService.save(existing);
		}
		HubUser user = new HubUser();
		user.setEmail(employee.workEmail());
		user.setDisplayName(employee.name());
		user.setGrade(gradeCode);
		user.setDepartment(employee.department());
		user.setStatus(HubStatus.INACTIVE.getCode());
		return userService.save(user);
	}

	/**
	 * Revokes every currently active role assignment held by a user whose team could not be resolved this
	 * run (or whose stream, for a Director, reaches no team). Never creates a replacement assignment,
	 * since no scope can be safely guessed; the user is left with no active assignment until a future
	 * run resolves it.
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
	 * Ensures the user's active assignments are exactly the desired set: revokes any other active
	 * assignment, then, for each desired one, reactivates the matching row if it exists in any status (a
	 * manual revoke is undone rather than re-inserted, which would violate the unique index), or creates
	 * it. One desired entry for a member or Team Lead; one per team of their stream for a Director.
	 * Returns {@code true} when any assignment was created or changed, {@code false} when already correct.
	 *
	 * @param userId              the user id
	 * @param desired             the assignments the user should hold, never empty
	 * @param existingAssignments this user's current role assignments, any status (preloaded; see
	 *                            {@link #reconcile})
	 * @return whether an assignment was created or changed
	 */
	boolean reconcileAssignments(
			Long userId, List<DesiredAssignment> desired, List<HubRoleAssignment> existingAssignments) {
		boolean changed = false;

		// Revoke any active assignment that is not among the desired role/scopes.
		for (HubRoleAssignment active : existingAssignments) {
			if (HubStatus.ACTIVE.getCode().equals(active.getStatus())
					&& desired.stream().noneMatch(want -> matches(active, want))) {
				active.setStatus(HubStatus.REVOKED.getCode());
				assignmentService.save(active);
				changed = true;
			}
		}

		// Reactivate the matching row if it already exists in any status; otherwise create it. The unique
		// index permits at most one row per (user, role, scope type, scope id) - including the unscoped
		// (scope_id IS NULL) case - so we never insert a duplicate.
		for (DesiredAssignment want : desired) {
			HubRoleAssignment existing = existingAssignments.stream()
					.filter(assignment -> matches(assignment, want))
					.findFirst()
					.orElse(null);
			if (existing == null) {
				HubRoleAssignment created = new HubRoleAssignment();
				created.setUserId(userId);
				created.setRole(want.role());
				created.setScopeType(want.scopeType());
				created.setScopeId(want.scopeId());
				created.setStatus(HubStatus.ACTIVE.getCode());
				assignmentService.save(created);
				changed = true;
			} else if (!HubStatus.ACTIVE.getCode().equals(existing.getStatus())) {
				existing.setStatus(HubStatus.ACTIVE.getCode());
				assignmentService.save(existing);
				changed = true;
			}
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
	 * null-safe: an unscoped assignment (e.g. ADMIN/ALL, or the DIRECTOR/ALL rows the sync wrote before
	 * 2026-10-23) carries a {@code null} scope id, so a straight {@code .equals} would either throw or,
	 * worse, never match and insert a duplicate every run.
	 *
	 * @param assignment the existing assignment
	 * @param want       the desired role, scope type and scope id
	 * @return {@code true} when the assignment matches role, scope type, and scope id
	 */
	boolean matches(HubRoleAssignment assignment, DesiredAssignment want) {
		return assignment.getRole() != null
				&& want.role().getId().equals(assignment.getRole().getId())
				&& assignment.getScopeType() != null
				&& want.scopeType().getId().equals(assignment.getScopeType().getId())
				&& Objects.equals(want.scopeId(), assignment.getScopeId());
	}
}
