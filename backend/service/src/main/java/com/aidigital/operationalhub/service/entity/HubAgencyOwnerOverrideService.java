package com.aidigital.operationalhub.service.entity;

import com.aidigital.operationalhub.domain.entity.HubAgencyOwnerOverride;

import java.util.List;

/**
 * Single gateway to the {@code hub_agency_owner_overrides} entity and its repository.
 *
 * <p>Per the "one entity, one repository, one service" rule, this is the only collaborator that touches
 * {@code HubAgencyOwnerOverrideRepository}; other services depend on this contract instead of the
 * repository.
 */
public interface HubAgencyOwnerOverrideService {

	/**
	 * Returns every override row with the given status.
	 *
	 * @param status the status to filter on (e.g. {@code ACTIVE})
	 * @return matching rows, in no guaranteed order
	 */
	List<HubAgencyOwnerOverride> findAllByStatus(String status);
}
