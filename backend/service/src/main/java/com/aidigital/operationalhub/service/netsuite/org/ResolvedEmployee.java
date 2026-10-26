package com.aidigital.operationalhub.service.netsuite.org;

import com.aidigital.operationalhub.domain.enums.Grade;

import java.util.List;

/**
 * A single employee resolved to their organizational role, grade, and team, as produced by
 * {@link OrgTreeTeamResolver#resolve}.
 *
 * @param workEmail     the employee's work email (unique key)
 * @param name          the employee's display name
 * @param department    the employee's raw Rippling department path, written to {@code hub_users.department}
 * @param orgRole       the classified organizational role
 * @param grade         the classified grade
 * @param teamLeadEmail the work email of the employee's Team Lead — their own email when
 *                      {@code orgRole == TEAM_LEAD}, a Director's email for a manager reporting
 *                      straight to that Director (their direct team) — or {@code null} for directors
 *                      themselves and members whose team could not be resolved
 * @param podKey        the geographic pod of the employee's team, propagated from
 *                      {@link ResolvedTeam#podKey()}; {@code null} when the employee has no team or the
 *                      team's pod is ambiguous
 * @param flags         data-quality flags surfaced while resolving this employee
 */
public record ResolvedEmployee(
		String workEmail,
		String name,
		String department,
		OrgRole orgRole,
		Grade grade,
		String teamLeadEmail,
		String podKey,
		List<DataQualityFlag> flags) {

}
