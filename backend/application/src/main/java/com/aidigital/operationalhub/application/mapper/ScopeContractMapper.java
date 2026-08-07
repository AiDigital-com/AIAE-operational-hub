package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.ScopeTypeV1;
import com.aidigital.operationalhub.domain.entity.HubScopeType;
import org.mapstruct.Mapper;
import org.mapstruct.MappingConstants;

import java.util.List;

/**
 * Mapper for {@link ScopeTypeV1}.
 */
@Mapper(componentModel = MappingConstants.ComponentModel.SPRING)
public interface ScopeContractMapper {

	/**
	 * Maps a {@link HubScopeType} entity to its generated DTO.
	 *
	 * @param scopeType the scope-type entity
	 * @return the generated {@link ScopeTypeV1}
	 */
	ScopeTypeV1 toV1(HubScopeType scopeType);

	/**
	 * Maps a list of {@link HubScopeType} entities to its generated DTO.
	 *
	 * @param scopeType the scope-type entity list
	 * @return the generated list of {@link ScopeTypeV1}
	 */
	List<ScopeTypeV1> toV1(List<HubScopeType> scopeType);
}
