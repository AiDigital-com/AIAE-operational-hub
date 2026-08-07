package com.aidigital.operationalhub.service.netsuite.org;

import com.aidigital.operationalhub.domain.enums.Grade;
import com.aidigital.operationalhub.service.netsuite.model.RipplingEmployee;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Resolves every active employee to an {@link OrgRole}, {@link Grade}, and Team Lead by walking the
 * {@code manager} name chain (primary signal), cross-checked — never overridden — against the
 * {@code teams} string (see {@code team-by-team-lead-PLAN.md} §3).
 *
 * <p>Manager resolution is strictly by name: the {@code manager} column is a full display name, and
 * emails do not follow any predictable pattern relative to names, so matching must never fall back to
 * email.
 */
@Component
@RequiredArgsConstructor
public class OrgTreeTeamResolver {

	/**
	 * Maximum manager-chain hops walked before giving up (cycle/runaway guard).
	 */
	static final int MAX_MANAGER_CHAIN_DEPTH = 10;

	/**
	 * Specific unresolved-team causes already actionable on their own; when one of these was recorded by
	 * {@link #resolveMemberTeamLead}, the generic {@link DataQualityFlag#UNRESOLVED_TEAM} residual is not
	 * also added (see {@code sync-issues-admin-review-PLAN.md} §2: "each unresolved employee has exactly
	 * one actionable why").
	 */
	static final Set<DataQualityFlag> SPECIFIC_UNRESOLVED_CAUSES = EnumSet.of(
			DataQualityFlag.DUPLICATE_MANAGER_NAME,
			DataQualityFlag.MANAGER_NOT_IN_ROSTER,
			DataQualityFlag.MANAGER_CHAIN_HIT_DIRECTOR,
			DataQualityFlag.MANAGER_CHAIN_CYCLE,
			DataQualityFlag.MANAGER_CHAIN_TOO_DEEP,
			DataQualityFlag.NO_TEAM_SIGNAL);

	private final TitleClassifier titleClassifier;
	private final TeamsStringParser teamsStringParser;
	private final NameNormalizer nameNormalizer;

	/**
	 * Resolves every employee to a role, grade, and team, and derives one team per Team Lead.
	 *
	 * @param employees the active employees read from BigQuery; may contain duplicate work emails, which
	 *                  are collapsed to one row each (defense in depth alongside the SQL-side dedup)
	 * @return the resolved employees and teams
	 */
	public OrgResolution resolve(List<RipplingEmployee> employees) {
		List<RipplingEmployee> distinct = dedupeByWorkEmail(employees);
		Map<String, TitleClassification> classificationByEmail = classifyAll(distinct);
		Map<String, ParsedTeamsString> parsedByEmail = parseAll(distinct);
		Map<String, List<RipplingEmployee>> byNormalizedName = indexByNormalizedName(distinct);
		Set<String> ambiguousNames = ambiguousNormalizedNames(byNormalizedName);

		List<RipplingEmployee> teamLeads = distinct.stream()
				.filter(employee -> classificationByEmail.get(employee.workEmail()).orgRole() == OrgRole.TEAM_LEAD)
				.toList();

		Map<String, List<DataQualityFlag>> flagsByEmail = new LinkedHashMap<>();
		for (RipplingEmployee employee : distinct) {
			List<DataQualityFlag> flags = new ArrayList<>();
			if (classificationByEmail.get(employee.workEmail()).titleUnrecognized()) {
				flags.add(DataQualityFlag.UNKNOWN_TITLE);
			}
			flagsByEmail.put(employee.workEmail(), flags);
		}

		Map<String, String> teamNameByLeadEmail = buildTeamNames(teamLeads, flagsByEmail);
		Map<String, String> teamLeadEmailByEmail = resolveTeamLeadEmails(
				distinct, classificationByEmail, parsedByEmail, byNormalizedName, ambiguousNames, teamLeads,
				flagsByEmail);
		Map<String, String> podByLeadEmail = computeTeamPods(
				teamLeads, teamLeadEmailByEmail, parsedByEmail, flagsByEmail);
		flagMemberPodMismatches(distinct, classificationByEmail, teamLeadEmailByEmail, podByLeadEmail,
				parsedByEmail, flagsByEmail);

		for (RipplingEmployee employee : distinct) {
			crossCheckGradeCohort(parsedByEmail.get(employee.workEmail()),
					classificationByEmail.get(employee.workEmail()).grade(), flagsByEmail.get(employee.workEmail()));
		}

		List<ResolvedEmployee> resolvedEmployees = distinct.stream()
				.map(employee -> {
					TitleClassification classification = classificationByEmail.get(employee.workEmail());
					String teamLeadEmail = teamLeadEmailByEmail.get(employee.workEmail());
					String podKey = teamLeadEmail == null ? null : podByLeadEmail.get(teamLeadEmail);
					return new ResolvedEmployee(employee.workEmail(), employee.name(), classification.orgRole(),
							classification.grade(), teamLeadEmail, podKey, flagsByEmail.get(employee.workEmail()));
				})
				.toList();

		List<ResolvedTeam> resolvedTeams = teamLeads.stream()
				.map(lead -> new ResolvedTeam(lead.workEmail(), lead.name(), teamNameByLeadEmail.get(lead.workEmail()),
						podByLeadEmail.get(lead.workEmail()), flagsByEmail.get(lead.workEmail())))
				.toList();

		return new OrgResolution(resolvedEmployees, resolvedTeams);
	}

