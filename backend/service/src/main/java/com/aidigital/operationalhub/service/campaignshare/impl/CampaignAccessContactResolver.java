package com.aidigital.operationalhub.service.campaignshare.impl;

import com.aidigital.operationalhub.domain.entity.HubAgencyOwnerOverride;
import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubTeam;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.agency.model.CampaignTeamLeadsModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignAccessContactsModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareCandidateModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharePersonRoleModel;
import com.aidigital.operationalhub.service.entity.HubAgencyOwnerOverrideService;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubTeamAgencyService;
import com.aidigital.operationalhub.service.entity.HubTeamService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.netsuite.org.NameNormalizer;
import com.aidigital.operationalhub.service.rbac.enums.RbacRoleCode;
import com.aidigital.operationalhub.service.rbac.enums.RbacScopeCode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.stream.Collectors;

/**
 * Names the people who can let somebody into a campaign they cannot open (2026-10-29), so the "no
 * access" screen can say who to write to. Anyone whose own team owns the campaign's agency can add
 * people to it - not only the Team Lead - and leads were slow to answer, so the whole team is named.
 *
 * <p>The Hub keeps agencies, not campaigns, per team ({@code hub_team_agencies}), and one agency is often
 * run by several teams. NetSuite's {@code mpo_team_lead} on the campaign tells which of them runs THIS
 * one. It is matched against the leads of the teams owning the agency only, by the same attempts the
 * sync uses to map an agency to a team ({@code NetSuiteSyncReconciler#reconcileAgencyMappings}): an
 * active owner override first, then the exact name, then the {@code first.last} email local part, then
 * the first-name local part. Looking only among the owning teams is what keeps the looser attempts from
 * picking a stranger.
 *
 * <p>When it matches, the answer is that team's people: the lead first, then whoever has logged in to the
 * Hub (they know where "Add people" is), then the rest, each group by name. When it does not, the answer
 * is every owning team's lead - a whole agency's worth of people would be a page of names.
 *
 * <p>Leavers (the sync cleared their department) and Client Services are not named. Transactional for
 * the assignments' roles, which are lazy.
 */
@Component
@RequiredArgsConstructor
public class CampaignAccessContactResolver {

	private final HubTeamAgencyService hubTeamAgencyService;
	private final HubTeamService hubTeamService;
	private final HubUserService hubUserService;
	private final HubRoleAssignmentService hubRoleAssignmentService;
	private final HubAgencyOwnerOverrideService agencyOwnerOverrideService;
	private final CampaignSharePersonDescriber personDescriber;
	private final NameNormalizer nameNormalizer;

	/**
	 * Resolves who can add a person to the campaign.
	 *
	 * @param campaign the campaign's name, agency and NetSuite Team Leads
	 * @return the people to ask; no contacts when no team owns the campaign's agency
	 */
	@Transactional(readOnly = true)
	public CampaignAccessContactsModel resolve(CampaignTeamLeadsModel campaign) {
		List<HubTeam> owningTeams = owningTeams(campaign.agencyId());
		Map<Long, HubUser> leadsById = currentLeads(owningTeams);
		if (leadsById.isEmpty()) {
			return new CampaignAccessContactsModel(
					campaign.campaignName(), campaign.mpoTeamLeads(), false, List.of());
		}
		List<HubUser> leads = List.copyOf(leadsById.values());
		Map<String, Long> leadIdByOverriddenOwnerName = overriddenOwners(leadsById.keySet());

		Set<Long> runningLeadIds = new LinkedHashSet<>();
		for (String netSuiteLead : campaign.mpoTeamLeads()) {
			Long leadId = matchLead(netSuiteLead, leads, leadIdByOverriddenOwnerName);
			if (leadId != null && leadsById.containsKey(leadId)) {
				runningLeadIds.add(leadId);
			}
		}
		if (runningLeadIds.isEmpty()) {
			return new CampaignAccessContactsModel(campaign.campaignName(), campaign.mpoTeamLeads(), false,
					toContacts(leads, leadsById.keySet()));
		}
		Set<Long> runningTeamIds = owningTeams.stream()
				.filter(team -> runningLeadIds.contains(team.getTeamLeadUserId()))
				.map(HubTeam::getId)
				.collect(Collectors.toSet());
		return new CampaignAccessContactsModel(campaign.campaignName(), campaign.mpoTeamLeads(), true,
				toContacts(teamPeople(runningTeamIds, runningLeadIds), runningLeadIds));
	}

