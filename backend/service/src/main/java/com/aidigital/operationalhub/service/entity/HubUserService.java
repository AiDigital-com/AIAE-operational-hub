package com.aidigital.operationalhub.service.entity;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.rbac.search.HubUserField;
import org.springframework.data.domain.Page;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * Single gateway to the {@code hub_users} entity and its repository.
 *
 * <p>Per the "one entity, one repository, one service" rule, this is the only collaborator that
 * touches {@code HubUserRepository}; other services depend on this contract instead of the repository.
 */
public interface HubUserService {

	/**
	 * Returns a page of Hub users matching the given search criteria.
	 *
	 * <p>Filtering (including role-membership filtering), sorting, and paging are applied in the
	 * database via the Criteria API.
	 *
	 * @param criteria the filter, sort, and paging criteria
	 * @return the matching page of users
	 */
	Page<HubUser> searchUsers(SearchCriteria<HubUserField> criteria);

	/**
	 * Finds a Hub user by its Clerk user identifier.
	 *
	 * @param clerkUserId the Clerk {@code sub} identifier
	 * @return the matching user, or empty if none exists
	 */
	Optional<HubUser> findByClerkUserId(String clerkUserId);

	/**
	 * Finds a Hub user by email, case-insensitively. Used to upsert synced employees and to match a
	 * Clerk login to a provisioned employee.
	 *
	 * @param email the email address
	 * @return the matching user, or empty if none exists
	 */
	Optional<HubUser> findByEmail(String email);

	/**
	 * Resolves a Hub user by id, acquiring a pessimistic write lock on the row.
	 *
	 * <p>Must be called inside an active transaction owned by the caller.
	 *
	 * @param userId the {@code hub_users.id} to lock and load
	 * @return the locked user
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if no user with that id
	 *                                                                          exists
	 */
	HubUser existingByIdForUpdate(Long userId);

	/**
	 * Persists the given user entity.
	 *
	 * @param user the user entity to save
	 * @return the saved user entity
	 */
	HubUser save(HubUser user);

	/**
	 * Batch-loads users whose email matches (case-insensitively) any of the given addresses, for
	 * preloading before the NetSuite sync's reconcile loop instead of one {@code findByEmail} per
	 * employee.
	 *
	 * @param lowerCaseEmails the email addresses to match, already lower-cased by the caller
	 * @return the matching users, in no guaranteed order; addresses with no matching user are absent
	 */
	List<HubUser> findAllByEmailIgnoreCaseIn(Collection<String> lowerCaseEmails);
}
