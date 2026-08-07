package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.CreateTeamRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.TeamPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.TeamV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.UpdateTeamRequestV1;
import com.aidigital.operationalhub.domain.entity.HubTeam;
import org.mapstruct.Mapper;
import org.mapstruct.MappingConstants;
import org.springframework.data.domain.Page;

import java.util.List;

/**
 * Mapper for {@link TeamV1} and {@link HubTeam}.
 */
@Mapper(componentModel = MappingConstants.ComponentModel.SPRING)
public interface TeamContractMapper {

	/**
	 * Maps a Hub team entity to its generated contract representation.
	 *
	 * @param entity the team entity
	 * @return the generated {@link TeamV1}
	 */
	TeamV1 toV1(HubTeam entity);

	/**
	 * Maps a list of Hub team entities to their generated contract representations.
	 *
	 * @param entities the team entities
	 * @return the generated {@link TeamV1} list
	 */
	List<TeamV1> toV1(List<HubTeam> entities);

	/**
	 * Maps a create request to a new Hub team entity.
	 *
	 * @param request the create request
	 * @return a new {@link HubTeam} entity
	 */
	HubTeam fromV1(CreateTeamRequestV1 request);

	/**
	 * Maps an update request to a Hub team entity.
	 *
	 * @param request the update request
	 * @return a {@link HubTeam} entity with the updated data
	 */
	HubTeam fromV1(UpdateTeamRequestV1 request);

	/**
	 * Maps a page of Hub teams into the generated page response.
	 *
	 * @param page the page of team entities
	 * @return the generated {@link TeamPageResponseV1}
	 */
	default TeamPageResponseV1 toPageResponse(Page<HubTeam> page) {
		TeamPageResponseV1 response = new TeamPageResponseV1();
		response.setPageNumber(page.getNumber() + 1);
		response.setPageSize(page.getSize());
		response.setTotalElements(page.getTotalElements());
		response.setTotalPages(page.getTotalPages());
		response.setContent(toV1(page.getContent()));
		return response;
	}
}
