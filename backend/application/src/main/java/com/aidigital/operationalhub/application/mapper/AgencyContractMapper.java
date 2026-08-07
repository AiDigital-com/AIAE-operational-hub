package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.AgencyClientV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AgencyV1;
import com.aidigital.operationalhub.service.agency.model.AgencyClientRefModel;
import com.aidigital.operationalhub.service.agency.model.AgencyModel;
import org.mapstruct.Mapper;
import org.mapstruct.MappingConstants;

import java.util.List;

/**
 * Mapper for {@link AgencyV1}.
 */
@Mapper(componentModel = MappingConstants.ComponentModel.SPRING)
public interface AgencyContractMapper {

	/**
	 * Maps an agency model to its generated contract representation.
	 *
	 * @param model the agency model
	 * @return the generated {@link AgencyV1}
	 */
	AgencyV1 toV1(AgencyModel model);

	/**
	 * Maps a list of agency models to their generated contract representations.
	 *
	 * @param models the agency models
	 * @return the generated {@link AgencyV1} list
	 */
	List<AgencyV1> toV1(List<AgencyModel> models);

	/**
	 * Maps an embedded client reference to its generated contract representation. Used by MapStruct to
	 * map the {@link AgencyModel#clients()} list element-by-element.
	 *
	 * @param model the client reference model
	 * @return the generated {@link AgencyClientV1}
	 */
	AgencyClientV1 toV1(AgencyClientRefModel model);
}