	/**
	 * Collapses employees to one row per {@code work_email}, keeping the first occurrence and dropping
	 * rows with no work email. Defense in depth alongside the SQL-side {@code GROUP BY work_email}.
	 *
	 * @param employees the raw employee rows
	 * @return the deduplicated employees, in first-seen order
	 */
	List<RipplingEmployee> dedupeByWorkEmail(List<RipplingEmployee> employees) {
		Map<String, RipplingEmployee> byEmail = new LinkedHashMap<>();
		for (RipplingEmployee employee : employees) {
			if (employee.workEmail() != null) {
				byEmail.putIfAbsent(employee.workEmail(), employee);
			}
		}
		return new ArrayList<>(byEmail.values());
	}

	/**
	 * Classifies every employee's title.
	 *
	 * @param employees the deduplicated employees
	 * @return the classification keyed by work email
	 */
	Map<String, TitleClassification> classifyAll(List<RipplingEmployee> employees) {
		Map<String, TitleClassification> result = new HashMap<>();
		for (RipplingEmployee employee : employees) {
			result.put(employee.workEmail(), titleClassifier.classify(employee.title()));
		}
		return result;
	}

	/**
	 * Parses every employee's {@code teams} string.
	 *
	 * @param employees the deduplicated employees
	 * @return the parsed tokens keyed by work email
	 */
	Map<String, ParsedTeamsString> parseAll(List<RipplingEmployee> employees) {
		Map<String, ParsedTeamsString> result = new HashMap<>();
		for (RipplingEmployee employee : employees) {
			result.put(employee.workEmail(), teamsStringParser.parse(employee.teams()));
		}
		return result;
	}

	/**
	 * Indexes employees by their normalized full name, so the manager chain can be walked by name.
	 *
	 * @param employees the deduplicated employees
	 * @return employees grouped by normalized name; a list of size &gt; 1 marks an ambiguous name
	 */
	Map<String, List<RipplingEmployee>> indexByNormalizedName(List<RipplingEmployee> employees) {
		Map<String, List<RipplingEmployee>> result = new HashMap<>();
		for (RipplingEmployee employee : employees) {
			if (employee.name() != null) {
				result.computeIfAbsent(nameNormalizer.normalize(employee.name()), key -> new ArrayList<>())
						.add(employee);
			}
		}
		return result;
	}

	/**
	 * Finds normalized names shared by more than one employee, which are unreliable manager-chain targets.
	 *
	 * @param byNormalizedName the name index
	 * @return the ambiguous normalized names
	 */
	Set<String> ambiguousNormalizedNames(Map<String, List<RipplingEmployee>> byNormalizedName) {
		return byNormalizedName.entrySet().stream()
				.filter(entry -> entry.getValue().size() > 1)
				.map(Map.Entry::getKey)
				.collect(Collectors.toSet());
	}

