package com.aidigital.operationalhub.service.netsuite.org;

import com.aidigital.operationalhub.domain.enums.Grade;
import com.aidigital.operationalhub.service.netsuite.model.RipplingEmployee;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link OrgTreeTeamResolver}, using the representative fixture from
 * {@code team-by-team-lead-PLAN.md} §7 (edge cases 1-13), plus a few additional scenarios that the
 * mandated fixture does not naturally exercise (S5 string-fallback success/ambiguity, duplicate
 * manager/team names, an actual grade-cohort mismatch, pod-vote ambiguity, and the manager-chain-walk
 * edge cases added by {@code team-by-team-lead-REMEDIATION.md} R7: multi-hop climbs, a Director reached
 * before any Team Lead, a manager cycle, and the max-depth guard).
 */
class OrgTreeTeamResolverTest {

	private final OrgTreeTeamResolver resolver =
			new OrgTreeTeamResolver(new TitleClassifier(), new TeamsStringParser(), new NameNormalizer());

	@Test
	void shouldSplitTwoTeamLeadsWithTheSameFirstNameByManagerNameTest() {
		// Given: edge case 1 - two "Daria" Team Leads; only the manager edge distinguishes the split
		RipplingEmployee dariaFeofanova = new RipplingEmployee("Daria Feofanova", "Media Optimization",
				"dory@aidigital.com", "HOUSE , MPO Team Leads", "Team Lead, Media Optimization", "Gerel Mutulova");
		RipplingEmployee dariaMorkunas = new RipplingEmployee("Daria Morkunas", "Media Optimization",
				"daria.morkunas@aidigital.com", "HOUSE , MPO Team Leads", "Team Lead, Media Optimization",
				"Gerel Mutulova");
		RipplingEmployee abdullah = new RipplingEmployee("Abdullah Mimić", "Media Optimization",
				"abdullah.mimic@aidigital.com", "Media Optimization: Daria, HOUSE , MPO Seniors",
				"Senior Media Optimization Manager", "Daria Feofanova");
		RipplingEmployee alinaBukhun = new RipplingEmployee("Alina Bukhun", "Media Optimization",
				"allison@aidigital.com", "Media Optimization: Daria, HOUSE , MPO Seniors",
				"Senior Media Optimization Manager", "Daria Morkunas");

		// When:
		OrgResolution result = resolver.resolve(List.of(dariaFeofanova, dariaMorkunas, abdullah, alinaBukhun));

		// Then:
		Map<String, ResolvedEmployee> byEmail = byEmail(result);
		assertThat(byEmail.get("abdullah.mimic@aidigital.com").teamLeadEmail()).isEqualTo("dory@aidigital.com");
		assertThat(byEmail.get("allison@aidigital.com").teamLeadEmail()).isEqualTo("daria.morkunas@aidigital.com");
	}

	@Test
	void shouldResolveNicknameTokenByManagerNameNotFirstNameTest() {
		// Given: edge case 2 - "Media Optimization: Dima" but the manager is "Dmitriy Borodulin"
		RipplingEmployee dmitriy = new RipplingEmployee("Dmitriy Borodulin", "Media Optimization",
				"dmitriy.borodulin@aidigital.com", "SOUTHEAST, MPO Team Leads", "Team Lead, Media Optimization",
				"Aleksandr Kuzmin");
		RipplingEmployee aleksandra = new RipplingEmployee("Aleksandra Guduric", "Media Optimization",
				"aleksandra.guduric@aidigital.com", "SOUTHEAST, Media Optimization: Dima, MPO Middles & Juniors",
				"Media Optimization Manager", "Dmitriy Borodulin");

		// When:
		OrgResolution result = resolver.resolve(List.of(dmitriy, aleksandra));

		// Then:
		ResolvedEmployee resolved = byEmail(result).get("aleksandra.guduric@aidigital.com");
		assertThat(resolved.teamLeadEmail()).isEqualTo("dmitriy.borodulin@aidigital.com");
		assertThat(resolved.flags()).contains(DataQualityFlag.TEAM_TOKEN_NAME_MISMATCH);
		assertThat(resolved.flags()).doesNotContain(DataQualityFlag.UNRESOLVED_TEAM);
	}

