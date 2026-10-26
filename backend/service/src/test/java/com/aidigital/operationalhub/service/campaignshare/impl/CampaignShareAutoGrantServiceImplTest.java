package com.aidigital.operationalhub.service.campaignshare.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.CampaignShareSource;
import com.aidigital.operationalhub.externalservices.pacing.PacingCampaignAccessClient;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignPacing;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignRef;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateLineItem;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLineItemPlanUpdate;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.rbac.PacingCampaignIndexService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.instancio.Select.field;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link CampaignShareAutoGrantServiceImpl}: the right people on the right
 * campaigns after each pacing write, and no failure of theirs ever reaching the caller.
 */
@ExtendWith(MockitoExtension.class)
class CampaignShareAutoGrantServiceImplTest {

	private static final long ME = 1L;
	private static final long NEW_OWNER = 2L;
	private static final String NEW_OWNER_PACING_ID = "22222222-2222-2222-2222-222222222222";

	@Mock
	private CampaignShareGrantWriter grantWriter;

	@Mock
	private HubUserService hubUserService;

	@Mock
	private PacingCampaignAccessClient pacingCampaignAccessClient;

	@Mock
	private PacingCampaignIndexService pacingCampaignIndexService;

	@InjectMocks
	private CampaignShareAutoGrantServiceImpl service;

	@Test
	void shouldGrantTheCreatorEveryDistinctCampaignOfTheLineItemsAndForgetTheIndexTest() {
		// Given: three line items over two campaigns, one id blank
		List<PacingCreateLineItem> lineItems = List.of(
				createLineItem("100"), createLineItem("200"), createLineItem("100"), createLineItem(" "));

		// When:
		service.grantAfterPacingCreate(me(), lineItems);

		// Then:
		ArgumentCaptor<Collection<Long>> campaigns = ArgumentCaptor.forClass(Collection.class);
		verify(grantWriter).grant(eq(ME), eq(ME), campaigns.capture(), eq(CampaignShareSource.PACING_CREATED));
		assertThat(campaigns.getValue()).containsExactly(100L, 200L);
		verify(pacingCampaignIndexService).evict();
	}

	@Test
	void shouldGrantTheSaverTheCampaignsOfASavedPlanTest() {
		// Given:
		List<PacingLineItemPlanUpdate> lineItems = List.of(planLineItem("300"), planLineItem("not-a-number"));

		// When:
		service.grantAfterPlanSave(me(), lineItems);

		// Then: the unparseable id is dropped, the rest granted
		ArgumentCaptor<Collection<Long>> campaigns = ArgumentCaptor.forClass(Collection.class);
		verify(grantWriter).grant(eq(ME), eq(ME), campaigns.capture(), eq(CampaignShareSource.PACING_CREATED));
		assertThat(campaigns.getValue()).containsExactly(300L);
	}

	@Test
	void shouldGrantTheNewOwnerThePacingsCampaignsAfterATransferTest() {
		// Given: the recipient is a synced Hub user; the pacing spans two campaigns
		HubUser recipient = new HubUser();
		recipient.setId(NEW_OWNER);
		when(hubUserService.findByPacingUserId(NEW_OWNER_PACING_ID)).thenReturn(Optional.of(recipient));
		when(pacingCampaignAccessClient.getPacing("p1")).thenReturn(new PacingCampaignPacing(
				"p1", "slug", "Fox", "Live", NEW_OWNER_PACING_ID,
				List.of(new PacingCampaignRef("100", "Fox Spring", null), new PacingCampaignRef("200", null, null))));

		// When:
		service.grantAfterOwnerTransfer(me(), "p1", NEW_OWNER_PACING_ID);

		// Then: granted by me, to them
		ArgumentCaptor<Collection<Long>> campaigns = ArgumentCaptor.forClass(Collection.class);
		verify(grantWriter).grant(eq(ME), eq(NEW_OWNER), campaigns.capture(), eq(CampaignShareSource.PACING_CREATED));
		assertThat(campaigns.getValue()).containsExactly(100L, 200L);
	}

	@Test
	void shouldSkipTheTransferGrantWhenTheRecipientIsNotAHubUserTest() {
		// Given:
		when(hubUserService.findByPacingUserId(NEW_OWNER_PACING_ID)).thenReturn(Optional.empty());

		// When:
		service.grantAfterOwnerTransfer(me(), "p1", NEW_OWNER_PACING_ID);

		// Then:
		verify(grantWriter, never()).grant(any(), any(), any(), any());
	}

	@Test
	void shouldNeverFailTheCallerWhenTheGrantOrPacingFailsTest() {
		// Given: the writer blows up on one path, Pacing on the other
		doThrow(new IllegalStateException("db down")).when(grantWriter)
				.grant(any(), any(), any(), eq(CampaignShareSource.PACING_CREATED));
		HubUser recipient = new HubUser();
		recipient.setId(NEW_OWNER);
		when(hubUserService.findByPacingUserId(NEW_OWNER_PACING_ID)).thenReturn(Optional.of(recipient));
		when(pacingCampaignAccessClient.getPacing("p1"))
				.thenThrow(new PacingExternalException(PacingFailureReason.UNREACHABLE, "down"));

		// When-Then: both are logged, neither thrown
		assertThatCode(() -> service.grantAfterPacingCreate(me(), List.of(createLineItem("100"))))
				.doesNotThrowAnyException();
		assertThatCode(() -> service.grantAfterOwnerTransfer(me(), "p1", NEW_OWNER_PACING_ID))
				.doesNotThrowAnyException();
	}

	private static CurrentUserModel me() {
		return new CurrentUserModel(ME, "clerk", "me@x.com", "Me", "ACTIVE");
	}

	private static PacingCreateLineItem createLineItem(String campaignId) {
		return Instancio.of(PacingCreateLineItem.class).set(field(PacingCreateLineItem::campaignId), campaignId).create();
	}

	private static PacingLineItemPlanUpdate planLineItem(String campaignId) {
		return Instancio.of(PacingLineItemPlanUpdate.class)
				.set(field(PacingLineItemPlanUpdate::campaignId), campaignId)
				.create();
	}
}
