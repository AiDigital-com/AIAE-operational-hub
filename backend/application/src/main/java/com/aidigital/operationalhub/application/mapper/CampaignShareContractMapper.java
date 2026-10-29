package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignAccessContactsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareCandidateListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareCandidateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignSharePacingCampaignV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignSharePacingListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignSharePacingV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareV1;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignAccessContactsModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareCandidateModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharePacingModel;
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
				.shares(model.shares().stream().map(this::toV1).toList())
				.teamAccess(model.teamAccess().stream().map(this::toCandidateV1).toList());
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
				.createdAt(model.createdAt())
				.source(CampaignShareV1.SourceEnum.fromValue(model.source().getCode()));
	}

	/**
	 * Maps the pacings a person owns on a campaign, for the removal confirmation.
	 *
	 * @param pacings the service models
	 * @return the contract shape
	 */
	public CampaignSharePacingListV1 toPacingsV1(List<CampaignSharePacingModel> pacings) {
		return new CampaignSharePacingListV1()
				.pacings(pacings.stream()
						.map(pacing -> new CampaignSharePacingV1()
								.pacingId(pacing.pacingId())
								.dashSlug(pacing.dashSlug())
								.pacingName(pacing.pacingName())
								.campaigns(pacing.campaigns().stream()
										.map(campaign -> new CampaignSharePacingCampaignV1()
												.id(campaign.id())
												.name(campaign.name()))
										.toList()))
						.toList());
	}

	/**
	 * Maps who to ask for access to a campaign.
	 *
	 * @param model the service model
	 * @return the contract shape
	 */
	public CampaignAccessContactsV1 toAccessContactsV1(CampaignAccessContactsModel model) {
		return new CampaignAccessContactsV1()
				.campaignName(model.campaignName())
				.netSuiteTeamLeads(model.netSuiteTeamLeads())
				.runningTeamFound(model.runningTeamFound())
				.contacts(model.contacts().stream().map(this::toCandidateV1).toList());
	}

	/**
	 * Maps the candidates of an "Add people" search.
	 *
	 * @param candidates the service models
	 * @return the contract shape
	 */
	public CampaignShareCandidateListV1 toCandidatesV1(List<CampaignShareCandidateModel> candidates) {
		return new CampaignShareCandidateListV1()
				.candidates(candidates.stream().map(this::toCandidateV1).toList());
	}

	/**
	 * Maps one person with their role and team - a candidate, or somebody who sees the campaign
	 * through its team.
	 *
	 * @param candidate the service model
	 * @return the contract shape
	 */
	public CampaignShareCandidateV1 toCandidateV1(CampaignShareCandidateModel candidate) {
		return new CampaignShareCandidateV1()
				.hubUserId(candidate.hubUserId())
				.fullName(candidate.fullName())
				.email(candidate.email())
				.roleName(candidate.role().roleName())
				.teamName(candidate.role().teamName());
	}
}