	@Test
	void shouldResolveTokenLessMemberViaManagerAndInheritTeamPodTest() {
		// Given: edge case 3 - Alejandro has only a pod token, no team token; team known via manager only
		RipplingEmployee daria = new RipplingEmployee("Daria Feofanova", "Media Optimization",
				"dory@aidigital.com", "HOUSE , MPO Team Leads", "Team Lead, Media Optimization", "Gerel Mutulova");
		RipplingEmployee alejandro = new RipplingEmployee("Alejandro Gamero", "Media Optimization",
				"alejandro.gamero@aidigital.com", "HOUSE", "Media Optimization Manager", "Daria Feofanova");

		// When:
		OrgResolution result = resolver.resolve(List.of(daria, alejandro));

		// Then:
		ResolvedEmployee resolved = byEmail(result).get("alejandro.gamero@aidigital.com");
		assertThat(resolved.teamLeadEmail()).isEqualTo("dory@aidigital.com");
		assertThat(resolved.podKey()).isEqualTo("HOUSE");
	}

	@Test
	void shouldResolveTeamLeadToSelfWithNoOwnTeamTokenTest() {
		// Given: edge case 4 - a Team Lead identified purely by title; her own teams string has no
		// "...: Daria" token for herself
		RipplingEmployee daria = new RipplingEmployee("Daria Feofanova", "Media Optimization",
				"dory@aidigital.com", "HOUSE , MPO Team Leads", "Team Lead, Media Optimization", "Gerel Mutulova");

		// When:
		OrgResolution result = resolver.resolve(List.of(daria));

		// Then:
		ResolvedEmployee resolved = byEmail(result).get("dory@aidigital.com");
		assertThat(resolved.orgRole()).isEqualTo(OrgRole.TEAM_LEAD);
		assertThat(resolved.teamLeadEmail()).isEqualTo("dory@aidigital.com");
		assertThat(result.teams()).hasSize(1);
		assertThat(result.teams().getFirst().teamName()).isEqualTo("Media Optimization: Daria");
	}

	@Test
	void shouldBuildTeamNameLikeRipplingTeamTokenTest() {
		// Given: Rippling exposes the team in the teams string as "Media Optimization: Galina"; the stored
		// Hub team name should mirror that user-facing token instead of the full department path/full name.
		RipplingEmployee galina = new RipplingEmployee(
				"Galina Kurasheva",
				"Media & Performance Optimization > Media Optimization",
				"galina.kurasheva@aidigital.com",
				"HOUSE, MPO Team Leads",
				"Team Lead, Media Optimization",
				"Gerel Mutulova");

		// When:
		OrgResolution result = resolver.resolve(List.of(galina));

		// Then:
		assertThat(result.teams()).singleElement()
				.extracting(ResolvedTeam::teamName)
				.isEqualTo("Media Optimization: Galina");
	}

	@Test
	void shouldAssignDirectorRoleWithNoTeamTest() {
		// Given: edge case 5 - a Director, whose email does not resemble their name
		RipplingEmployee egor = new RipplingEmployee("Egor Nekrasov", "Media Optimization",
				"george.smith@aidigital.com", "WEST, MPO Directors", "Media Optimization Director",
				"Anastasia Lagosha");

		// When:
		OrgResolution result = resolver.resolve(List.of(egor));

		// Then:
		ResolvedEmployee resolved = byEmail(result).get("george.smith@aidigital.com");
		assertThat(resolved.orgRole()).isEqualTo(OrgRole.DIRECTOR);
		assertThat(resolved.grade()).isEqualTo(Grade.DIRECTOR);
		assertThat(resolved.teamLeadEmail()).isNull();
		assertThat(result.teams()).isEmpty();
	}

	@Test
	void shouldAssignSeniorDirectorWithNoPodAndNoTeamTest() {
		// Given: edge case 6 - a Senior Director with no pod token and an unresolved (root) manager;
		// trailing whitespace in the title must be trimmed
		RipplingEmployee anastasia = new RipplingEmployee("Anastasia Lagosha", "Media Optimization",
				"anastacia@aidigital.com", "MPO Senior Directors", "Senior Director, Media Optimization  ",
				"Anna Nizkaya");

		// When:
		OrgResolution result = resolver.resolve(List.of(anastasia));

		// Then:
		ResolvedEmployee resolved = byEmail(result).get("anastacia@aidigital.com");
		assertThat(resolved.orgRole()).isEqualTo(OrgRole.DIRECTOR);
		assertThat(resolved.grade()).isEqualTo(Grade.SENIOR_DIRECTOR);
		assertThat(resolved.podKey()).isNull();
		assertThat(resolved.teamLeadEmail()).isNull();
	}