	/**
	 * The active teams that own an agency and have a lead.
	 *
	 * @param agencyId the agency id, may be {@code null}
	 * @return the teams; empty when the agency is unknown or owned by no team
	 */
	List<HubTeam> owningTeams(Long agencyId) {
		if (agencyId == null) {
			return List.of();
		}
		Set<Long> teamIds = new HashSet<>(hubTeamAgencyService.findTeamIdsByAgencyId(agencyId));
		if (teamIds.isEmpty()) {
			return List.of();
		}
		return hubTeamService.listAllOrderedByName().stream()
				.filter(team -> teamIds.contains(team.getId()))
				.filter(team -> HubStatus.ACTIVE.getCode().equals(team.getStatus()))
				.filter(team -> team.getTeamLeadUserId() != null)
				.toList();
	}

	/**
	 * The teams' leads who are still with the company.
	 *
	 * @param teams the owning teams
	 * @return the leads by {@code hub_users.id}, each once
	 */
	Map<Long, HubUser> currentLeads(List<HubTeam> teams) {
		Set<Long> leadIds = teams.stream()
				.map(HubTeam::getTeamLeadUserId)
				.filter(Objects::nonNull)
				.collect(Collectors.toCollection(LinkedHashSet::new));
		if (leadIds.isEmpty()) {
			return Map.of();
		}
		return hubUserService.findAllByIds(leadIds).stream()
				.filter(lead -> lead.getDepartment() != null)
				.collect(Collectors.toMap(HubUser::getId, Function.identity(), (first, second) -> first,
						LinkedHashMap::new));
	}

	/**
	 * Everyone with an active role on the given teams, plus their leads - Client Services and leavers
	 * left out.
	 *
	 * @param teamIds the teams that run the campaign
	 * @param leadIds their leads, who are named even if their own assignment is somewhere else
	 * @return the people, each once
	 */
	List<HubUser> teamPeople(Set<Long> teamIds, Set<Long> leadIds) {
		Set<Long> userIds = new LinkedHashSet<>(leadIds);
		hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds(RbacScopeCode.TEAM.getCode(), teamIds).stream()
				.filter(assignment -> assignment.getRole() == null
						|| !RbacRoleCode.CLIENT_SERVICES.getCode().equals(assignment.getRole().getRoleCode()))
				.map(HubRoleAssignment::getUserId)
				.forEach(userIds::add);
		return hubUserService.findAllByIds(userIds).stream()
				.filter(person -> person.getDepartment() != null)
				.toList();
	}

	/**
	 * Orders the people - leads first, then those who have logged in to the Hub, then the rest, each
	 * group by name - and describes each by role and team.
	 *
	 * @param people  the people to name
	 * @param leadIds the leads among them
	 * @return the contacts
	 */
	List<CampaignShareCandidateModel> toContacts(List<HubUser> people, Set<Long> leadIds) {
		List<HubUser> ordered = people.stream()
				.sorted(Comparator
						.comparing((HubUser person) -> !leadIds.contains(person.getId()))
						.thenComparing(person -> !HubStatus.ACTIVE.getCode().equals(person.getStatus()))
						.thenComparing(person -> displayName(person).toLowerCase(Locale.ROOT)))
				.toList();
		Function<Long, CampaignSharePersonRoleModel> roleOf =
				personDescriber.describer(ordered.stream().map(HubUser::getId).toList());
		return ordered.stream()
				.map(person -> new CampaignShareCandidateModel(
						person.getId(), displayName(person), person.getEmail(), roleOf.apply(person.getId())))
				.toList();
	}

