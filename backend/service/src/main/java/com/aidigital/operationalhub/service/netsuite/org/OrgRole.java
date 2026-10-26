package com.aidigital.operationalhub.service.netsuite.org;

/**
 * Organizational role classified from an employee's Rippling {@code title} by {@link TitleClassifier},
 * driving both team assignment ({@link OrgTreeTeamResolver}) and the RBAC role granted during sync.
 */
public enum OrgRole {

	/**
	 * Heads a stream inside the MPO tree (Director or Senior Director). Assigned the {@code DIRECTOR}
	 * RBAC role scoped to every team whose Team Lead's manager chain reaches them, plus their own direct
	 * team when they have managers or agencies with no Team Lead in between (2026-10-23; before that,
	 * an unscoped ALL grant - "directors see all" - which is no longer given by the sync to anyone). A
	 * Director title outside the configured root department reads as {@link #MEMBER} - see
	 * {@code OrgTreeTeamResolver#classifyWithDepartmentGate}.
	 */
	DIRECTOR,

	/**
	 * Leads a team. The team itself is keyed by this employee ({@code teamLeadEmail == workEmail}).
	 */
	TEAM_LEAD,

	/**
	 * An individual contributor, assigned to their Team Lead's team via the manager chain.
	 */
	MEMBER
}
