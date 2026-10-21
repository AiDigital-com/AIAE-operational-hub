package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.CampaignShareApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareCandidateListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareCreateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareV1;
import com.aidigital.operationalhub.application.mapper.CampaignShareContractMapper;
import com.aidigital.operationalhub.service.campaignshare.CampaignShareService;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST controller for {@code /api/v1/campaigns/{campaignId}/shares} - campaign sharing, "Add people"
 * on a campaign. Implements the OpenAPI-generated {@link CampaignShareApi}; every rule (who may share,
 * who may be shared with) lives in {@link CampaignShareService}.
 */
@RestController
@RequiredArgsConstructor
public class CampaignShareController implements CampaignShareApi {

	private final CurrentUserService currentUserService;
	private final CampaignShareService campaignShareService;
	private final CampaignShareContractMapper mapper;

	@Override
	public ResponseEntity<CampaignShareListV1> listCampaignShares(Long campaignId) {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		return ResponseEntity.ok(mapper.toV1(campaignShareService.listShares(user, campaignId)));
	}

	@Override
	public ResponseEntity<CampaignShareV1> createCampaignShare(Long campaignId, CampaignShareCreateV1 body) {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		return ResponseEntity.status(HttpStatus.CREATED)
				.body(mapper.toV1(campaignShareService.share(user, campaignId, body.getHubUserId())));
	}

	@Override
	public ResponseEntity<CampaignShareCandidateListV1> listCampaignShareCandidates(Long campaignId, String q) {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		return ResponseEntity.ok(mapper.toCandidatesV1(campaignShareService.listCandidates(user, campaignId, q)));
	}

	@Override
	public ResponseEntity<Void> deleteCampaignShare(Long campaignId, Long hubUserId) {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		campaignShareService.unshare(user, campaignId, hubUserId);
		return ResponseEntity.noContent().build();
	}
}
