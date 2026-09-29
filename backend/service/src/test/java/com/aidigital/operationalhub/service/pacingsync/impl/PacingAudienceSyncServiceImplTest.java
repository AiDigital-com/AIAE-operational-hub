package com.aidigital.operationalhub.service.pacingsync.impl;

import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAudienceEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAudiencePushResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAudiencePushStats;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingOwnerEntry;
import com.aidigital.operationalhub.service.pacingsync.model.PacingAudienceRoster;
import com.aidigital.operationalhub.service.pacingsync.model.PacingAudienceSyncSummary;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link PacingAudienceSyncServiceImpl}: the assembly of per-pacing
 * audience entries out of the resolver's roster, and the honest accounting of what Pacing answered.
 */
@ExtendWith(MockitoExtension.class)
class PacingAudienceSyncServiceImplTest {

	private static final String PACING_1 = "aaaaaaaa-1111-1111-1111-111111111111";
	private static final String PACING_2 = "bbbbbbbb-2222-2222-2222-222222222222";
	private static final String OWNER_KNOWN = "11111111-1111-1111-1111-111111111111";
	private static final String OWNER_UNKNOWN = "99999999-9999-9999-9999-999999999999";

	@Mock
	private PacingClient pacingClient;

	@Mock
	private PacingAudienceResolver resolver;

	@InjectMocks
	private PacingAudienceSyncServiceImpl service;

	@Test
	void shouldPushGlobalsPlusTeamViewersPerPacingTest() {
		// Given:
		when(pacingClient.listPacingOwners()).thenReturn(List.of(
				new PacingOwnerEntry(PACING_1, OWNER_KNOWN)));
		when(resolver.resolve()).thenReturn(new PacingAudienceRoster(
				List.of("admin@x.com"),
				Map.of(OWNER_KNOWN, List.of("mate@x.com"))));
		when(pacingClient.pushPacingAudience(anyList())).thenReturn(
				new PacingAudiencePushResult(new PacingAudiencePushStats(0, 1, 0), List.of()));

		// When:
		PacingAudienceSyncSummary summary = service.sync();

		// Then: one entry, globals unioned with the owner's team viewers, sorted and deduplicated
		ArgumentCaptor<List<PacingAudienceEntry>> captor = ArgumentCaptor.captor();
		verify(pacingClient).pushPacingAudience(captor.capture());
		assertThat(captor.getValue()).containsExactly(
				new PacingAudienceEntry(PACING_1, List.of("admin@x.com", "mate@x.com")));
		assertThat(summary).isEqualTo(new PacingAudienceSyncSummary(1, 0, 1, 0, 0));
	}

	@Test
	void shouldStillPushGlobalsOnlyAndCountAnOwnerTheHubCannotResolveTest() {
		// Given: one pacing whose owner id matches no hub user, one with no owner at all
		when(pacingClient.listPacingOwners()).thenReturn(List.of(
				new PacingOwnerEntry(PACING_1, OWNER_UNKNOWN),
				new PacingOwnerEntry(PACING_2, null)));
		when(resolver.resolve()).thenReturn(new PacingAudienceRoster(
				List.of("admin@x.com"), Map.of()));
		when(pacingClient.pushPacingAudience(anyList())).thenReturn(
				new PacingAudiencePushResult(new PacingAudiencePushStats(2, 0, 0), List.of()));

		// When:
		PacingAudienceSyncSummary summary = service.sync();

		// Then: both pacings still get the globals-only audience; only the unknown OWNER counts as
		// unresolved (an ownerless pacing has nothing to resolve)
		ArgumentCaptor<List<PacingAudienceEntry>> captor = ArgumentCaptor.captor();
		verify(pacingClient).pushPacingAudience(captor.capture());
		assertThat(captor.getValue()).containsExactly(
				new PacingAudienceEntry(PACING_1, List.of("admin@x.com")),
				new PacingAudienceEntry(PACING_2, List.of("admin@x.com")));
		assertThat(summary.ownersUnresolved()).isEqualTo(1);
	}

	@Test
	void shouldPushAnEmptyListForATeamlessOwnerSoRevocationsLandTest() {
		// Given: the owner is known but has no team and there are no globals
		when(pacingClient.listPacingOwners()).thenReturn(List.of(
				new PacingOwnerEntry(PACING_1, OWNER_KNOWN)));
		when(resolver.resolve()).thenReturn(new PacingAudienceRoster(
				List.of(), Map.of(OWNER_KNOWN, List.of())));
		when(pacingClient.pushPacingAudience(anyList())).thenReturn(
				new PacingAudiencePushResult(new PacingAudiencePushStats(0, 1, 0), List.of()));

		// When:
		PacingAudienceSyncSummary summary = service.sync();

		// Then: the empty list IS the message (full replacement - yesterday's viewers are revoked on
		// Pacing's next ACL sweep), and a known owner is not "unresolved"
		ArgumentCaptor<List<PacingAudienceEntry>> captor = ArgumentCaptor.captor();
		verify(pacingClient).pushPacingAudience(captor.capture());
		assertThat(captor.getValue()).containsExactly(new PacingAudienceEntry(PACING_1, List.of()));
		assertThat(summary.ownersUnresolved()).isZero();
	}

	@Test
	void shouldSkipTheResolverAndThePushEntirelyWhenPacingHasNoPacingsTest() {
		// Given:
		when(pacingClient.listPacingOwners()).thenReturn(List.of());

		// When:
		PacingAudienceSyncSummary summary = service.sync();

		// Then:
		assertThat(summary).isEqualTo(new PacingAudienceSyncSummary(0, 0, 0, 0, 0));
		verify(pacingClient, never()).pushPacingAudience(anyList());
		verifyNoInteractions(resolver);
	}

	@Test
	void shouldSurfaceUnknownPacingIdsFromPacingInTheSummaryTest() {
		// Given: Pacing skipped one id it does not know (roster drift around a deletion)
		when(pacingClient.listPacingOwners()).thenReturn(List.of(
				new PacingOwnerEntry(PACING_1, null),
				new PacingOwnerEntry(PACING_2, null)));
		when(resolver.resolve()).thenReturn(new PacingAudienceRoster(List.of("admin@x.com"), Map.of()));
		when(pacingClient.pushPacingAudience(anyList())).thenReturn(
				new PacingAudiencePushResult(new PacingAudiencePushStats(0, 1, 1), List.of(PACING_2)));

		// When:
		PacingAudienceSyncSummary summary = service.sync();

		// Then:
		assertThat(summary).isEqualTo(new PacingAudienceSyncSummary(2, 0, 1, 1, 0));
	}
}
