package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.RoleV1;
import com.aidigital.operationalhub.domain.entity.HubRole;
import org.mapstruct.Mapper;
import org.mapstruct.MappingConstants;

import java.util.List;

/**
 * Mapper for {@link RoleV1}.
 */
@Mapper(componentModel = MappingConstants.ComponentModel.SPRING)
public interface RoleContractMapper {

	/**
	 * Maps a {@link HubRole} entity to its generated DTO.
	 *
	 * @param role the role entity
	 * @return the generated {@link RoleV1}
	 */
	RoleV1 toV1(HubRole role);

	/**
	 * Maps a list of {@link HubRole} entities to its generated DTO.
	 *
	 * @param roles the role entity list
	 * @return the generated list of {@link RoleV1}
	 */
	List<RoleV1> toV1(List<HubRole> roles);
}