	@Test
	void shouldIndexManagerByNameNotEmailTest() {
		// Given: edge case 7 - Aleksandr Kuzmin's email (alex.turner@) bears no relation to his name; the
		// name index used to walk the manager chain must resolve him by name
		RipplingEmployee aleksandr = new RipplingEmployee("Aleksandr Kuzmin", "Media Optimization",
				"alex.turner@aidigital.com", "SOUTHEAST, MPO Directors", "Media Optimization Director",
				"Anastasia Lagosha");

		// When:
		Map<String, List<RipplingEmployee>> byName = resolver.indexByNormalizedName(List.of(aleksandr));

		// Then:
		assertThat(byName.get("aleksandr kuzmin"))
				.singleElement()
				.satisfies(employee -> assertThat(employee.workEmail()).isEqualTo("alex.turner@aidigital.com"));
	}

	@Test
	void shouldFlagManagerNotInRosterWhenManagerUnknownAndNoTeamTokenTest() {
		// Given: edge case 8 - the manager name is not in the roster and there is no team token to fall
		// back on; cause-split (sync-issues-admin-review-PLAN.md §2) records the specific cause instead of
		// the generic residual
		RipplingEmployee alina = new RipplingEmployee("Alina Melkonian", "Media Optimization",
				"alina.melkonian@aidigital.com", "SOUTHEAST", "Media Optimization Trainee", "Nino Dzhincharadze");

		// When:
		OrgResolution result = resolver.resolve(List.of(alina));

		// Then:
		ResolvedEmployee resolved = byEmail(result).get("alina.melkonian@aidigital.com");
		assertThat(resolved.teamLeadEmail()).isNull();
		assertThat(resolved.flags()).contains(DataQualityFlag.MANAGER_NOT_IN_ROSTER);
		assertThat(resolved.flags()).doesNotContain(DataQualityFlag.UNRESOLVED_TEAM);
	}

	@Test
	void shouldIgnoreNoiseTokenAndStillResolveGradeTest() {
		// Given: edge case 9 - "Dream Wave Cyprus" is noise and must not be treated as a pod/cohort/team
		// token; her actual manager is not part of this roster, so her team stays unresolved
		RipplingEmployee angelina = new RipplingEmployee("Angelina Kmett", "Media Optimization",
				"angelina.kmett@aidigital.com", "HOUSE , Dream Wave Cyprus, Media Optimization: Galina, MPO Seniors",
				"Senior Media Optimization Manager", "Galina Kurasheva");

		// When:
		OrgResolution result = resolver.resolve(List.of(angelina));

		// Then:
		ResolvedEmployee resolved = byEmail(result).get("angelina.kmett@aidigital.com");
		assertThat(resolved.grade()).isEqualTo(Grade.SENIOR);
		assertThat(resolved.flags()).contains(DataQualityFlag.MANAGER_NOT_IN_ROSTER);
	}

	@Test
	void shouldFlagMemberPodMismatchWithoutOverridingTeamPodTest() {
		// Given: edge case 10 - the member carries two pod tokens; the team pod comes from the TL alone
		RipplingEmployee artem = new RipplingEmployee("Artem Shapoval", "Media Optimization",
				"artemio@aidigital.com", "MIDWEST, MPO Team Leads", "Team Lead, Media Optimization", "Stacy Rivera");
		RipplingEmployee daniella = new RipplingEmployee("Daniella Predeina", "Media Optimization",
				"daniella.predeina@aidigital.com", "MIDWEST, EAST", "Media Optimization Manager", "Artem Shapoval");

		// When:
		OrgResolution result = resolver.resolve(List.of(artem, daniella));

		// Then:
		Map<String, ResolvedEmployee> byEmail = byEmail(result);
		assertThat(result.teams().getFirst().podKey()).isEqualTo("MIDWEST");
		assertThat(byEmail.get("daniella.predeina@aidigital.com").podKey()).isEqualTo("MIDWEST");
		assertThat(byEmail.get("daniella.predeina@aidigital.com").flags())
				.contains(DataQualityFlag.MEMBER_POD_MISMATCH);
	}

