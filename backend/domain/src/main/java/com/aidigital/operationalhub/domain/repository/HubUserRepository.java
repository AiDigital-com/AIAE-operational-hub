package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.entity.HubUser;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import org.hibernate.jpa.HibernateHints;
import org.hibernate.jpa.SpecHints;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * Spring Data repository for {@link HubUser} ({@code hub_users}).
 *
 * <p>Extends {@link JpaSpecificationExecutor} so the user-management search can be expressed with the
 * Criteria API (dynamic filters, role-membership subquery, sorting, and paging) rather than ad-hoc
 * JPQL.
 */
public interface HubUserRepository
		extends JpaRepository<HubUser, Long>, JpaSpecificationExecutor<HubUser> {

	/**
	 * Maximum time, in milliseconds, the database waits to acquire the pessimistic lock before failing.
	 */
	String LOCK_TIMEOUT_MILLIS = "10000";

	/**
	 * Finds a Hub user by its Clerk user identifier.
	 *
	 * @param clerkUserId the Clerk {@code sub} identifier
	 * @return the matching user, or empty if none exists
	 */
	@QueryHints({
			@QueryHint(name = HibernateHints.HINT_CACHEABLE, value = "true"),
			@QueryHint(name = HibernateHints.HINT_CACHE_REGION, value = "findByClerkUserId")
	})
	Optional<HubUser> findByClerkUserId(String clerkUserId);

	/**
	 * Finds a Hub user by email, case-insensitively, via a {@code lower(email)} comparison matching the
	 * {@code uq_hub_users_email_lower} expression index — a derived {@code upper(email) = upper(?)}
	 * query cannot use that index.
	 *
	 * @param email the email address
	 * @return the matching user, or empty if none exists
	 */
	@Query("select u from HubUser u where lower(u.email) = lower(:email)")
	Optional<HubUser> findByEmailIgnoreCase(@Param("email") String email);

	/**
	 * Batch-loads users whose email matches (case-insensitively) any of the given addresses, via the
	 * same {@code lower(email)} comparison, for preloading before a bulk reconcile instead of one query
	 * per row. The given emails must already be lower-cased by the caller.
	 *
	 * @param lowerCaseEmails the email addresses to match, already lower-cased
	 * @return the matching users, in no guaranteed order
	 */
	@Query("select u from HubUser u where lower(u.email) in :lowerCaseEmails")
	List<HubUser> findAllByEmailIgnoreCaseIn(@Param("lowerCaseEmails") Collection<String> lowerCaseEmails);

	/**
	 * Finds a Hub user by id, acquiring a pessimistic write lock on the row.
	 *
	 * <p>The {@code jakarta.persistence.lock.timeout} hint (milliseconds) bounds how long the
	 * database waits for the lock before failing, preventing indefinite lock waits.
	 *
	 * @param id the user id to lock and load
	 * @return the locked user, or empty if none exists
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@QueryHints(@QueryHint(name = SpecHints.HINT_SPEC_LOCK_TIMEOUT, value = LOCK_TIMEOUT_MILLIS))
	@Query("select u from HubUser u where u.id = :id")
	Optional<HubUser> findByIdForUpdate(@Param("id") Long id);
}