	/**
	 * Builds the unique {@code hub_teams.team_name} for every Team Lead
	 * ({@code "<department leaf>: <TL first name>"}), matching the Rippling team-token format users see
	 * in the {@code teams} field, and disambiguating a collision by appending the email local part and
	 * flagging both teams.
	 *
	 * @param teamLeads    the Team Lead employees
	 * @param flagsByEmail the mutable per-employee flag accumulator
	 * @return the team name keyed by Team Lead work email
	 */
	Map<String, String> buildTeamNames(
			List<RipplingEmployee> teamLeads, Map<String, List<DataQualityFlag>> flagsByEmail) {
		Map<String, List<RipplingEmployee>> leadsByBaseName = new LinkedHashMap<>();
		Map<String, String> baseNameByLeadEmail = new LinkedHashMap<>();
		for (RipplingEmployee lead : teamLeads) {
			String baseName = teamBaseName(lead);
			baseNameByLeadEmail.put(lead.workEmail(), baseName);
			leadsByBaseName.computeIfAbsent(baseName, key -> new ArrayList<>()).add(lead);
		}
		Map<String, String> teamNameByLeadEmail = new LinkedHashMap<>();
		for (RipplingEmployee lead : teamLeads) {
			String baseName = baseNameByLeadEmail.get(lead.workEmail());
			if (leadsByBaseName.get(baseName).size() > 1) {
				teamNameByLeadEmail.put(lead.workEmail(), baseName + " (" + localPart(lead.workEmail()) + ")");
				flagsByEmail.get(lead.workEmail()).add(DataQualityFlag.DUPLICATE_TEAM_NAME);
			} else {
				teamNameByLeadEmail.put(lead.workEmail(), baseName);
			}
		}
		return teamNameByLeadEmail;
	}

	/**
	 * Derives a visible team name in the same shape as Rippling's team token. For example, department
	 * {@code "Media & Performance Optimization > Media Optimization"} and lead name
	 * {@code "Galina Kurasheva"} become {@code "Media Optimization: Galina"}.
	 *
	 * @param lead the Team Lead employee
	 * @return the team base name before duplicate disambiguation
	 */
	String teamBaseName(RipplingEmployee lead) {
		String department = departmentLeaf(lead.department());
		String leadFirstName = firstName(lead.name());
		if (department.isEmpty()) {
			return leadFirstName;
		}
		if (leadFirstName.isEmpty()) {
			return department;
		}
		return department + ": " + leadFirstName;
	}

	/**
	 * Returns the final segment of a Rippling department path.
	 *
	 * @param department the raw department string, possibly {@code null}
	 * @return the trimmed, whitespace-collapsed leaf segment
	 */
	String departmentLeaf(String department) {
		if (department == null || department.isBlank()) {
			return "";
		}
		String[] segments = department.split(">");
		return segments[segments.length - 1].trim().replaceAll("\\s+", " ");
	}

	/**
	 * Resolves every employee's Team Lead work email: {@code null} for directors, self for Team Leads,
	 * and the manager-chain (falling back to the teams-string token) result for members.
	 *
	 * @param distinct              the deduplicated employees
	 * @param classificationByEmail each employee's title classification, keyed by work email
	 * @param parsedByEmail         each employee's parsed teams string, keyed by work email
	 * @param byNormalizedName      the name index used to walk the manager chain
	 * @param ambiguousNames        normalized names shared by more than one employee
	 * @param teamLeads             the Team Lead employees, candidates for the string-token fallback
	 * @param flagsByEmail          the mutable per-employee flag accumulator
	 * @return the resolved Team Lead work email keyed by employee work email; absent when unresolved
	 */
	Map<String, String> resolveTeamLeadEmails(
			List<RipplingEmployee> distinct,
			Map<String, TitleClassification> classificationByEmail,
			Map<String, ParsedTeamsString> parsedByEmail,
			Map<String, List<RipplingEmployee>> byNormalizedName,
			Set<String> ambiguousNames,
			List<RipplingEmployee> teamLeads,
			Map<String, List<DataQualityFlag>> flagsByEmail) {
		Map<String, String> teamLeadEmailByEmail = new LinkedHashMap<>();
		for (RipplingEmployee employee : distinct) {
			TitleClassification classification = classificationByEmail.get(employee.workEmail());
			List<DataQualityFlag> flags = flagsByEmail.get(employee.workEmail());
			if (classification.orgRole() == OrgRole.DIRECTOR) {
				continue;
			}
			if (classification.orgRole() == OrgRole.TEAM_LEAD) {
				teamLeadEmailByEmail.put(employee.workEmail(), employee.workEmail());
				continue;
			}
			String teamLeadEmail = resolveMemberTeamLead(
					employee, classificationByEmail, byNormalizedName, ambiguousNames, flags);
			ParsedTeamsString parsed = parsedByEmail.get(employee.workEmail());
			if (teamLeadEmail == null) {
				teamLeadEmail = resolveViaTeamToken(parsed, teamLeads);
				if (teamLeadEmail != null) {
					flags.add(DataQualityFlag.TEAM_RESOLVED_VIA_STRING_FALLBACK);
				}
			} else {
				crossCheckTeamToken(parsed, nameOf(teamLeads, teamLeadEmail), flags);
			}
			if (teamLeadEmail == null) {
				if (flags.stream().noneMatch(SPECIFIC_UNRESOLVED_CAUSES::contains)) {
					flags.add(DataQualityFlag.UNRESOLVED_TEAM);
				}
			} else {
				teamLeadEmailByEmail.put(employee.workEmail(), teamLeadEmail);
			}
		}
		return teamLeadEmailByEmail;
	}

