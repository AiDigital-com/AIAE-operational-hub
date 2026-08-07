package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.StatusV1;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import org.mapstruct.Mapper;
import org.mapstruct.MappingConstants;

import java.util.List;

/**
 * Maps {@link HubStatus} enum values to their generated {@link StatusV1} dictionary representation.
 */
@Mapper(componentModel = MappingConstants.ComponentModel.SPRING)
public interface StatusContractMapper {

	/**
	 * Maps a single status to its generated dictionary row.
	 *
	 * @param status the status enum value
	 * @return the generated {@link StatusV1}
	 */
	StatusV1 toV1(HubStatus status);

	/**
	 * Maps a list of statuses to their generated dictionary rows.
	 *
	 * @param statuses the status enum values
	 * @return the generated {@link StatusV1} list
	 */
	List<StatusV1> toV1(List<HubStatus> statuses);
}
