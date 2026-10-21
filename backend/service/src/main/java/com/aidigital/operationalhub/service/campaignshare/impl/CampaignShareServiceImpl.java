package com.aidigital.operationalhub.service.campaignshare.impl;

import com.aidigital.operationalhub.domain.entity.HubCampaignShare;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.campaignshare.CampaignShareService;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareCandidateModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharePersonRoleModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharesModel;
import com.aidigital.operationalhub.service.entity.HubCampaignShareService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.AgencyVisibilityService;
import com.aidigital.operationalhub.service.rbac.RbacQueryService;
import com.aidigital.operationalhub.service.rbac.enums.RbacRoleCode;
import com.aidigital.operationalhub.service.rbac.model.AgencyVisibility;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Default {@link CampaignShareService}.
 *
 * <p>The right to share is decided from {@link AgencyVisibility#ownsAgency(Long)}: the agency set of a
 * visibility is the person's OWN scope (admin, ALL, the team's agencies), never what was shared with
 * them - so a recipient cannot share onward. Client Services is refused by role.
 *
 * <p>Changing a share changes the recipient's cached visibility, so {@code share} and {@code unshare}
 * evict their entry of {@link AgencyVisibilityService#AGENCY_VISIBILITY_CACHE} explicitly - the same
 * discipline role assignment follows - on top of the entity-change eviction the cache registry wires.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CampaignShareServiceImpl implements CampaignShareService {

	static final int CANDIDATE_LIMIT = 20;

	private final CampaignService campaignService;
	private final AgencyVisibilityService agencyVisibilityService;
	private final RbacQueryService rbacQueryService;
	private final HubCampaignShareService hubCampaignShareService;
	private final HubUserService hubUserService;
	private final CampaignSharePersonDescriber personDescriber;

	@Override
	public CampaignSharesModel listShares(CurrentUserModel user, long campaignId) {
		CampaignModel campaign = campaignService.getVisibleCampaignIdentity(user, campaignId);
		List<HubCampaignShare> shares = hubCampaignShareService.findByCampaignId(campaignId);
		Map<Long, HubUser> usersById = usersById(shares);
		Function<Long, CampaignSharePersonRoleModel> roleOf =
				personDescriber.describer(shares.stream().map(HubCampaignShare::getUserId).toList());
		List<CampaignShareModel> rows = shares.stream()
				.map(share -> toModel(share, usersById, roleOf.apply(share.getUserId())))
				.toList();
		return new CampaignSharesModel(canShare(user, campaign), rows);
	}

	@Override
	public List<CampaignShareCandidateModel> listCandidates(CurrentUserModel user, long campaignId, String query) {
		requireCanShare(user, campaignId);
		Set<Long> excluded = new HashSet<>();
		excluded.add(user.id());
		hubCampaignShareService.findByCampaignId(campaignId).forEach(share -> excluded.add(share.getUserId()));
		String needle = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
		List<HubUser> page = hubUserService.findAll().stream()
				.filter(candidate -> !excluded.contains(candidate.getId()))
				.filter(candidate -> matches(candidate, needle))
				.sorted(Comparator.comparing(
						candidate -> displayName(candidate).toLowerCase(Locale.ROOT)))
				.limit(CANDIDATE_LIMIT)
				.toList();
		Function<Long, CampaignSharePersonRoleModel> roleOf =
				personDescriber.describer(page.stream().map(HubUser::getId).toList());
		return page.stream()
				.map(candidate -> new CampaignShareCandidateModel(
						candidate.getId(), displayName(candidate), candidate.getEmail(),
						roleOf.apply(candidate.getId())))
				.toList();
	}

	@Override
	@CacheEvict(cacheNames = AgencyVisibilityService.AGENCY_VISIBILITY_CACHE, key = "#hubUserId")
	public CampaignShareModel share(CurrentUserModel user, long campaignId, long hubUserId) {
		requireCanShare(user, campaignId);
		if (user.id() != null && user.id() == hubUserId) {
			throw new BusinessException(OperationalHubErrorReason.OPH_067);
		}
		HubUser recipient = hubUserService.findAllByIds(List.of(hubUserId)).stream()
				.findFirst()
				.orElseThrow(() -> new BusinessException(OperationalHubErrorReason.OPH_066, hubUserId));
		Optional<HubCampaignShare> existing = hubCampaignShareService.findByCampaignIdAndUserId(campaignId, hubUserId);
		HubCampaignShare share = existing.orElseGet(() -> {
			HubCampaignShare created = new HubCampaignShare();
			created.setCampaignId(campaignId);
			created.setUserId(hubUserId);
			created.setGrantedByUserId(user.id());
			HubCampaignShare saved = hubCampaignShareService.save(created);
			log.info("Campaign shared: campaignId={}, withUserId={}, byUserId={}", campaignId, hubUserId, user.id());
			return saved;
		});
		Map<Long, HubUser> usersById = usersById(List.of(share));
		usersById.putIfAbsent(hubUserId, recipient);
		return toModel(share, usersById, personDescriber.describer(List.of(hubUserId)).apply(hubUserId));
	}

	@Override
	@CacheEvict(cacheNames = AgencyVisibilityService.AGENCY_VISIBILITY_CACHE, key = "#hubUserId")
	public void unshare(CurrentUserModel user, long campaignId, long hubUserId) {
		requireCanShare(user, campaignId);
		hubCampaignShareService.findByCampaignIdAndUserId(campaignId, hubUserId).ifPresent(share -> {
			hubCampaignShareService.delete(share);
			log.info("Campaign share removed: campaignId={}, fromUserId={}, byUserId={}",
					campaignId, hubUserId, user.id());
		});
	}

	/**
	 * Resolves the campaign (404 when the user cannot see it at all) and refuses when they may not
	 * share it.
	 *
	 * @param user       the current user
	 * @param campaignId the NetSuite campaign id
	 * @throws AccessDeniedException when the campaign is visible but not shareable by this user
	 */
	void requireCanShare(CurrentUserModel user, long campaignId) {
		CampaignModel campaign = campaignService.getVisibleCampaignIdentity(user, campaignId);
		if (!canShare(user, campaign)) {
			throw new AccessDeniedException("User may not share campaign: " + campaignId);
		}
	}

	/**
	 * Tells whether the user's own scope - not a share - covers the campaign, and their role is one
	 * that may share (Client Services may not).
	 *
	 * @param user     the current user
	 * @param campaign the campaign, already resolved as visible
	 * @return {@code true} when the user may add or remove people on the campaign
	 */
	boolean canShare(CurrentUserModel user, CampaignModel campaign) {
		Set<String> roleCodes = rbacQueryService.getEffectiveAccess(user.clerkUserId()).roleCodes();
		if (roleCodes.contains(RbacRoleCode.CLIENT_SERVICES.getCode())) {
			return false;
		}
		AgencyVisibility visibility = agencyVisibilityService.resolveForCurrentUser(user);
		return visibility.ownsAgency(campaign.agencyId());
	}

	/**
	 * Loads every user a list of shares refers to - recipients and granters - in one query.
	 *
	 * @param shares the shares
	 * @return the users by {@code hub_users.id}
	 */
	Map<Long, HubUser> usersById(List<HubCampaignShare> shares) {
		Set<Long> ids = new LinkedHashSet<>();
		for (HubCampaignShare share : shares) {
			ids.add(share.getUserId());
			ids.add(share.getGrantedByUserId());
		}
		if (ids.isEmpty()) {
			return Map.of();
		}
		return hubUserService.findAllByIds(ids).stream()
				.collect(Collectors.toMap(HubUser::getId, Function.identity(), (a, b) -> a, HashMap::new));
	}

	/**
	 * Maps one share to its list row, naming the recipient and the granter from the preloaded users.
	 *
	 * @param share     the share
	 * @param usersById the users the share refers to
	 * @param role      the recipient's current role and team
	 * @return the row
	 */
	CampaignShareModel toModel(
			HubCampaignShare share, Map<Long, HubUser> usersById, CampaignSharePersonRoleModel role) {
		HubUser recipient = usersById.get(share.getUserId());
		HubUser granter = usersById.get(share.getGrantedByUserId());
		return new CampaignShareModel(
				share.getUserId(),
				recipient == null ? null : displayName(recipient),
				recipient == null ? null : recipient.getEmail(),
				role,
				granter == null ? null : displayName(granter),
				share.getCreatedAt());
	}

	/**
	 * Tells whether a candidate's name or email contains the search fragment; an empty fragment
	 * matches everyone.
	 *
	 * @param candidate the user
	 * @param needle    the lower-cased fragment
	 * @return {@code true} when the user matches
	 */
	boolean matches(HubUser candidate, String needle) {
		if (needle.isEmpty()) {
			return true;
		}
		String email = candidate.getEmail() == null ? "" : candidate.getEmail().toLowerCase(Locale.ROOT);
		return displayName(candidate).toLowerCase(Locale.ROOT).contains(needle) || email.contains(needle);
	}

	/**
	 * A user's name for display, falling back to the email when no name was synced.
	 *
	 * @param user the user
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