	/**
	 * Walks the {@code manager} chain upward from a member to the nearest Team Lead, by name.
	 *
	 * @param employee              the member being resolved
	 * @param classificationByEmail each employee's title classification, keyed by work email
	 * @param byNormalizedName      the name index
	 * @param ambiguousNames        normalized names shared by more than one employee
	 * @param flags                 the employee's mutable flag accumulator
	 * @return the resolved Team Lead's work email, or {@code null} when the tree could not resolve one
	 * (ambiguous/unknown manager name, a Director reached before any Team Lead, a cycle, the maximum
	 * chain depth was exceeded, or the chain ran out with no team signal at all) - the specific cause
	 * is recorded on {@code flags} in every case
	 */
	String resolveMemberTeamLead(
			RipplingEmployee employee,
			Map<String, TitleClassification> classificationByEmail,
			Map<String, List<RipplingEmployee>> byNormalizedName,
			Set<String> ambiguousNames,
			List<DataQualityFlag> flags) {
		Set<String> visited = new HashSet<>();
		String managerName = employee.manager();
		int depth = 0;
		while (managerName != null && depth < MAX_MANAGER_CHAIN_DEPTH) {
			String normalizedManagerName = nameNormalizer.normalize(managerName);
			if (ambiguousNames.contains(normalizedManagerName)) {
				flags.add(DataQualityFlag.DUPLICATE_MANAGER_NAME);
				return null;
			}
			List<RipplingEmployee> matches = byNormalizedName.get(normalizedManagerName);
			if (matches == null || matches.isEmpty()) {
				flags.add(DataQualityFlag.MANAGER_NOT_IN_ROSTER);
				return null;
			}
			RipplingEmployee manager = matches.get(0);
			if (!visited.add(manager.workEmail())) {
				flags.add(DataQualityFlag.MANAGER_CHAIN_CYCLE);
				return null;
			}
			OrgRole managerRole = classificationByEmail.get(manager.workEmail()).orgRole();
			if (managerRole == OrgRole.TEAM_LEAD) {
				return manager.workEmail();
			}
			if (managerRole == OrgRole.DIRECTOR) {
				flags.add(DataQualityFlag.MANAGER_CHAIN_HIT_DIRECTOR);
				return null;
			}
			managerName = manager.manager();
			depth++;
		}
		flags.add(depth >= MAX_MANAGER_CHAIN_DEPTH
				? DataQualityFlag.MANAGER_CHAIN_TOO_DEEP
				: DataQualityFlag.NO_TEAM_SIGNAL);
		return null;
	}

	/**
	 * Best-effort fallback (S5) when the manager tree could not resolve a Team Lead: matches the member's
	 * team-token first-name fragments against Team Leads' first names.
	 *
	 * @param parsed    the member's parsed teams string
	 * @param teamLeads the Team Lead employees
	 * @return the uniquely matching Team Lead's work email, or {@code null} when zero or more than one
	 * candidate matches
	 */
	String resolveViaTeamToken(ParsedTeamsString parsed, List<RipplingEmployee> teamLeads) {
		if (parsed.teamLeadNameFragments().isEmpty()) {
			return null;
		}
		Set<String> fragments = parsed.teamLeadNameFragments().stream()
				.map(String::toLowerCase)
				.collect(Collectors.toSet());
		List<RipplingEmployee> candidates = teamLeads.stream()
				.filter(lead -> fragments.contains(firstName(lead.name()).toLowerCase()))
				.toList();
		return candidates.size() == 1 ? candidates.getFirst().workEmail() : null;
	}

