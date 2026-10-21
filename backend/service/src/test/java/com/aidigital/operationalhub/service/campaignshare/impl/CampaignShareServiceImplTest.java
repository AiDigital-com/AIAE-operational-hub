package com.aidigital.operationalhub.service.campaignshare.impl;

import com.aidigital.operationalhub.domain.entity.HubCampaignShare;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
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
import com.aidigital.operationalhub.service.rbac.model.AgencyVisibility;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.access.AccessDeniedException;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link CampaignShareServiceImpl}: who may share, who may be shared with,
 * and that a share is one row per person.
 */
@ExtendWith(MockitoExtension.class)
class CampaignShareServiceImplTest {

	private static final String CLERK_ID = "user_clerk_1";
	private static final long ME = 1L;
	private static final long THEM = 2L;
	private static final long CAMPAIGN = 19813L;
	private static final long AGENCY = 500L;

	@Mock
	private CampaignService campaignService;

	@Mock
	private AgencyVisibilityService agencyVisibilityService;

	@Mock
	private RbacQueryService rbacQueryService;

	@Mock
	private HubCampaignShareService hubCampaignShareService;

	@Mock
	private HubUserService hubUserService;

	@Mock
	private CampaignSharePersonDescriber personDescriber;

	@InjectMocks
	private CampaignShareServiceImpl service;

	@Test
	void shouldShareWhenTheCallersOwnTeamOwnsTheAgencyTest() {
		// Given: an MPO manager whose team owns the campaign's agency
		givenVisibleCampaign();
		givenRoles("MPO_MANAGER");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		when(hubUserService.findAllByIds(anyCollection()))
				.thenReturn(List.of(user(THEM, "Beatris", "b@x.com"), user(ME, "Me", "me@x.com")));
		when(hubCampaignShareService.findByCampaignIdAndUserId(CAMPAIGN, THEM)).thenReturn(Optional.empty());
		when(hubCampaignShareService.save(any())).thenAnswer(call -> call.getArgument(0));

		when(personDescriber.describer(List.of(THEM)))
				.thenReturn(id -> new CampaignSharePersonRoleModel("MPO Manager", "Team Vlad"));

		// When:
		CampaignShareModel share = service.share(me(), CAMPAIGN, THEM);

		// Then: one row, naming the recipient, the granter and the recipient's role
		ArgumentCaptor<HubCampaignShare> saved = ArgumentCaptor.forClass(HubCampaignShare.class);
		verify(hubCampaignShareService).save(saved.capture());
		assertThat(saved.getValue().getCampaignId()).isEqualTo(CAMPAIGN);
		assertThat(saved.getValue().getUserId()).isEqualTo(THEM);
		assertThat(saved.getValue().getGrantedByUserId()).isEqualTo(ME);
		assertThat(share.fullName()).isEqualTo("Beatris");
		assertThat(share.grantedByName()).isEqualTo("Me");
		assertThat(share.role().roleName()).isEqualTo("MPO Manager");
		assertThat(share.role().teamName()).isEqualTo("Team Vlad");
	}

