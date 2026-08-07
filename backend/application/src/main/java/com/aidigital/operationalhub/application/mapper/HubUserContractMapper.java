package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.HubUserSummaryV1;
import com.aidigital.operationalhub.service.rbac.model.HubUserSummaryModel;
import org.mapstruct.Mapper;
import org.mapstruct.MappingConstants;

import java.util.List;

/**
 * Mapper for {@link HubUserSummaryV1}.
 */
@Mapper(componentModel = MappingConstants.ComponentModel.SPRING)
public interface HubUserContractMapper {

	/**
	 * Maps a user summary model to its generated contract representation.
	 *
	 * @param model the user summary model
	 * @return the generated {@link HubUserSummaryV1}
	 */
	HubUserSummaryV1 toV1(HubUserSummaryModel model);

	/**
	 * Maps a list of user summary models to their generated contract representations.
	 *
	 * @param models the user summary models
	 * @return the generated {@link HubUserSummaryV1} list
	 */
	List<HubUserSummaryV1> toV1(List<HubUserSummaryModel> models);
}
