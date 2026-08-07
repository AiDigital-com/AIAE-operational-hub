package com.aidigital.operationalhub.service.netsuite.org;

import java.util.List;

/**
 * Full output of {@link OrgTreeTeamResolver#resolve}: every active employee resolved to a role, grade,
 * and team, plus one derived team per Team Lead.
 *
 * @param employees the resolved employees, one per distinct {@code work_email}
 * @param teams     the resolved teams, one per Team Lead
 */
public record OrgResolution(List<ResolvedEmployee> employees, List<ResolvedTeam> teams) {

}
