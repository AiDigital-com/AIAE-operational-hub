package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareCandidateListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignShareV1;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareCandidateModel;
import com.aidigital.operationalhub.domain.enums.CampaignShareSource;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignSharePacingListV1;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignShareModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharePacingCampaignModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharePacingModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharePersonRoleModel;
import com.aidigital.operationalhub.service.campaignshare.model.CampaignSharesModel;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Field-by-field mapping of the campaign-share models onto the contract - the one place a renamed
 * field would silently turn into a null on the wire.
 */
class CampaignShareContractMapperTest {

	private final CampaignShareContractMapper mapper = new CampaignShareContractMapper();

	@Test
	void shouldMapAShareWithItsRoleAndGranterTest() {
		// Given:
		LocalDateTime sharedAt = LocalDateTime.of(2026, 10, 20, 15, 47, 54);
		CampaignShareModel model = new CampaignShareModel(2L, "Beatris Felises", "b@aidigital.com",
				new CampaignSharePersonRoleModel("MPO Manager", "Team Vlad"), "Azat Nabiev", sharedAt,
				CampaignShareSource.PACING_CREATED);

		// When:
		CampaignShareV1 v1 = mapper.toV1(model);

		// Then:
		assertThat(v1.getHubUserId()).isEqualTo(2L);
		assertThat(v1.getFullName()).isEqualTo("Beatris Felises");
		assertThat(v1.getEmail()).isEqualTo("b@aidigital.com");
		assertThat(v1.getRoleName()).isEqualTo("MPO Manager");
		assertThat(v1.getTeamName()).isEqualTo("Team Vlad");
		assertThat(v1.getGrantedByName()).isEqualTo("Azat Nabiev");
		assertThat(v1.getCreatedAt()).isEqualTo(sharedAt);
		assertThat(v1.getSource()).isEqualTo(CampaignShareV1.SourceEnum.PACING_CREATED);
	}

	@Test
	void shouldMapTheListWithTheCallersRightToShareTest() {
		// Given: a share of someone with no role at all
		CampaignShareModel roleless = new CampaignShareModel(3L, "Dan", "dan@aidigital.com", null, null, null, null);
		CampaignSharesModel model = new CampaignSharesModel(true, List.of(roleless));

		// When:
		CampaignShareListV1 v1 = mapper.toV1(model);

		// Then: nothing invented for the missing role, granter or date
		assertThat(v1.getCanShare()).isTrue();
		assertThat(v1.getShares()).hasSize(1);
		CampaignShareV1 row = v1.getShares().getFirst();
		assertThat(row.getHubUserId()).isEqualTo(3L);
		assertThat(row.getRoleName()).isNull();
		assertThat(row.getTeamName()).isNull();
		assertThat(row.getGrantedByName()).isNull();
		assertThat(row.getCreatedAt()).isNull();
	}

	@Test
	void shouldMapCandidatesInOrderTest() {
		// Given:
		List<CampaignShareCandidateModel> candidates = List.of(
				new CampaignShareCandidateModel(4L, "Anna", "anna@aidigital.com",
						new CampaignSharePersonRoleModel("Director", null)),
				new CampaignShareCandidateModel(5L, "Zlatan", "zlatan@aidigital.com",
						new CampaignSharePersonRoleModel("Team Lead", "Team Zlatan")));

		// When:
		CampaignShareCandidateListV1 v1 = mapper.toCandidatesV1(candidates);

		// Then:
		assertThat(v1.getCandidates()).hasSize(2);
		assertThat(v1.getCandidates().get(0).getHubUserId()).isEqualTo(4L);
		assertThat(v1.getCandidates().get(0).getFullName()).isEqualTo("Anna");
		assertThat(v1.getCandidates().get(0).getRoleName()).isEqualTo("Director");
		assertThat(v1.getCandidates().get(0).getTeamName()).isNull();
		assertThat(v1.getCandidates().get(1).getEmail()).isEqualTo("zlatan@aidigital.com");
		assertThat(v1.getCandidates().get(1).getTeamName()).isEqualTo("Team Zlatan");
	}

	@Test
	void shouldMapThePacingsAPersonOwnsOnACampaignTest() {
		// Given:
		CampaignSharePacingModel pacing = new CampaignSharePacingModel("p1", "fox-2026", "Fox 2026", List.of(
				new CampaignSharePacingCampaignModel("100", "Fox Spring"),
				new CampaignSharePacingCampaignModel("200", null)));

		// When:
		CampaignSharePacingListV1 v1 = mapper.toPacingsV1(List.of(pacing));

		// Then:
		assertThat(v1.getPacings()).hasSize(1);
		assertThat(v1.getPacings().getFirst().getPacingName()).isEqualTo("Fox 2026");
		assertThat(v1.getPacings().getFirst().getCampaigns()).extracting(c -> c.getId()).containsExactly("100", "200");
		assertThat(v1.getPacings().getFirst().getCampaigns().get(1).getName()).isNull();
	}
}