	@Test
	void shouldRefuseToShareWhatTheCallerOnlySeesThroughAShareTest() {
		// Given: the campaign is visible, but only because it was shared with the caller
		givenVisibleCampaign();
		givenRoles("MPO_MANAGER");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(), List.of(CAMPAIGN)));

		// When / Then: a share never lets its recipient share onward
		assertThatThrownBy(() -> service.share(me(), CAMPAIGN, THEM)).isInstanceOf(AccessDeniedException.class);
		verify(hubCampaignShareService, never()).save(any());
	}

	@Test
	void shouldRefuseClientServicesEvenWithAnUnrestrictedScopeTest() {
		// Given:
		givenVisibleCampaign();
		givenRoles("CLIENT_SERVICES");

		// When / Then: refused by role before visibility is even asked
		assertThatThrownBy(() -> service.unshare(me(), CAMPAIGN, THEM)).isInstanceOf(AccessDeniedException.class);
		verify(agencyVisibilityService, never()).resolveForCurrentUser(any());
	}

	@Test
	void shouldLetADirectorShareAnyCampaignTest() {
		// Given: an ALL-scoped role sees every agency
		givenVisibleCampaign();
		givenRoles("DIRECTOR");
		when(agencyVisibilityService.resolveForCurrentUser(me())).thenReturn(AgencyVisibility.unrestricted());
		HubCampaignShare existing = share(THEM);
		when(hubCampaignShareService.findByCampaignIdAndUserId(CAMPAIGN, THEM)).thenReturn(Optional.of(existing));

		// When:
		service.unshare(me(), CAMPAIGN, THEM);

		// Then:
		verify(hubCampaignShareService).delete(existing);
	}

	@Test
	void shouldReturnTheExistingShareWhenSharedAgainTest() {
		// Given: already shared with them
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		when(hubUserService.findAllByIds(anyCollection()))
				.thenReturn(List.of(user(THEM, "Beatris", "b@x.com"), user(ME, "Me", "me@x.com")));
		when(hubCampaignShareService.findByCampaignIdAndUserId(CAMPAIGN, THEM)).thenReturn(Optional.of(share(THEM)));

		when(personDescriber.describer(List.of(THEM))).thenReturn(id -> CampaignSharePersonRoleModel.none());

		// When:
		CampaignShareModel share = service.share(me(), CAMPAIGN, THEM);

		// Then: no second row
		verify(hubCampaignShareService, never()).save(any());
		assertThat(share.hubUserId()).isEqualTo(THEM);
	}

	@Test
	void shouldRefuseSharingWithYourselfTest() {
		// Given:
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));

		// When / Then:
		assertThatThrownBy(() -> service.share(me(), CAMPAIGN, ME))
				.isInstanceOf(BusinessException.class)
				.hasMessage(OperationalHubErrorReason.OPH_067.getDescription());
	}

	@Test
	void shouldRefuseAnUnknownRecipientTest() {
		// Given:
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		when(hubUserService.findAllByIds(List.of(99L))).thenReturn(List.of());

		// When / Then:
		assertThatThrownBy(() -> service.share(me(), CAMPAIGN, 99L))
				.isInstanceOf(BusinessException.class)
				.hasMessage(String.format(OperationalHubErrorReason.OPH_066.getDescription(), 99L));
	}

	@Test
	void shouldListSharesAndTellWhetherTheCallerMayEditThemTest() {
		// Given: a recipient looking at the list
		givenVisibleCampaign();
		givenRoles("MPO_MANAGER");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(), List.of(CAMPAIGN)));
		when(hubCampaignShareService.findByCampaignId(CAMPAIGN)).thenReturn(List.of(share(ME)));
		when(hubUserService.findAllByIds(anyCollection()))
				.thenReturn(List.of(user(ME, "Me", "me@x.com"), user(THEM, "Beatris", "b@x.com")));
		when(personDescriber.describer(List.of(ME))).thenReturn(id -> new CampaignSharePersonRoleModel("Team Lead", null));

		// When:
		CampaignSharesModel shares = service.listShares(me(), CAMPAIGN);

		// Then: they see who else is on it, but get no "Add people"
		assertThat(shares.canShare()).isFalse();
		assertThat(shares.shares()).hasSize(1);
		assertThat(shares.shares().getFirst().fullName()).isEqualTo("Me");
		assertThat(shares.shares().getFirst().grantedByName()).isEqualTo("Beatris");
		assertThat(shares.shares().getFirst().role().roleName()).isEqualTo("Team Lead");
	}

	@Test
	void shouldListCandidatesWithoutTheCallerOrPeopleAlreadyOnTheCampaignTest() {
		// Given:
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		when(hubCampaignShareService.findByCampaignId(CAMPAIGN)).thenReturn(List.of(share(THEM)));
		when(hubUserService.findAll()).thenReturn(List.of(
				user(ME, "Me", "me@x.com"),
				user(THEM, "Beatris", "b@x.com"),
				user(3L, "Zlatan", "zlatan@x.com"),
				user(4L, "Anna", "anna@x.com")));

		when(personDescriber.describer(any())).thenReturn(id -> CampaignSharePersonRoleModel.none());

		// When: no search, then a search by email fragment
		List<CampaignShareCandidateModel> all = service.listCandidates(me(), CAMPAIGN, " ");
		List<CampaignShareCandidateModel> byEmail = service.listCandidates(me(), CAMPAIGN, "ZLAT");

		// Then: by name, minus me and minus Beatris
		assertThat(all).extracting(CampaignShareCandidateModel::fullName).containsExactly("Anna", "Zlatan");
		assertThat(byEmail).extracting(CampaignShareCandidateModel::hubUserId).containsExactly(3L);
	}

	@Test
	void shouldIgnoreRemovingAShareThatDoesNotExistTest() {
		// Given:
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		when(hubCampaignShareService.findByCampaignIdAndUserId(CAMPAIGN, THEM)).thenReturn(Optional.empty());

		// When:
		service.unshare(me(), CAMPAIGN, THEM);

		// Then:
		verify(hubCampaignShareService, never()).delete(any());
	}

	private void givenVisibleCampaign() {
		when(campaignService.getVisibleCampaignIdentity(me(), CAMPAIGN)).thenReturn(
				new CampaignModel(CAMPAIGN, "Fox Factory Ridetech", 7L, "Fox", AGENCY, "Agency", null, null, null,
						null, List.of(), null, null));
	}

	private void givenRoles(String... roleCodes) {
		when(rbacQueryService.getEffectiveAccess(CLERK_ID))
				.thenReturn(new EffectiveAccessContext(CLERK_ID, ME, Set.of(roleCodes), List.of(), false, false));
	}

	private static CurrentUserModel me() {
		return new CurrentUserModel(ME, CLERK_ID, "me@x.com", "Me", "ACTIVE");
	}

	private static HubUser user(long id, String name, String email) {
		HubUser user = new HubUser();
		user.setId(id);
		user.setDisplayName(name);
		user.setEmail(email);
		return user;
	}

	private static HubCampaignShare share(long userId) {
		HubCampaignShare share = new HubCampaignShare();
		share.setId(10L);
		share.setCampaignId(CAMPAIGN);
		share.setUserId(userId);
		share.setGrantedByUserId(userId == ME ? THEM : ME);
		return share;
	}
}
