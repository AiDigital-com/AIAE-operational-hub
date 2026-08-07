package com.aidigital.operationalhub.service.entity;

import com.aidigital.operationalhub.domain.entity.HubScopeType;

import java.util.List;

/**
 * Single gateway to the {@code hub_scope_types} entity and its repository.
 *
 * <p>Per the "one entity, one repository, one service" rule, this is the only collaborator that
 * touches {@code HubScopeTypeRepository}; other services depend on this contract instead of the
 * repository.
 */
public interface HubScopeTypeService {

	/**
	 * Lists the active scope types ordered by display name ascending.
	 *
	 * @return the active scope-type entities ordered by display name
	 */
	List<HubScopeType> listActiveOrderedByDisplayName();

	/**
	 * Resolves the scope type identified by the given code.
	 *
	 * @param scopeCode the scope code (e.g. {@code TEAM})
	 * @return the resolved scope type
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the code is blank or
	 *                                                                          references an unknown scope type
	 */
	HubScopeType existingByScopeCode(String scopeCode);
}
