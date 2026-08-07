package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.ToWarmUp;
import com.aidigital.operationalhub.domain.entity.HubScopeType;
import jakarta.persistence.QueryHint;
import lombok.NonNull;
import org.hibernate.jpa.HibernateHints;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.QueryHints;

import java.util.List;
import java.util.Optional;

/**
 * Spring Data repository for {@link HubScopeType} ({@code hub_scope_types}).
 */
public interface HubScopeTypeRepository extends JpaRepository<HubScopeType, Long>, ToWarmUp<HubScopeType> {

	/**
	 * Finds a scope type by its unique scope code.
	 *
	 * @param scopeCode the scope code (e.g. {@code TEAM})
	 * @return the matching scope type, or empty if none exists
	 */
	@QueryHints({
			@QueryHint(name = HibernateHints.HINT_CACHEABLE, value = "true"),
			@QueryHint(name = HibernateHints.HINT_CACHE_REGION, value = "findByScopeCode")
	})
	Optional<HubScopeType> findByScopeCode(String scopeCode);

	/**
	 * Lists scope types with the given status ordered by display name ascending.
	 *
	 * @param status the status to filter on (e.g. {@code ACTIVE})
	 * @return matching scope types ordered by display name
	 */
	@QueryHints({
			@QueryHint(name = HibernateHints.HINT_CACHEABLE, value = "true"),
			@QueryHint(name = HibernateHints.HINT_CACHE_REGION, value =
					"findAllHubScopesByStatusOrderByDisplayNameAsc")
	})
	List<HubScopeType> findAllByStatusOrderByDisplayNameAsc(String status);

	@NonNull
	@Override
	@QueryHints({
			@QueryHint(name = HibernateHints.HINT_CACHEABLE, value = "true"),
			@QueryHint(name = HibernateHints.HINT_CACHE_REGION, value = "findAllHubScopeTypes")
	})
	List<HubScopeType> findAll();

	@Override
	default Class<HubScopeType> getClazz() {
		return HubScopeType.class;
	}
}
