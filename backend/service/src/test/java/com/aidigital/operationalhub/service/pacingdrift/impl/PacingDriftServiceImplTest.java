package com.aidigital.operationalhub.service.pacingdrift.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserMirrorEntry;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.pacingdrift.model.PacingDriftCategory;
import com.aidigital.operationalhub.service.pacingdrift.model.PacingDriftReport;
import com.aidigital.operationalhub.service.pacingdrift.model.PacingDriftRow;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link PacingDriftServiceImpl}: proves it fetches both sides and
 * delegates to {@link PacingDriftDiffer} rather than diffing anything itself. Diffing behavior itself is
 * covered by {@code PacingDriftDifferTest}.
 */
@ExtendWith(MockitoExtension.class)
class PacingDriftServiceImplTest {

	@Mock
	private HubUserService hubUserService;

	@Mock
	private PacingClient pacingClient;

	@Mock
	private PacingDriftDiffer differ;

	@InjectMocks
	private PacingDriftServiceImpl service;

	@Test
	void shouldFetchBothSidesAndWrapTheDifferResultTest() {
		// Given:
		HubUser hubUser = new HubUser();
		hubUser.setEmail("a@x.com");
		List<HubUser> hubUsers = List.of(hubUser);
		List<PacingUserMirrorEntry> pacingUsers = List.of(new PacingUserMirrorEntry("a@x.com", "A", true));
		List<PacingDriftRow> diffResult = List.of(
				new PacingDriftRow("a@x.com", PacingDriftCategory.NAME_MISMATCH, "A", "A2", true, true));

		when(hubUserService.findAll()).thenReturn(hubUsers);
		when(pacingClient.listUsers()).thenReturn(pacingUsers);
		when(differ.diff(hubUsers, pacingUsers)).thenReturn(diffResult);

		// When:
		PacingDriftReport report = service.getDrift();

		// Then:
		assertThat(report).isEqualTo(new PacingDriftReport(diffResult));
	}
}
