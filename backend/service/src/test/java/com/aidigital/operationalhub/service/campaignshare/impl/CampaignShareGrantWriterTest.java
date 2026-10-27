package com.aidigital.operationalhub.service.campaignshare.impl;

import com.aidigital.operationalhub.domain.entity.HubCampaignShare;
import com.aidigital.operationalhub.domain.enums.CampaignShareSource;
import com.aidigital.operationalhub.service.entity.HubCampaignShareService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link CampaignShareGrantWriter}: one row per missing (campaign,
 * recipient), nothing for a row that exists, whatever its source.
 */
@ExtendWith(MockitoExtension.class)
class CampaignShareGrantWriterTest {

	private static final long ACTOR = 1L;
	private static final long RECIPIENT = 2L;

	@Mock
	private HubCampaignShareService hubCampaignShareService;

	@InjectMocks
	private CampaignShareGrantWriter writer;

	@Test
	void shouldInsertOnlyTheCampaignsTheRecipientDoesNotHoldYetTest() {
		// Given: a manual share on 100 already; nothing on 200
		HubCampaignShare manual = new HubCampaignShare();
		manual.setSource(CampaignShareSource.MANUAL.getCode());
		when(hubCampaignShareService.findByCampaignIdAndUserId(100L, RECIPIENT)).thenReturn(Optional.of(manual));
		when(hubCampaignShareService.findByCampaignIdAndUserId(200L, RECIPIENT)).thenReturn(Optional.empty());
		when(hubCampaignShareService.save(any())).thenAnswer(call -> call.getArgument(0));

		// When:
		int created = writer.grant(ACTOR, RECIPIENT, List.of(100L, 200L), CampaignShareSource.PACING_CREATED);

		// Then: one new automatic row, the manual one untouched
		assertThat(created).isEqualTo(1);
		ArgumentCaptor<HubCampaignShare> saved = ArgumentCaptor.forClass(HubCampaignShare.class);
		verify(hubCampaignShareService).save(saved.capture());
		assertThat(saved.getValue().getCampaignId()).isEqualTo(200L);
		assertThat(saved.getValue().getUserId()).isEqualTo(RECIPIENT);
		assertThat(saved.getValue().getGrantedByUserId()).isEqualTo(ACTOR);
		assertThat(saved.getValue().getSource()).isEqualTo("pacing_created");
		assertThat(manual.getSource()).isEqualTo("manual");
	}

	@Test
	void shouldWriteNothingForNoCampaignsTest() {
		// When:
		int created = writer.grant(ACTOR, RECIPIENT, List.of(), CampaignShareSource.PACING_CREATED);

		// Then:
		assertThat(created).isZero();
		verify(hubCampaignShareService, never()).save(any());
	}
}
