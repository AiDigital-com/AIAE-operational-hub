package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.entity.HubAgencyOwnerOverride;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

/**
 * Spring Data repository for {@link HubAgencyOwnerOverride} ({@code hub_agency_owner_overrides}).
 */
public interface HubAgencyOwnerOverrideRepository extends JpaRepository<HubAgencyOwnerOverride, Long> {

	/**
	 * Returns every override row with the given status.
	 *
	 * @param status the status to filter on (e.g. {@code ACTIVE})
	 * @return matching rows, in no guaranteed order
	 */
	List<HubAgencyOwnerOverride> findAllByStatus(String status);
}
