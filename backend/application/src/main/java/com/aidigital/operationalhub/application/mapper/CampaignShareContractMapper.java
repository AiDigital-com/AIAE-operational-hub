package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareCandidateListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareCandidateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareV1;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareCandidateModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharesModel;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Maps campaign-share service models onto the generated API contract.
 */
@Component
public class CampaignShareContractMapper {

	/**
	 * Maps a campaign's shares and the caller's right to edit them.
	 *
	 * @param model the service model
	 * @return the contract shape
	 */
	public CampaignShareListV1 toV1(CampaignSharesModel model) {
		return new CampaignShareListV1()
				.canShare(model.canShare())
				.shares(model.shares().stream().map(this::toV1).toList());
	}

	/**
	 * Maps one share.
	 *
	 * @param model the service model
	 * @return the contract shape
	 */
	public CampaignShareV1 toV1(CampaignShareModel model) {
		return new CampaignShareV1()
				.hubUserId(model.hubUserId())
				.fullName(model.fullName())
				.email(model.email())
				.roleName(model.role().roleName())
				.teamName(model.role().teamName())
				.grantedByName(model.grantedByName())
				.createdAt(model.createdAt());
	}

	/**
	 * Maps the candidates of an "Add people" search.
	 *
	 * @param candidates the service models
	 * @return the contract shape
	 */
	public CampaignShareCandidateListV1 toCandidatesV1(List<CampaignShareCandidateModel> candidates) {
		return new CampaignShareCandidateListV1()
				.candidates(candidates.stream()
						.map(candidate -> new CampaignShareCandidateV1()
								.hubUserId(candidate.hubUserId())
								.fullName(candidate.fullName())
								.email(candidate.email())
								.roleName(candidate.role().roleName())
								.teamName(candidate.role().teamName()))
						.toList());
	}
}