	@Test
	void shouldClassifyGradesFromTitleAndCrossCheckCohortTokenTest() {
		// Given: edge case 11 - Junior grade from title, cross-checked against a compatible cohort token
		RipplingEmployee andrey = new RipplingEmployee("Andrey Kort", "Media Optimization",
				"andrey.kort@aidigital.com", "WEST, MPO Team Leads", "Team Lead, Media Optimization",
				"Egor Nekrasov");
		RipplingEmployee arina = new RipplingEmployee("Arina Kolontai", "Media Optimization",
				"arina.kolontai@aidigital.com", "WEST, MPO Middles & Juniors", "Junior Media Optimization Manager",
				"Andrey Kort");

		// When:
		OrgResolution result = resolver.resolve(List.of(andrey, arina));

		// Then:
		ResolvedEmployee resolved = byEmail(result).get("arina.kolontai@aidigital.com");
		assertThat(resolved.grade()).isEqualTo(Grade.JUNIOR);
		assertThat(resolved.flags()).doesNotContain(DataQualityFlag.GRADE_COHORT_MISMATCH);
	}

	@Test
	void shouldFlagActualGradeCohortMismatchButPreferTitleTest() {
		// Given: bonus scenario - title says Middle manager, but the cohort token says Seniors
		RipplingEmployee daria = new RipplingEmployee("Daria Feofanova", "Media Optimization",
				"dory@aidigital.com", "HOUSE , MPO Team Leads", "Team Lead, Media Optimization", "Gerel Mutulova");
		RipplingEmployee member = new RipplingEmployee("Some Member", "Media Optimization",
				"some.member@aidigital.com", "HOUSE, MPO Seniors", "Media Optimization Manager", "Daria Feofanova");

		// When:
		OrgResolution result = resolver.resolve(List.of(daria, member));

		// Then:
		ResolvedEmployee resolved = byEmail(result).get("some.member@aidigital.com");
		assertThat(resolved.grade()).isEqualTo(Grade.MIDDLE);
		assertThat(resolved.flags()).contains(DataQualityFlag.GRADE_COHORT_MISMATCH);
	}

	@Test
	void shouldTrimWhitespaceAndCaseInTeamsTokensTest() {
		// Given: edge case 12 - whitespace/case noise in pod tokens and titles is trimmed
		RipplingEmployee employee = new RipplingEmployee("Some Lead", "Media Optimization",
				"some.lead@aidigital.com", "house ", "  team lead, Media Optimization  ", null);

		// When:
		OrgResolution result = resolver.resolve(List.of(employee));

		// Then:
		ResolvedEmployee resolved = byEmail(result).get("some.lead@aidigital.com");
		assertThat(resolved.orgRole()).isEqualTo(OrgRole.TEAM_LEAD);
		assertThat(resolved.podKey()).isEqualTo("HOUSE");
	}

	@Test
	void shouldCollapseThreeDuplicateBusinessPartnerRowsIntoOneEmployeeTest() {
		// Given: edge case 13 - the same employee appears 3 times (one row per business-partner group)
		RipplingEmployee row1 = new RipplingEmployee("Jane Lead", "Media Optimization", "jane@aidigital.com",
				"HOUSE , MPO Team Leads", "Team Lead, Media Optimization", "Gerel Mutulova");
		RipplingEmployee row2 = new RipplingEmployee("Jane Lead", "Media Optimization", "jane@aidigital.com",
				"HOUSE , MPO Team Leads", "Team Lead, Media Optimization", "Gerel Mutulova");
		RipplingEmployee row3 = new RipplingEmployee("Jane Lead", "Media Optimization", "jane@aidigital.com",
				"HOUSE , MPO Team Leads", "Team Lead, Media Optimization", "Gerel Mutulova");

		// When:
		OrgResolution result = resolver.resolve(List.of(row1, row2, row3));

		// Then:
		assertThat(result.employees()).hasSize(1);
		assertThat(result.teams()).hasSize(1);
	}

