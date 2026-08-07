package com.aidigital.operationalhub.service.netsuite.org;

/**
 * Organizational role classified from an employee's Rippling {@code title} by {@link TitleClassifier},
 * driving both team assignment ({@link OrgTreeTeamResolver}) and the RBAC role granted during sync.
 */
public enum OrgRole {

	/**
	 * Heads a department. Assigned the {@code DIRECTOR} RBAC role and no team (see
	 * {@code team-by-team-lead-PLAN.md} §6 open item 1).
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
