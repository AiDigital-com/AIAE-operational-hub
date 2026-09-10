package com.aidigital.operationalhub.service.pacingdrift.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserMirrorEntry;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.pacingdrift.PacingDriftService;
import com.aidigital.operationalhub.service.pacingdrift.model.PacingDriftReport;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Default {@link PacingDriftService}. Reads both sides — the full Hub roster and Pacing's full user
 * mirror — and delegates the comparison to {@link PacingDriftDiffer}, the same read-then-diff split
 * {@code PacingUserSyncServiceImpl}/{@code PacingUserSyncReconciler} use for the sync, except this path
 * never writes anything, so there is no separate transactional reconciler bean here.
 */
@Service
@RequiredArgsConstructor
public class PacingDriftServiceImpl implements PacingDriftService {

	private final HubUserService hubUserService;
	private final PacingClient pacingClient;
	private final PacingDriftDiffer differ;

	@Override
	public PacingDriftReport getDrift() {
		List<HubUser> hubUsers = hubUserService.findAll();
		List<PacingUserMirrorEntry> pacingUsers = pacingClient.listUsers();
		return new PacingDriftReport(differ.diff(hubUsers, pacingUsers));
	}
}
