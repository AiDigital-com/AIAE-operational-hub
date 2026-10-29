package com.aidigital.operationalhub.service.campaignshare.impl;

import com.aidigital.operationalhub.domain.entity.HubCampaignShare;
import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.CampaignShareSource;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.externalservices.pacing.PacingCampaignAccessClient;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignPacing;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignRef;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharePacingModel;
import com.aidigital.operationalhub.service.netsuite.org.MpoDepartmentPolicy;
import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.model.CampaignTeamLeadsModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignAccessContactsModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareCandidateModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharePersonRoleModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharesModel;
import com.aidigital.operationalhub.service.entity.HubCampaignShareService;
import com.aidigital.operationalhub.service.entity.HubRoleAssignmentService;
import com.aidigital.operationalhub.service.entity.HubTeamAgencyService;
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

import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
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
	private static final String DEPARTMENT = "Media & Performance Optimization > Media Optimization";
	private static final String MY_PACING_USER_ID = "11111111-1111-1111-1111-111111111111";
	private static final String THEIR_PACING_USER_ID = "22222222-2222-2222-2222-222222222222";

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

	@Mock
	private MpoDepartmentPolicy mpoDepartmentPolicy;

	@Mock
	private CampaignShareTeamMembers teamMembers;

	@Mock
	private HubTeamAgencyService hubTeamAgencyService;

	@Mock
	private HubRoleAssignmentService hubRoleAssignmentService;

	@Mock
	private PacingCampaignAccessClient pacingCampaignAccessClient;

	@Mock
	private CampaignShareGrantWriter grantWriter;

	@Mock
	private CampaignAccessContactResolver accessContactResolver;

	@InjectMocks
	private CampaignShareServiceImpl service;

	@Test
	void shouldNameWhoToAskForACampaignTheCallerCannotOpenTest() {
		// Given: NetSuite says Sam Marley runs the campaign, and his team's lead resolves
		CampaignTeamLeadsModel leads = new CampaignTeamLeadsModel(CAMPAIGN, "Fox", AGENCY, List.of("Sam Marley"));
		when(campaignService.findCampaignTeamLeads(CAMPAIGN)).thenReturn(Optional.of(leads));
		CampaignShareCandidateModel sam = new CampaignShareCandidateModel(
				THEM, "Saveliy Maslakov", "sam.marley@x.com", new CampaignSharePersonRoleModel("Team Lead", "Team S"));
		CampaignAccessContactsModel resolved =
				new CampaignAccessContactsModel("Fox", List.of("Sam Marley"), true, List.of(sam));
		when(accessContactResolver.resolve(leads)).thenReturn(resolved);

		// When:
		CampaignAccessContactsModel result = service.listAccessContacts(me(), CAMPAIGN);

		// Then: the resolver's answer, with no visibility check on the way
		assertThat(result).isEqualTo(resolved);
		verifyNoInteractions(agencyVisibilityService);
	}

	@Test
	void shouldRefuseToNameAnyoneForAnUnknownCampaignTest() {
		// Given:
		when(campaignService.findCampaignTeamLeads(CAMPAIGN)).thenReturn(Optional.empty());

		// When-Then:
		assertThatThrownBy(() -> service.listAccessContacts(me(), CAMPAIGN))
				.isInstanceOf(BusinessException.class)
				.extracting("code").isEqualTo(OperationalHubErrorReason.OPH_025.getCode());
		verifyNoInteractions(accessContactResolver);
	}

	@Test
	void shouldShareWhenTheCallersOwnTeamOwnsTheAgencyTest() {
		// Given: an MPO manager whose team owns the campaign's agency
		givenVisibleCampaign();
		givenRoles("MPO_MANAGER");
		givenMpo();
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
		assertThatThrownBy(() -> service.unshare(me(), CAMPAIGN, THEM, false)).isInstanceOf(AccessDeniedException.class);
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
		service.unshare(me(), CAMPAIGN, THEM, false);

		// Then:
		verify(hubCampaignShareService).delete(existing);
	}

	@Test
	void shouldReturnTheExistingShareWhenSharedAgainTest() {
		// Given: already shared with them
		givenVisibleCampaign();
		givenRoles("TL");
		givenMpo();
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
		givenMpo();
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
	void shouldRefuseSharingWithSomeoneNoLongerInRipplingTest() {
		// Given: a leaver - the sync cleared their department when they dropped out of Rippling
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		HubUser leaver = user(THEM, "Beatris", "b@x.com");
		leaver.setDepartment(null);
		when(hubUserService.findAllByIds(anyCollection())).thenReturn(List.of(leaver));

		// When-Then:
		assertThatThrownBy(() -> service.share(me(), CAMPAIGN, THEM))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("not a current employee");
		verify(hubCampaignShareService, never()).save(any());
	}

	@Test
	void shouldRefuseSharingWithSomeoneOutsideMpoTest() {
		// Given: an active Client Services person - visible in the Hub, but not MPO
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		HubUser outsider = user(THEM, "Beatris", "b@x.com");
		outsider.setDepartment("Client Services");
		when(hubUserService.findAllByIds(anyCollection())).thenReturn(List.of(outsider));
		when(mpoDepartmentPolicy.isMpo("Client Services")).thenReturn(false);

		// When-Then:
		assertThatThrownBy(() -> service.share(me(), CAMPAIGN, THEM))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("outside MPO");
		verify(hubCampaignShareService, never()).save(any());
	}

	@Test
	void shouldShareWithSomeoneOutsideMpoWhoHoldsARoleOnATeamWithAgenciesTest() {
		// Given: a Product person an admin made a manager on an MPO team
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		HubUser member = user(THEM, "Beatris", "b@x.com");
		member.setDepartment("Product & Innovation");
		when(hubUserService.findAllByIds(anyCollection())).thenReturn(List.of(member));
		when(mpoDepartmentPolicy.isMpo("Product & Innovation")).thenReturn(false);
		when(teamMembers.userIds()).thenReturn(Set.of(THEM));
		when(hubCampaignShareService.findByCampaignIdAndUserId(CAMPAIGN, THEM)).thenReturn(Optional.empty());
		when(hubCampaignShareService.save(any())).thenAnswer(call -> call.getArgument(0));
		when(personDescriber.describer(List.of(THEM))).thenReturn(id -> CampaignSharePersonRoleModel.none());

		// When:
		service.share(me(), CAMPAIGN, THEM);

		// Then:
		verify(hubCampaignShareService).save(any());
	}

	@Test
	void shouldOfferSomeoneOutsideMpoWhoHoldsARoleOnATeamWithAgenciesTest() {
		// Given: two Product people, only one of them on a team that owns agencies
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		when(hubCampaignShareService.findByCampaignId(CAMPAIGN)).thenReturn(List.of());
		HubUser member = user(THEM, "Beatris", "b@x.com");
		member.setDepartment("Product & Innovation");
		HubUser outsider = user(3L, "Carl", "carl@x.com");
		outsider.setDepartment("Product & Innovation");
		when(mpoDepartmentPolicy.isMpo("Product & Innovation")).thenReturn(false);
		when(teamMembers.userIds()).thenReturn(Set.of(THEM));
		when(hubUserService.findAll()).thenReturn(List.of(member, outsider));
		when(personDescriber.describer(any())).thenReturn(id -> CampaignSharePersonRoleModel.none());

		// When:
		List<CampaignShareCandidateModel> candidates = service.listCandidates(me(), CAMPAIGN, "");

		// Then:
		assertThat(candidates).extracting(CampaignShareCandidateModel::hubUserId).containsExactly(THEM);
	}

	@Test
	void shouldHideLeaversAndNonMpoPeopleButNotThoseWhoNeverLoggedInFromTheCandidatesTest() {
		// Given: a leaver, an outsider, and an MPO colleague who has never logged in to the Hub
		givenVisibleCampaign();
		givenRoles("TL");
		givenMpo();
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		when(hubCampaignShareService.findByCampaignId(CAMPAIGN)).thenReturn(List.of());
		HubUser leaver = user(3L, "Zlatan", "zlatan@x.com");
		leaver.setDepartment(null);
		HubUser outsider = user(4L, "Anna", "anna@x.com");
		outsider.setDepartment("Growth");
		when(mpoDepartmentPolicy.isMpo("Growth")).thenReturn(false);
		HubUser neverLoggedIn = user(5L, "Carl", "carl@x.com");
		neverLoggedIn.setStatus(HubStatus.INACTIVE.getCode());
		when(hubUserService.findAll())
				.thenReturn(List.of(user(THEM, "Beatris", "b@x.com"), leaver, outsider, neverLoggedIn));
		when(personDescriber.describer(any())).thenReturn(id -> CampaignSharePersonRoleModel.none());

		// When:
		List<CampaignShareCandidateModel> candidates = service.listCandidates(me(), CAMPAIGN, "");

		// Then:
		assertThat(candidates).extracting(CampaignShareCandidateModel::hubUserId).containsExactly(THEM, 5L);
	}

	@Test
	void shouldRefuseRemovingSomeoneWhoOwnsPacingsUntilTheTransferIsConfirmedTest() {
		// Given: the person owns one pacing on the campaign and the remover has not confirmed
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		when(hubCampaignShareService.findByCampaignIdAndUserId(CAMPAIGN, THEM)).thenReturn(Optional.of(share(THEM)));
		when(hubUserService.findAllByIds(List.of(THEM))).thenReturn(List.of(pacingUser(THEM, "Beatris", THEIR_PACING_USER_ID)));
		when(pacingCampaignAccessClient.listPacingsOnCampaign(String.valueOf(CAMPAIGN), THEIR_PACING_USER_ID))
				.thenReturn(List.of(pacing("p1", "Fox 2026", String.valueOf(CAMPAIGN), "777")));

		// When-Then: a 409-mapped refusal naming the person and the count, and nothing deleted or moved
		assertThatThrownBy(() -> service.unshare(me(), CAMPAIGN, THEM, false))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("Beatris owns 1 pacing(s)");
		verify(hubCampaignShareService, never()).delete(any());
		verify(pacingCampaignAccessClient, never()).transferOwnerAsSystem(any(), any(), any());
	}

	@Test
	void shouldTransferThePacingsToTheRemoverThenDeleteTheShareTest() {
		// Given: confirmed; the person owns two pacings on the campaign, one spanning another campaign
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		HubCampaignShare theirShare = share(THEM);
		when(hubCampaignShareService.findByCampaignIdAndUserId(CAMPAIGN, THEM)).thenReturn(Optional.of(theirShare));
		when(hubUserService.findAllByIds(List.of(THEM))).thenReturn(List.of(pacingUser(THEM, "Beatris", THEIR_PACING_USER_ID)));
		when(hubUserService.findAllByIds(List.of(ME))).thenReturn(List.of(pacingUser(ME, "Me", MY_PACING_USER_ID)));
		when(pacingCampaignAccessClient.listPacingsOnCampaign(String.valueOf(CAMPAIGN), THEIR_PACING_USER_ID))
				.thenReturn(List.of(
						pacing("p1", "Fox 2026", String.valueOf(CAMPAIGN), "777"),
						pacing("p2", "Fox Q4", String.valueOf(CAMPAIGN))));

		// When:
		service.unshare(me(), CAMPAIGN, THEM, true);

		// Then: both pacings move to me, under my email for the journal, before the share goes; and I am
		// put on every campaign they span as a pacing-created share
		org.mockito.InOrder inOrder = org.mockito.Mockito.inOrder(pacingCampaignAccessClient, hubCampaignShareService);
		inOrder.verify(pacingCampaignAccessClient).transferOwnerAsSystem("p1", MY_PACING_USER_ID, "me@x.com");
		inOrder.verify(pacingCampaignAccessClient).transferOwnerAsSystem("p2", MY_PACING_USER_ID, "me@x.com");
		inOrder.verify(hubCampaignShareService).delete(theirShare);
		ArgumentCaptor<java.util.Collection<Long>> campaigns = ArgumentCaptor.forClass(java.util.Collection.class);
		verify(grantWriter).grant(eq(ME), eq(ME), campaigns.capture(), eq(CampaignShareSource.PACING_CREATED));
		assertThat(campaigns.getValue()).containsExactly(777L, CAMPAIGN);
	}

	@Test
	void shouldRefuseTheTransferWhenTheRemoverHasNoPacingAccountTest() {
		// Given: confirmed, but Pacing does not know me yet (no pacing_user_id)
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		when(hubCampaignShareService.findByCampaignIdAndUserId(CAMPAIGN, THEM)).thenReturn(Optional.of(share(THEM)));
		when(hubUserService.findAllByIds(List.of(THEM))).thenReturn(List.of(pacingUser(THEM, "Beatris", THEIR_PACING_USER_ID)));
		when(hubUserService.findAllByIds(List.of(ME))).thenReturn(List.of(user(ME, "Me", "me@x.com")));
		when(pacingCampaignAccessClient.listPacingsOnCampaign(String.valueOf(CAMPAIGN), THEIR_PACING_USER_ID))
				.thenReturn(List.of(pacing("p1", "Fox 2026", String.valueOf(CAMPAIGN))));

		// When-Then:
		assertThatThrownBy(() -> service.unshare(me(), CAMPAIGN, THEM, true))
				.isInstanceOf(BusinessException.class)
				.hasMessageContaining("Pacing does not know your account");
		verify(hubCampaignShareService, never()).delete(any());
		verify(pacingCampaignAccessClient, never()).transferOwnerAsSystem(any(), any(), any());
	}

	@Test
	void shouldKeepTheShareWhenPacingRefusesATransferTest() {
		// Given: Pacing answers 404 for the pacing - the share must survive
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		when(hubCampaignShareService.findByCampaignIdAndUserId(CAMPAIGN, THEM)).thenReturn(Optional.of(share(THEM)));
		when(hubUserService.findAllByIds(List.of(THEM))).thenReturn(List.of(pacingUser(THEM, "Beatris", THEIR_PACING_USER_ID)));
		when(hubUserService.findAllByIds(List.of(ME))).thenReturn(List.of(pacingUser(ME, "Me", MY_PACING_USER_ID)));
		when(pacingCampaignAccessClient.listPacingsOnCampaign(String.valueOf(CAMPAIGN), THEIR_PACING_USER_ID))
				.thenReturn(List.of(pacing("p1", "Fox 2026", String.valueOf(CAMPAIGN))));
		org.mockito.Mockito.doThrow(new PacingExternalException(PacingFailureReason.UPSTREAM_NOT_FOUND, "gone"))
				.when(pacingCampaignAccessClient).transferOwnerAsSystem("p1", MY_PACING_USER_ID, "me@x.com");

		// When-Then:
		assertThatThrownBy(() -> service.unshare(me(), CAMPAIGN, THEM, true))
				.isInstanceOf(PacingExternalException.class);
		verify(hubCampaignShareService, never()).delete(any());
		verify(grantWriter, never()).grant(any(), any(), any(), any());
	}

	@Test
	void shouldRemoveSomeoneWithNoPacingsWithoutAskingPacingTest() {
		// Given: the person has no Pacing account at all, so nothing can be theirs there
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		HubCampaignShare theirShare = share(THEM);
		when(hubCampaignShareService.findByCampaignIdAndUserId(CAMPAIGN, THEM)).thenReturn(Optional.of(theirShare));
		when(hubUserService.findAllByIds(List.of(THEM))).thenReturn(List.of(user(THEM, "Beatris", "b@x.com")));

		// When:
		service.unshare(me(), CAMPAIGN, THEM, false);

		// Then:
		verify(hubCampaignShareService).delete(theirShare);
		verifyNoInteractions(pacingCampaignAccessClient);
	}

	@Test
	void shouldListThePacingsAPersonOwnsOnTheCampaignTest() {
		// Given:
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		when(hubUserService.findAllByIds(List.of(THEM))).thenReturn(List.of(pacingUser(THEM, "Beatris", THEIR_PACING_USER_ID)));
		when(pacingCampaignAccessClient.listPacingsOnCampaign(String.valueOf(CAMPAIGN), THEIR_PACING_USER_ID))
				.thenReturn(List.of(pacing("p1", "Fox 2026", String.valueOf(CAMPAIGN), "777")));

		// When:
		List<CampaignSharePacingModel> pacings = service.listOwnedPacings(me(), CAMPAIGN, THEM);

		// Then:
		assertThat(pacings).hasSize(1);
		assertThat(pacings.getFirst().pacingName()).isEqualTo("Fox 2026");
		assertThat(pacings.getFirst().campaigns()).extracting(c -> c.id()).containsExactly(String.valueOf(CAMPAIGN), "777");
	}

	@Test
	void shouldListTheOwningTeamsPeopleOnceAndWithoutLeaversTest() {
		// Given: two teams own the agency; THEM is also shared with, 4 has left, 5 and 6 are on the teams
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		when(hubCampaignShareService.findByCampaignId(CAMPAIGN)).thenReturn(List.of(share(THEM)));
		when(hubTeamAgencyService.findTeamIdsByAgencyId(AGENCY)).thenReturn(List.of(7L, 8L));
		when(hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds("TEAM", List.of(7L, 8L)))
				.thenReturn(List.of(assignment(THEM), assignment(4L), assignment(5L), assignment(6L)));
		HubUser leaver = user(4L, "Lena", "lena@x.com");
		leaver.setDepartment(null);
		when(hubUserService.findAllByIds(anyCollection())).thenAnswer(call -> {
			Collection<Long> ids = call.getArgument(0);
			return List.of(user(ME, "Me", "me@x.com"), user(THEM, "Beatris", "b@x.com"), leaver,
					user(5L, "Zoe", "zoe@x.com"), user(6L, "Galina", "galina@x.com")).stream()
					.filter(person -> ids.contains(person.getId()))
					.toList();
		});
		when(personDescriber.describer(any())).thenReturn(id -> id == 6L
				? new CampaignSharePersonRoleModel("Team Lead", "Team Galina")
				: CampaignSharePersonRoleModel.none());

		// When:
		CampaignSharesModel shares = service.listShares(me(), CAMPAIGN);

		// Then: by name, the shared person only on the share list
		assertThat(shares.teamAccess()).extracting(CampaignShareCandidateModel::hubUserId).containsExactly(6L, 5L);
		assertThat(shares.teamAccess().getFirst().role().teamName()).isEqualTo("Team Galina");
	}

	@Test
	void shouldListNoTeamAccessWhenNoTeamOwnsTheAgencyTest() {
		// Given:
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		when(hubCampaignShareService.findByCampaignId(CAMPAIGN)).thenReturn(List.of());
		when(hubTeamAgencyService.findTeamIdsByAgencyId(AGENCY)).thenReturn(List.of());

		// When:
		CampaignSharesModel shares = service.listShares(me(), CAMPAIGN);

		// Then:
		assertThat(shares.teamAccess()).isEmpty();
		verifyNoInteractions(hubRoleAssignmentService);
	}

	@Test
	void shouldListNoTeamAccessWhenEveryTeammateIsSharedWithAlreadyTest() {
		// Given:
		givenVisibleCampaign();
		givenRoles("TL");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		when(hubCampaignShareService.findByCampaignId(CAMPAIGN)).thenReturn(List.of(share(THEM)));
		when(hubUserService.findAllByIds(anyCollection()))
				.thenReturn(List.of(user(ME, "Me", "me@x.com"), user(THEM, "Beatris", "b@x.com")));
		when(personDescriber.describer(any())).thenReturn(id -> CampaignSharePersonRoleModel.none());
		when(hubTeamAgencyService.findTeamIdsByAgencyId(AGENCY)).thenReturn(List.of(7L));
		when(hubRoleAssignmentService.findActiveByScopeTypeCodeAndScopeIds("TEAM", List.of(7L)))
				.thenReturn(List.of(assignment(THEM)));

		// When:
		CampaignSharesModel shares = service.listShares(me(), CAMPAIGN);

		// Then:
		assertThat(shares.teamAccess()).isEmpty();
	}

	@Test
	void shouldReadAShareSourceBackAndDefaultOldRowsToManualTest() {
		// Given: one automatic row and one row from before the column existed
		givenVisibleCampaign();
		givenRoles("MPO_MANAGER");
		when(agencyVisibilityService.resolveForCurrentUser(me()))
				.thenReturn(AgencyVisibility.restrictedTo(List.of(AGENCY)));
		HubCampaignShare automatic = share(THEM);
		automatic.setSource(CampaignShareSource.PACING_CREATED.getCode());
		HubCampaignShare legacy = share(3L);
		legacy.setSource(null);
		when(hubCampaignShareService.findByCampaignId(CAMPAIGN)).thenReturn(List.of(automatic, legacy));
		when(hubUserService.findAllByIds(anyCollection())).thenReturn(List.of(
				user(ME, "Me", "me@x.com"), user(THEM, "Beatris", "b@x.com"), user(3L, "Zlatan", "z@x.com")));
		when(personDescriber.describer(any())).thenReturn(id -> CampaignSharePersonRoleModel.none());

		// When:
		CampaignSharesModel shares = service.listShares(me(), CAMPAIGN);

		// Then:
		assertThat(shares.shares()).extracting(CampaignShareModel::source)
				.containsExactly(CampaignShareSource.PACING_CREATED, CampaignShareSource.MANUAL);
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
		service.unshare(me(), CAMPAIGN, THEM, false);

		// Then:
		verify(hubCampaignShareService, never()).delete(any());
	}

	private void givenMpo() {
		when(mpoDepartmentPolicy.isMpo(DEPARTMENT)).thenReturn(true);
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

	private static HubRoleAssignment assignment(long userId) {
		HubRoleAssignment assignment = new HubRoleAssignment();
		assignment.setUserId(userId);
		return assignment;
	}

	private static HubUser user(long id, String name, String email) {
		HubUser user = new HubUser();
		user.setId(id);
		user.setDisplayName(name);
		user.setEmail(email);
		user.setStatus(HubStatus.ACTIVE.getCode());
		user.setDepartment(DEPARTMENT);
		return user;
	}

	private static HubUser pacingUser(long id, String name, String pacingUserId) {
		HubUser user = user(id, name, name.toLowerCase(Locale.ROOT) + "@x.com");
		user.setPacingUserId(pacingUserId);
		return user;
	}

	private static PacingCampaignPacing pacing(String id, String name, String... campaignIds) {
		return new PacingCampaignPacing(id, "slug-" + id, name, "Live", THEIR_PACING_USER_ID,
				java.util.Arrays.stream(campaignIds).map(c -> new PacingCampaignRef(c, "Campaign " + c, null)).toList());
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
