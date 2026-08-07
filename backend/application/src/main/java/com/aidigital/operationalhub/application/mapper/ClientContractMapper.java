package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.ClientV1;
import com.aidigital.operationalhub.service.agency.model.ClientModel;
import org.mapstruct.Mapper;
import org.mapstruct.MappingConstants;

import java.util.List;

/**
 * Mapper for {@link ClientV1}.
 */
@Mapper(componentModel = MappingConstants.ComponentModel.SPRING)
public interface ClientContractMapper {

	/**
	 * Maps a client model to its generated contract representation.
	 *
	 * @param model the client model
	 * @return the generated {@link ClientV1}
	 */
	ClientV1 toV1(ClientModel model);

	/**
	 * Maps a list of client models to their generated contract representations.
	 *
	 * @param models the client models
	 * @return the generated {@link ClientV1} list
	 */
	List<ClientV1> toV1(List<ClientModel> models);
}