	/**
	 * Soft cross-check (S5): flags when a team token's first-name fragment matches none of the
	 * tree-resolved Team Lead's first name. Never overrides the tree; nicknames are expected.
	 *
	 * @param parsed       the member's parsed teams string
	 * @param resolvedLead the tree-resolved Team Lead, or {@code null} if not found (defensive)
	 * @param flags        the employee's mutable flag accumulator
	 */
	void crossCheckTeamToken(ParsedTeamsString parsed, RipplingEmployee resolvedLead, List<DataQualityFlag> flags) {
		if (parsed.teamLeadNameFragments().isEmpty() || resolvedLead == null) {
			return;
		}
		String leadFirstName = firstName(resolvedLead.name());
		boolean anyMatches = parsed.teamLeadNameFragments().stream()
				.anyMatch(fragment -> fragment.equalsIgnoreCase(leadFirstName));
		if (!anyMatches) {
			flags.add(DataQualityFlag.TEAM_TOKEN_NAME_MISMATCH);
		}
	}

	/**
	 * Computes each team's pod (S6): the Team Lead's own pod token when there is exactly one, otherwise
	 * the majority pod among the team's members; {@code null} and flagged when still ambiguous.
	 *
	 * @param teamLeads            the Team Lead employees
	 * @param teamLeadEmailByEmail each employee's resolved Team Lead email, keyed by employee work email
	 * @param parsedByEmail        each employee's parsed teams string, keyed by work email
	 * @param flagsByEmail         the mutable per-employee flag accumulator
	 * @return the pod key keyed by Team Lead work email; {@code null} value when ambiguous
	 */
	Map<String, String> computeTeamPods(
			List<RipplingEmployee> teamLeads,
			Map<String, String> teamLeadEmailByEmail,
			Map<String, ParsedTeamsString> parsedByEmail,
			Map<String, List<DataQualityFlag>> flagsByEmail) {
		Map<String, List<String>> memberEmailsByLeadEmail = teamLeadEmailByEmail.entrySet().stream()
				.filter(entry -> !entry.getKey().equals(entry.getValue()))
				.collect(Collectors.groupingBy(Map.Entry::getValue,
						Collectors.mapping(Map.Entry::getKey, Collectors.toList())));

		Map<String, String> podByLeadEmail = new LinkedHashMap<>();
		for (RipplingEmployee lead : teamLeads) {
			List<String> leadPodTokens = parsedByEmail.get(lead.workEmail()).podTokens();
			String pod;
			if (leadPodTokens.size() == 1) {
				pod = leadPodTokens.getFirst();
			} else {
				List<String> memberPods = memberEmailsByLeadEmail
						.getOrDefault(lead.workEmail(), List.of()).stream()
						.flatMap(memberEmail -> parsedByEmail.get(memberEmail).podTokens().stream())
						.toList();
				pod = majorityPod(memberPods);
				if (pod == null) {
					flagsByEmail.get(lead.workEmail()).add(DataQualityFlag.POD_AMBIGUOUS);
				}
			}
			podByLeadEmail.put(lead.workEmail(), pod);
		}
		return podByLeadEmail;
	}

	/**
	 * Picks the strict-majority pod among a list of pod tokens, or {@code null} when the list is empty or
	 * no single pod has more occurrences than every other.
	 *
	 * @param pods the pod tokens to vote over
	 * @return the majority pod, or {@code null} when there is no unique majority
	 */
	String majorityPod(List<String> pods) {
		if (pods.isEmpty()) {
			return null;
		}
		Map<String, Long> counts = pods.stream().collect(Collectors.groupingBy(pod -> pod, Collectors.counting()));
		String best = null;
		long bestCount = 0;
		boolean tie = false;
		for (Map.Entry<String, Long> entry : counts.entrySet()) {
			if (entry.getValue() > bestCount) {
				best = entry.getKey();
				bestCount = entry.getValue();
				tie = false;
			} else if (entry.getValue().equals(bestCount)) {
				tie = true;
			}
		}
		return tie ? null : best;
	}

