package com.aidigital.operationalhub.service.agency;

import com.aidigital.operationalhub.service.agency.model.AgencyModel;
import com.aidigital.operationalhub.service.agency.search.AgencyField;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import org.springframework.data.domain.Page;

/**
 * Reads agencies from BigQuery, filtered by the current user's RBAC scope.
 *
 * <p>Implementations query the {@code netsuite_campaigns_with_ids_fresh_data} BigQuery table for
 * distinct agencies, apply the search criteria, and map the rows into agency models.
 */
public interface AgencyService {

	/**
	 * Returns a page of agencies visible to the given user, applying the search criteria. Equivalent
	 * to {@link #searchAgencies(CurrentUserModel, SearchCriteria, boolean)} with {@code includeClients}
	 * set to {@code false}.
	 *
	 * @param user     the current user
	 * @param criteria the filter, sort, and paging criteria
	 * @return the page of visible agencies
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the BigQuery read fails
	 */
	default Page<AgencyModel> searchAgencies(CurrentUserModel user, SearchCriteria<AgencyField> criteria) {
		return searchAgencies(user, criteria, null, false);
	}

	/**
	 * Equivalent to {@link #searchAgencies(CurrentUserModel, SearchCriteria, String, boolean)} with
	 * {@code search} set to {@code null}.
	 *
	 * @param user           the current user
	 * @param criteria       the filter, sort, and paging criteria
	 * @param includeClients when {@code true}, each returned agency is populated with its clients
	 *                       (id and name) so the navigation sidebar can render client sub-rows without
	 *                       a follow-up request
	 * @return the page of visible agencies
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the BigQuery read fails
	 */
	default Page<AgencyModel> searchAgencies(
			CurrentUserModel user, SearchCriteria<AgencyField> criteria, boolean includeClients) {
		return searchAgencies(user, criteria, null, includeClients);
	}

	/**
	 * Returns a page of agencies visible to the given user, applying the search criteria plus an
	 * optional global {@code search} term.
	 *
	 * <p>When {@code search} is non-blank, the result includes agencies whose own name matches the
	 * term <em>or</em> that have at least one embedded client whose name matches the term. The term
	 * is applied additively (AND) with any explicit filters in {@code criteria} and with the user's
	 * RBAC scope.
	 *
	 * @param user           the current user
	 * @param criteria       the filter, sort, and paging criteria
	 * @param search         optional global search term matching agency or embedded client names;
	 *                       blank or {@code null} disables the global match
	 * @param includeClients when {@code true}, each returned agency is populated with its clients
	 *                       (id and name) so the navigation sidebar can render client sub-rows without
	 *                       a follow-up request. When {@code search} matches a client name only
	 *                       (the agency name does not match), the embedded client list contains only
	 *                       the matching clients; otherwise the first page of clients is embedded
	 * @return the page of visible agencies
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the BigQuery read fails
	 */
	Page<AgencyModel> searchAgencies(
			CurrentUserModel user,
			SearchCriteria<AgencyField> criteria,
			String search,
			boolean includeClients);
}
