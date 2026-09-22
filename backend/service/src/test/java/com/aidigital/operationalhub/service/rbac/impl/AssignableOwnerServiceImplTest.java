package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.rbac.model.AssignableOwner;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * §11, US-131: who a pacing may be handed to. The answer comes from the caller's own Pacing scope —
 * what you can see, you can assign to — so these tests are mostly about the two scope kinds that
 * behave differently, and about the person the §2 sync has not reached yet.
 */
@ExtendWith(MockitoExtension.class)
class AssignableOwnerServiceImplTest {

	@Mock
	private HubUserService hubUserService;

	@InjectMocks
	private AssignableOwnerServiceImpl service;

	private HubUser user(Long id, String name, String email, String pacingUserId) {
		HubUser hubUser = new HubUser();
		hubUser.setId(id);
		hubUser.setDisplayName(name);
		hubUser.setEmail(email);
		hubUser.setPacingUserId(pacingUserId);
		return hubUser;
	}

	@Test
	void shouldOfferOnlyPeopleInsideAnOwnersScopeTest() {
		// Given: the scope names two of three colleagues.
		when(hubUserService.findAll()).thenReturn(List.of(
				user(1L, "Azat Nabiev", "azat@aidigital.com", "u-azat"),
				user(2L, "Daria Feofanova", "daria@aidigital.com", "u-daria"),
				user(3L, "Somebody Else", "else@aidigital.com", "u-else")));
		PacingEntitlement entitlement =
				new PacingEntitlement(PacingScope.owners(List.of("u-azat", "u-daria")), true);

		// When:
		List<AssignableOwner> owners = service.resolveFor(entitlement);

		// Then: sorted by name, and the out-of-scope colleague is absent.
		assertThat(owners).extracting(AssignableOwner::name)
				.containsExactly("Azat Nabiev", "Daria Feofanova");
	}

	@Test
	void shouldOfferEveryoneToAnAdminWhoseScopeCarriesNoIdsTest() {
		// Given: an admin's scope is "all" and lists nobody — there is nothing to look up. Returning
		// an empty list would leave the people most likely to be fixing a bad assignment unable to.
		when(hubUserService.findAll()).thenReturn(List.of(
				user(1L, "Azat Nabiev", "azat@aidigital.com", "u-azat"),
				user(2L, "Daria Feofanova", "daria@aidigital.com", "u-daria")));

		// When:
		List<AssignableOwner> owners = service.resolveFor(new PacingEntitlement(PacingScope.all(), true));

		// Then:
		assertThat(owners).hasSize(2);
	}

	@Test
	void shouldOmitSomebodyPacingHasNeverHeardOfTest() {
		// Given: no pacing_user_id means the §2 sync has not reached them. They cannot be named to
		// Pacing at all, so offering them would produce a choice the transfer then refuses.
		when(hubUserService.findAll()).thenReturn(List.of(
				user(1L, "Azat Nabiev", "azat@aidigital.com", "u-azat"),
				user(2L, "Not Synced Yet", "new@aidigital.com", null)));

		// When:
		List<AssignableOwner> owners = service.resolveFor(new PacingEntitlement(PacingScope.all(), true));

		// Then:
		assertThat(owners).extracting(AssignableOwner::name).containsExactly("Azat Nabiev");
	}

	@Test
	void shouldOfferNobodyForACampaignsScopeTest() {
		// Given: a campaigns scope says which campaigns a Client Services person may see. That answers
		// nothing about who may own a pacing, so the picker has no choices - not a refusal.
		PacingEntitlement entitlement =
				new PacingEntitlement(PacingScope.campaigns(List.of("40539")), false);

		// When-Then:
		assertThat(service.resolveFor(entitlement)).isEmpty();
	}

	@Test
	void shouldOfferNobodyWhenTheScopeNamesNobodyTest() {
		// Given: an owners scope with no ids - the shape a user gets before the §2 sync reaches them.
		// An empty list, because it is a configuration gap rather than a permission answer.
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.owners(List.of()), false);

		// When-Then:
		assertThat(service.resolveFor(entitlement)).isEmpty();
	}

	@Test
	void shouldCarryTheEmailSoTwoColleaguesSharingANameCanBeToldApartTest() {
		// Given: this organisation has fourteen people called Daria.
		when(hubUserService.findAll()).thenReturn(List.of(
				user(1L, "Daria Feofanova", "daria.f@aidigital.com", "u-1"),
				user(2L, "Daria Feofanova", "daria.f2@aidigital.com", "u-2")));

		// When:
		List<AssignableOwner> owners = service.resolveFor(new PacingEntitlement(PacingScope.all(), true));

		// Then:
		assertThat(owners).extracting(AssignableOwner::email)
				.containsExactly("daria.f@aidigital.com", "daria.f2@aidigital.com");
	}
}