	/**
	 * The active owner overrides that point at one of the given leads, as the normalized NetSuite owner
	 * name each one redirects.
	 *
	 * @param leadIds the owning teams' leads
	 * @return the lead each overridden owner name belongs to
	 */
	Map<String, Long> overriddenOwners(Set<Long> leadIds) {
		List<HubAgencyOwnerOverride> overrides = agencyOwnerOverrideService.findAllByStatus(HubStatus.ACTIVE.getCode())
				.stream()
				.filter(override -> leadIds.contains(override.getTeamLeadUserId()))
				.toList();
		if (overrides.isEmpty()) {
			return Map.of();
		}
		Map<Long, HubUser> ownersById = hubUserService.findAllByIds(overrides.stream()
						.map(HubAgencyOwnerOverride::getOwnerUserId)
						.collect(Collectors.toSet()))
				.stream()
				.collect(Collectors.toMap(HubUser::getId, Function.identity(), (first, second) -> first));
		return overrides.stream()
				.filter(override -> {
					HubUser owner = ownersById.get(override.getOwnerUserId());
					return owner != null && owner.getDisplayName() != null && !owner.getDisplayName().isBlank();
				})
				.collect(Collectors.toMap(
						override -> ownerName(ownersById, override),
						HubAgencyOwnerOverride::getTeamLeadUserId,
						(first, second) -> first));
	}

	/**
	 * The normalized display name of an override's owner, already known to be present.
	 *
	 * @param ownersById the overrides' owners
	 * @param override   the override
	 * @return the owner's normalized name
	 */
	String ownerName(Map<Long, HubUser> ownersById, HubAgencyOwnerOverride override) {
		return nameNormalizer.normalize(ownersById.get(override.getOwnerUserId()).getDisplayName());
	}

	/**
	 * Finds the lead a NetSuite Team Lead name stands for, by the sync's attempts in the sync's order.
	 *
	 * @param netSuiteLead                the name as NetSuite spells it
	 * @param leads                       the owning teams' leads
	 * @param leadIdByOverriddenOwnerName the overrides among them (see {@link #overriddenOwners})
	 * @return the lead's {@code hub_users.id}, or {@code null} when none matches
	 */
	Long matchLead(String netSuiteLead, List<HubUser> leads, Map<String, Long> leadIdByOverriddenOwnerName) {
		if (netSuiteLead == null || netSuiteLead.isBlank()) {
			return null;
		}
		String normalized = nameNormalizer.normalize(netSuiteLead);
		Long overridden = leadIdByOverriddenOwnerName.get(normalized);
		if (overridden != null) {
			return overridden;
		}
		String fullNameLocalPart = normalized.replace(' ', '.');
		int space = normalized.indexOf(' ');
		String firstNameLocalPart = space < 0 ? normalized : normalized.substring(0, space);
		List<Predicate<HubUser>> attempts = List.of(
				lead -> lead.getDisplayName() != null
						&& normalized.equals(nameNormalizer.normalize(lead.getDisplayName())),
				lead -> fullNameLocalPart.equals(emailLocalPart(lead.getEmail())),
				lead -> firstNameLocalPart.equals(emailLocalPart(lead.getEmail())));
		for (Predicate<HubUser> attempt : attempts) {
			for (HubUser lead : leads) {
				if (attempt.test(lead)) {
					return lead.getId();
				}
			}
		}
		return null;
	}

	/**
	 * The lower-cased part of an email before {@code @}.
	 *
	 * @param email the email, may be {@code null}
	 * @return the local part, or an empty string for no email
	 */
	String emailLocalPart(String email) {
		if (email == null) {
			return "";
		}
		int at = email.indexOf('@');
		return (at < 0 ? email : email.substring(0, at)).toLowerCase(Locale.ROOT);
	}

	/**
	 * A person's display name, falling back to their email.
	 *
	 * @param user the person
	 * @return the name to show
	 */
	String displayName(HubUser user) {
		String name = user.getDisplayName();
		if (name != null && !name.isBlank()) {
			return name;
		}
		return user.getEmail() == null ? "" : user.getEmail();
	}
}
