package com.aidigital.operationalhub.service.netsuite.org;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Data-quality signals surfaced by {@link OrgTreeTeamResolver} while resolving an employee or team.
 * Flags are informational: they never override the manager-tree-primary resolution (see
 * {@code team-by-team-lead-PLAN.md} §3 S5), and are logged by the sync for manual follow-up.
 */
@Getter
@RequiredArgsConstructor
public enum DataQualityFlag {

	/**
	 * The {@code title} matched no known pattern; the grade defaulted to {@code UNKNOWN}.
	 */
	UNKNOWN_TITLE("Title did not match any known pattern; grade defaulted to UNKNOWN."),

	/**
	 * The {@code manager} name referenced during chain-walking is shared by more than one employee, so it
	 * cannot be trusted as a resolution target.
	 */
	DUPLICATE_MANAGER_NAME("Manager name is shared by multiple employees; treated as unresolvable."),

	/**
	 * The manager chain could not resolve a Team Lead, but the {@code teams} string uniquely matched one
	 * by first name (S5 fallback).
	 */
	TEAM_RESOLVED_VIA_STRING_FALLBACK(
			"Manager chain did not resolve a Team Lead; the teams string uniquely matched one instead."),

	/**
	 * A manager named in the chain does not match any active employee by name.
	 */
	MANAGER_NOT_IN_ROSTER("Manager name does not match any active employee in the roster."),

	/**
	 * The manager chain reached a Director (or Senior Director) before encountering any Team Lead.
	 */
	MANAGER_CHAIN_HIT_DIRECTOR("Manager chain reached a Director before any Team Lead."),

	/**
	 * The manager chain revisited an employee already seen on this walk (a management cycle); the walk
	 * was aborted before looping forever.
	 */
	MANAGER_CHAIN_CYCLE("Manager chain contains a cycle; the walk was aborted."),

	/**
	 * The manager chain exceeded {@link OrgTreeTeamResolver#MAX_MANAGER_CHAIN_DEPTH} hops without
	 * reaching a Team Lead.
	 */
	MANAGER_CHAIN_TOO_DEEP("Manager chain exceeded the maximum depth without reaching a Team Lead."),

	/**
	 * The member has no manager to walk (chain exhausted at the top of the roster) and carries no team
	 * token to fall back on.
	 */
	NO_TEAM_SIGNAL("Member has no manager chain signal and no team token to fall back on."),

	/**
	 * Neither the manager chain nor the teams-string fallback could resolve a Team Lead for this member,
	 * for a reason not covered by a more specific flag. Kept only as the residual catch-all.
	 */
	UNRESOLVED_TEAM("Neither the manager chain nor the teams string could resolve a Team Lead."),

	/**
	 * The team token's first-name fragment differs from the tree-resolved Team Lead's first name (soft
	 * check only; nicknames such as Dima/Dmitriy are expected and do not override the tree).
	 */
	TEAM_TOKEN_NAME_MISMATCH(
			"Teams-string team token's first name differs from the resolved Team Lead (nickname expected)."),

	/**
	 * Two Team Leads would otherwise produce the same {@code team_name}; the email local part was
	 * appended to keep the name unique.
	 */
	DUPLICATE_TEAM_NAME("Two Team Leads share department leaf and first name; email local part appended."),

	/**
	 * The team's pod could not be determined from the Team Lead's or members' pod tokens.
	 */
	POD_AMBIGUOUS("Team pod could not be determined from the Team Lead's or members' pod tokens."),

	/**
	 * This member's own pod token(s) disagree with their team's resolved pod. Informational only; the
	 * team pod is not overridden.
	 */
	MEMBER_POD_MISMATCH("Member's own pod token(s) disagree with the team's resolved pod."),

	/**
	 * The title-derived grade disagrees with a grade-cohort token present in the {@code teams} string;
	 * the title-derived grade is preferred.
	 */
	GRADE_COHORT_MISMATCH("Title-derived grade disagrees with the teams-string grade-cohort token.");

	private final String description;
}