	@Test
	void shouldResolveViaStringFallbackWhenManagerChainFailsButTokenIsUniqueTest() {
		// Given: manager name is unknown, but the team token uniquely matches one Team Lead's first name
		RipplingEmployee dmitriy = new RipplingEmployee("Dmitriy Borodulin", "Media Optimization",
				"dmitriy.borodulin@aidigital.com", "SOUTHEAST, MPO Team Leads", "Team Lead, Media Optimization",
				"Aleksandr Kuzmin");
		RipplingEmployee member = new RipplingEmployee("Some Member", "Media Optimization",
				"some.member@aidigital.com", "Media Optimization: Dmitriy", "Media Optimization Manager",
				"Ghost Manager");

		// When:
		OrgResolution result = resolver.resolve(List.of(dmitriy, member));

		// Then:
		ResolvedEmployee resolved = byEmail(result).get("some.member@aidigital.com");
		assertThat(resolved.teamLeadEmail()).isEqualTo("dmitriy.borodulin@aidigital.com");
		assertThat(resolved.flags()).contains(DataQualityFlag.TEAM_RESOLVED_VIA_STRING_FALLBACK);
	}

	@Test
	void shouldLeaveUnresolvedWhenStringFallbackTokenIsAmbiguousTest() {
		// Given: manager unknown, and the team token ("Daria") ambiguously matches two Team Leads - the
		// plan explicitly leaves this unresolved rather than guessing
		RipplingEmployee dariaFeofanova = new RipplingEmployee("Daria Feofanova", "Media Optimization",
				"dory@aidigital.com", "HOUSE , MPO Team Leads", "Team Lead, Media Optimization", "Gerel Mutulova");
		RipplingEmployee dariaMorkunas = new RipplingEmployee("Daria Morkunas", "Media Optimization",
				"daria.morkunas@aidigital.com", "HOUSE , MPO Team Leads", "Team Lead, Media Optimization",
				"Gerel Mutulova");
		RipplingEmployee member = new RipplingEmployee("Some Member", "Media Optimization",
				"some.member@aidigital.com", "Media Optimization: Daria", "Media Optimization Manager",
				"Ghost Manager");

		// When:
		OrgResolution result = resolver.resolve(List.of(dariaFeofanova, dariaMorkunas, member));

		// Then:
		ResolvedEmployee resolved = byEmail(result).get("some.member@aidigital.com");
		assertThat(resolved.teamLeadEmail()).isNull();
		// The manager ("Ghost Manager") is not in the roster, so the specific cause is recorded; the
		// ambiguous team token cannot rescue it, so it stays unresolved (no string-fallback resolution).
		assertThat(resolved.flags()).contains(DataQualityFlag.MANAGER_NOT_IN_ROSTER);
		assertThat(resolved.flags()).doesNotContain(DataQualityFlag.TEAM_RESOLVED_VIA_STRING_FALLBACK);
	}

	@Test
	void shouldFlagDuplicateManagerNameAsUnreliableTest() {
		// Given: two employees share the exact same full name, so it cannot be trusted as a manager target
		RipplingEmployee johnSmithLead = new RipplingEmployee("John Smith", "Media Optimization",
				"john.lead@aidigital.com", "HOUSE, MPO Team Leads", "Team Lead, Media Optimization", null);
		RipplingEmployee johnSmithOther = new RipplingEmployee("John Smith", "Media Optimization",
				"john.other@aidigital.com", "HOUSE", "Media Optimization Manager", null);
		RipplingEmployee reportingToJohn = new RipplingEmployee("Some Member", "Media Optimization",
				"some.member@aidigital.com", "HOUSE", "Media Optimization Manager", "John Smith");

		// When:
		OrgResolution result = resolver.resolve(List.of(johnSmithLead, johnSmithOther, reportingToJohn));

		// Then: cause-split (sync-issues-admin-review-PLAN.md §2) - DUPLICATE_MANAGER_NAME is already the
		// one actionable cause, so the generic UNRESOLVED_TEAM residual is not also added
		ResolvedEmployee resolved = byEmail(result).get("some.member@aidigital.com");
		assertThat(resolved.teamLeadEmail()).isNull();
		assertThat(resolved.flags()).contains(DataQualityFlag.DUPLICATE_MANAGER_NAME);
		assertThat(resolved.flags()).doesNotContain(DataQualityFlag.UNRESOLVED_TEAM);
	}

