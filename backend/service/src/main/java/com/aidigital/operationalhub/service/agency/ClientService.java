package com.aidigital.operationalhub.service.agency;

import com.aidigital.operationalhub.service.agency.model.ClientModel;
import com.aidigital.operationalhub.service.agency.search.ClientField;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import org.springframework.data.domain.Page;

/**
 * Reads clients from BigQuery, filtered by the current user's RBAC scope.
 *
 * <p>Implementations query the {@code netsuite_campaigns_with_ids_fresh_data} BigQuery table for
 * distinct clients (advertisers), apply the search criteria, and map the rows into client models.
 */
public interface ClientService {

	/**
	 * Returns a page of clients visible to the given user, applying the search criteria.
	 *
	 * @param user     the current user
	 * @param criteria the filter, sort, and paging criteria
	 * @return the page of visible clients
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the BigQuery read fails
	 */
	Page<ClientModel> searchClients(CurrentUserModel user, SearchCriteria<ClientField> criteria);
}