	/**
	 * Flags members whose own pod token(s) disagree with their team's resolved pod. A member matches
	 * exactly when their own pod tokens are the single-element set containing the team pod; anything else
	 * (extra tokens, a different token, or none) is flagged. Informational only; never changes the team
	 * pod or the member's own resolved pod.
	 *
	 * @param distinct              the deduplicated employees
	 * @param classificationByEmail each employee's title classification, keyed by work email
	 * @param teamLeadEmailByEmail  each employee's resolved Team Lead email, keyed by employee work email
	 * @param podByLeadEmail        each team's resolved pod, keyed by Team Lead work email
	 * @param parsedByEmail         each employee's parsed teams string, keyed by work email
	 * @param flagsByEmail          the mutable per-employee flag accumulator
	 */
	void flagMemberPodMismatches(
			List<RipplingEmployee> distinct,
			Map<String, TitleClassification> classificationByEmail,
			Map<String, String> teamLeadEmailByEmail,
			Map<String, String> podByLeadEmail,
			Map<String, ParsedTeamsString> parsedByEmail,
			Map<String, List<DataQualityFlag>> flagsByEmail) {
		for (RipplingEmployee employee : distinct) {
			if (classificationByEmail.get(employee.workEmail()).orgRole() != OrgRole.MEMBER) {
				continue;
			}
			String teamLeadEmail = teamLeadEmailByEmail.get(employee.workEmail());
			if (teamLeadEmail == null) {
				continue;
			}
			String teamPod = podByLeadEmail.get(teamLeadEmail);
			if (teamPod == null) {
				continue;
			}
			List<String> ownPodTokens = parsedByEmail.get(employee.workEmail()).podTokens();
			boolean matchesExactly = ownPodTokens.size() == 1 && ownPodTokens.getFirst().equals(teamPod);
			if (!ownPodTokens.isEmpty() && !matchesExactly) {
				flagsByEmail.get(employee.workEmail()).add(DataQualityFlag.MEMBER_POD_MISMATCH);
			}
		}
	}

	/**
	 * Cross-checks (S7) the title-derived grade against any grade-cohort token present, flagging a
	 * disagreement. The title-derived grade always wins; this only adds a flag.
	 *
	 * @param parsed the employee's parsed teams string
	 * @param grade  the title-derived grade
	 * @param flags  the employee's mutable flag accumulator
	 */
	void crossCheckGradeCohort(ParsedTeamsString parsed, Grade grade, List<DataQualityFlag> flags) {
		for (String cohortToken : parsed.gradeCohortTokens()) {
			if (!compatibleGrades(cohortToken).contains(grade)) {
				flags.add(DataQualityFlag.GRADE_COHORT_MISMATCH);
				return;
			}
		}
	}

	/**
	 * Maps a canonical grade-cohort phrase to the grade(s) it is compatible with.
	 *
	 * @param cohortToken the canonical cohort phrase (as returned by {@link TeamsStringParser})
	 * @return the compatible grades; empty when the phrase is unrecognized
	 */
	Set<Grade> compatibleGrades(String cohortToken) {
		return switch (cohortToken) {
			case "MPO Trainees" -> EnumSet.of(Grade.TRAINEE);
			case "MPO Middles & Juniors" -> EnumSet.of(Grade.MIDDLE, Grade.JUNIOR);
			case "MPO Seniors" -> EnumSet.of(Grade.SENIOR);
			case "MPO Team Leads" -> EnumSet.of(Grade.TEAM_LEAD);
			case "MPO Directors" -> EnumSet.of(Grade.DIRECTOR);
			case "MPO Senior Directors" -> EnumSet.of(Grade.SENIOR_DIRECTOR);
			default -> EnumSet.noneOf(Grade.class);
		};
	}

	/**
	 * Finds a Team Lead employee by work email among a candidate list.
	 *
	 * @param teamLeads     the Team Lead employees
	 * @param teamLeadEmail the work email to find
	 * @return the matching employee, or {@code null} when not found (defensive; should always be present)
	 */
	RipplingEmployee nameOf(List<RipplingEmployee> teamLeads, String teamLeadEmail) {
		return teamLeads.stream().filter(lead -> lead.workEmail().equals(teamLeadEmail)).findFirst().orElse(null);
	}

	/**
	 * Extracts the first whitespace-delimited token of a full name.
	 *
	 * @param fullName the full display name
	 * @return the first name, or an empty string when {@code fullName} is {@code null}/blank
	 */
	String firstName(String fullName) {
		if (fullName == null || fullName.isBlank()) {
			return "";
		}
		return fullName.trim().split("\\s+")[0];
	}

	/**
	 * Extracts the local part (before {@code @}) of an email address, used to disambiguate a team-name
	 * collision.
	 *
	 * @param email the work email
	 * @return the local part, or the whole email when it carries no {@code @}
	 */
	String localPart(String email) {
		int at = email.indexOf('@');
		return at < 0 ? email : email.substring(0, at);
	}
}