	@Test
	void shouldDisambiguateDuplicateTeamNamesTest() {
		// Given: two Team Leads share both department leaf and first name
		RipplingEmployee leadA = new RipplingEmployee("Same Name", "Media Optimization", "a@aidigital.com",
				"HOUSE, MPO Team Leads", "Team Lead, Media Optimization", null);
		RipplingEmployee leadB = new RipplingEmployee("Same Name", "Media Optimization", "b@aidigital.com",
				"HOUSE, MPO Team Leads", "Team Lead, Media Optimization", null);

		// When:
		OrgResolution result = resolver.resolve(List.of(leadA, leadB));

		// Then:
		Map<String, ResolvedTeam> teamsByLead = result.teams().stream()
				.collect(java.util.stream.Collectors.toMap(ResolvedTeam::teamLeadEmail, team -> team));
		assertThat(teamsByLead.get("a@aidigital.com").teamName())
				.isNotEqualTo(teamsByLead.get("b@aidigital.com").teamName());
		assertThat(teamsByLead.get("a@aidigital.com").flags()).contains(DataQualityFlag.DUPLICATE_TEAM_NAME);
		assertThat(teamsByLead.get("b@aidigital.com").flags()).contains(DataQualityFlag.DUPLICATE_TEAM_NAME);
	}

	@Test
	void shouldFlagPodAmbiguousWhenMembersTieAndLeadHasNoSinglePodTest() {
		// Given: the Team Lead carries no pod token, and members tie 1-1 between two pods
		RipplingEmployee lead = new RipplingEmployee("Some Lead", "Media Optimization", "lead@aidigital.com",
				"MPO Team Leads", "Team Lead, Media Optimization", null);
		RipplingEmployee memberEast = new RipplingEmployee("Member East", "Media Optimization",
				"member.east@aidigital.com", "EAST", "Media Optimization Manager", "Some Lead");
		RipplingEmployee memberWest = new RipplingEmployee("Member West", "Media Optimization",
				"member.west@aidigital.com", "WEST", "Media Optimization Manager", "Some Lead");

		// When:
		OrgResolution result = resolver.resolve(List.of(lead, memberEast, memberWest));

		// Then:
		ResolvedTeam team = result.teams().getFirst();
		assertThat(team.podKey()).isNull();
		assertThat(team.flags()).contains(DataQualityFlag.POD_AMBIGUOUS);
	}

	@Test
	void shouldResolveMultiHopMemberChainThroughAMiddleManagerToTheTeamLeadTest() {
		// Given: R7 - member -> a middle MEMBER manager -> TL (every other fixture test uses a direct
		// manager==TL edge)
		RipplingEmployee teamLead = new RipplingEmployee("Chain TL", "Media Optimization",
				"chain.tl@aidigital.com", "MPO Team Leads", "Team Lead, Media Optimization", null);
		RipplingEmployee middleManager = new RipplingEmployee("Middle Manager", "Media Optimization",
				"middle.manager@aidigital.com", "", "Media Optimization Manager", "Chain TL");
		RipplingEmployee member = new RipplingEmployee("Chain Member", "Media Optimization",
				"chain.member@aidigital.com", "", "Media Optimization Manager", "Middle Manager");

		// When:
		OrgResolution result = resolver.resolve(List.of(teamLead, middleManager, member));

		// Then:
		ResolvedEmployee resolved = byEmail(result).get("chain.member@aidigital.com");
		assertThat(resolved.teamLeadEmail()).isEqualTo("chain.tl@aidigital.com");
		assertThat(resolved.flags()).doesNotContain(DataQualityFlag.UNRESOLVED_TEAM);
	}

	@Test
	void shouldFlagManagerChainHitDirectorBeforeAnyTeamLeadTest() {
		// Given: R7 - the manager chain reaches a Director with no Team Lead in between and no team token
		// to fall back on
		RipplingEmployee director = new RipplingEmployee("Some Director", "Media Optimization",
				"some.director@aidigital.com", "MPO Directors", "Media Optimization Director", null);
		RipplingEmployee member = new RipplingEmployee("Reports To Director", "Media Optimization",
				"reports.to.director@aidigital.com", "", "Media Optimization Manager", "Some Director");

		// When:
		OrgResolution result = resolver.resolve(List.of(director, member));

		// Then: cause-split (sync-issues-admin-review-PLAN.md §2)
		ResolvedEmployee resolved = byEmail(result).get("reports.to.director@aidigital.com");
		assertThat(resolved.teamLeadEmail()).isNull();
		assertThat(resolved.flags()).contains(DataQualityFlag.MANAGER_CHAIN_HIT_DIRECTOR);
		assertThat(resolved.flags()).doesNotContain(DataQualityFlag.UNRESOLVED_TEAM);
	}

