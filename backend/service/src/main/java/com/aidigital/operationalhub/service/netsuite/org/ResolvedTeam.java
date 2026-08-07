package com.aidigital.operationalhub.service.netsuite.org;

import java.util.List;

/**
 * A team derived from a single Team Lead, as produced by {@link OrgTreeTeamResolver#resolve}.
 *
 * @param teamLeadEmail the Team Lead's work email (unique key backing this team)
 * @param teamLeadName  the Team Lead's display name
 * @param teamName      the unique {@code hub_teams.team_name} ({@code "<department leaf>: <TL first name>"},
 *                      with the email local part appended on a name collision)
 * @param podKey        the team's geographic pod code, or {@code null} when it could not be determined
 * @param flags         data-quality flags surfaced while resolving this team
 */
public record ResolvedTeam(
		String teamLeadEmail, String teamLeadName, String teamName, String podKey, List<DataQualityFlag> flags) {

}
