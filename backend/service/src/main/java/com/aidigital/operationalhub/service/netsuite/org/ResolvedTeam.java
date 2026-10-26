package com.aidigital.operationalhub.service.netsuite.org;

import java.util.List;

/**
 * A team derived from a single Team Lead - or a Director's direct team - as produced by
 * {@link OrgTreeTeamResolver#resolve}.
 *
 * <p>A Director's direct team (2026-10-23) is the team of the managers who report straight to that
 * Director with no Team Lead in between, and of the agencies NetSuite names the Director on. It is
 * keyed by the Director's email exactly as a Team Lead's team is keyed by theirs; the reconciler only
 * materializes it when there is something to put in it.
 *
 * @param teamLeadEmail  the Team Lead's (or, for a direct team, the Director's) work email - the unique
 *                       key backing this team
 * @param teamLeadName   the Team Lead's (or Director's) display name
 * @param teamName       the unique {@code hub_teams.team_name} ({@code "<department leaf>: <TL first
 *                       name>"}, {@code "... (direct)"} for a Director's direct team, with the email
 *                       local part appended on a name collision)
 * @param podKey         the team's geographic pod code, or {@code null} when it could not be determined
 * @param directorTeam   whether this is a Director's direct team rather than a Team Lead's team
 * @param directorEmails the work emails of every Director the lead's manager chain reaches, nearest
 *                       first - who sees this team; empty when the chain reaches none
 * @param flags          data-quality flags surfaced while resolving this team
 */
public record ResolvedTeam(
		String teamLeadEmail,
		String teamLeadName,
		String teamName,
		String podKey,
		boolean directorTeam,
		List<String> directorEmails,
		List<DataQualityFlag> flags) {

}