	@Test
	void shouldGuardAgainstAManagerCycleWithoutInfiniteLoopingTest() {
		// Given: R7 - A manages B and B manages A; the visited-set guard must break the cycle rather than
		// loop forever
		RipplingEmployee employeeA = new RipplingEmployee("Cycle A", "Media Optimization",
				"cycle.a@aidigital.com", "", "Media Optimization Manager", "Cycle B");
		RipplingEmployee employeeB = new RipplingEmployee("Cycle B", "Media Optimization",
				"cycle.b@aidigital.com", "", "Media Optimization Manager", "Cycle A");

		// When:
		OrgResolution result = resolver.resolve(List.of(employeeA, employeeB));

		// Then: cause-split (sync-issues-admin-review-PLAN.md §2)
		Map<String, ResolvedEmployee> byEmail = byEmail(result);
		assertThat(byEmail.get("cycle.a@aidigital.com").teamLeadEmail()).isNull();
		assertThat(byEmail.get("cycle.a@aidigital.com").flags()).contains(DataQualityFlag.MANAGER_CHAIN_CYCLE);
		assertThat(byEmail.get("cycle.b@aidigital.com").teamLeadEmail()).isNull();
		assertThat(byEmail.get("cycle.b@aidigital.com").flags()).contains(DataQualityFlag.MANAGER_CHAIN_CYCLE);
	}

	@Test
	void shouldLeaveUnresolvedWhenTheTeamLeadIsBeyondTheMaxManagerChainDepthTest() {
		// Given: R7 - exactly MAX_MANAGER_CHAIN_DEPTH (10) plain-MEMBER managers stand between the subject
		// and the Team Lead, so the depth guard exhausts before the TL is ever examined
		RipplingEmployee teamLead = new RipplingEmployee("Chain TL", "Media Optimization",
				"chain.tl@aidigital.com", "MPO Team Leads", "Team Lead, Media Optimization", null);
		List<RipplingEmployee> chainManagers = new ArrayList<>();
		String managerName = teamLead.name();
		for (int i = 10; i >= 1; i--) {
			RipplingEmployee manager = new RipplingEmployee("Chain Manager " + i, "Media Optimization",
					"chain.manager" + i + "@aidigital.com", "", "Media Optimization Manager", managerName);
			chainManagers.add(manager);
			managerName = manager.name();
		}
		RipplingEmployee subject = new RipplingEmployee("Chain Subject", "Media Optimization",
				"chain.subject@aidigital.com", "", "Media Optimization Manager", managerName);

		List<RipplingEmployee> allEmployees = new ArrayList<>(chainManagers);
		allEmployees.add(teamLead);
		allEmployees.add(subject);

		// When:
		OrgResolution result = resolver.resolve(allEmployees);

		// Then: cause-split (sync-issues-admin-review-PLAN.md §2)
		ResolvedEmployee resolved = byEmail(result).get("chain.subject@aidigital.com");
		assertThat(resolved.teamLeadEmail()).isNull();
		assertThat(resolved.flags()).contains(DataQualityFlag.MANAGER_CHAIN_TOO_DEEP);
		assertThat(resolved.flags()).doesNotContain(DataQualityFlag.UNRESOLVED_TEAM);
	}

	@Test
	void shouldFlagNoTeamSignalWhenMemberHasNoManagerAndNoTeamTokenTest() {
		// Given: a member with no manager field at all (chain never starts) and no team token to fall
		// back on - distinct from MANAGER_NOT_IN_ROSTER (a named-but-unknown manager)
		RipplingEmployee rootless = new RipplingEmployee("Rootless Member", "Media Optimization",
				"rootless.member@aidigital.com", "", "Media Optimization Manager", null);

		// When:
		OrgResolution result = resolver.resolve(List.of(rootless));

		// Then:
		ResolvedEmployee resolved = byEmail(result).get("rootless.member@aidigital.com");
		assertThat(resolved.teamLeadEmail()).isNull();
		assertThat(resolved.flags()).contains(DataQualityFlag.NO_TEAM_SIGNAL);
		assertThat(resolved.flags()).doesNotContain(DataQualityFlag.UNRESOLVED_TEAM);
	}

	private Map<String, ResolvedEmployee> byEmail(OrgResolution resolution) {
		return resolution.employees().stream()
				.collect(java.util.stream.Collectors.toMap(ResolvedEmployee::workEmail, employee -> employee));
	}
}
