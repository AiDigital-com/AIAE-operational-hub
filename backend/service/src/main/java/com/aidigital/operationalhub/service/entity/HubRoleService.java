package com.aidigital.operationalhub.service.entity;

import com.aidigital.operationalhub.domain.entity.HubRole;

import java.util.List;

/**
 * Single gateway to the {@code hub_roles} entity and its repository.
 *
 * <p>Per the "one entity, one repository, one service" rule, this is the only collaborator that
 * touches {@code HubRoleRepository}; other services depend on this contract instead of the repository.
 */
public interface HubRoleService {

	/**
	 * Lists the active roles ordered by display name ascending.
	 *
	 * @return the active role entities ordered by display name
	 */
	List<HubRole> listActiveOrderedByDisplayName();

	/**
	 * Resolves the role identified by the given code.
	 *
	 * @param roleCode the role code (e.g. {@code ADMIN})
	 * @return the resolved role
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the code is blank or
	 *                                                                          references an unknown role
	 */
	HubRole existingByRoleCode(String roleCode);
}
