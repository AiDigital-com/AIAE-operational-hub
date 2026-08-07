package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.ToWarmUp;
import com.aidigital.operationalhub.domain.entity.HubRole;
import jakarta.persistence.QueryHint;
import lombok.NonNull;
import org.hibernate.jpa.HibernateHints;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.QueryHints;

import java.util.List;
import java.util.Optional;

/**
 * Spring Data repository for {@link HubRole} ({@code hub_roles}).
 */
public interface HubRoleRepository extends JpaRepository<HubRole, Long>, ToWarmUp<HubRole> {

	/**
	 * Finds a role by its unique role code.
	 *
	 * @param roleCode the role code (e.g. {@code ADMIN})
	 * @return the matching role, or empty if none exists
	 */
	@QueryHints({
			@QueryHint(name = HibernateHints.HINT_CACHEABLE, value = "true"),
			@QueryHint(name = HibernateHints.HINT_CACHE_REGION, value = "findByRoleCode")
	})
	Optional<HubRole> findByRoleCode(String roleCode);

	/**
	 * Lists roles with the given status ordered by display name ascending.
	 *
	 * @param status the status to filter on (e.g. {@code ACTIVE})
	 * @return matching roles ordered by display name
	 */
	@QueryHints({
			@QueryHint(name = HibernateHints.HINT_CACHEABLE, value = "true"),
			@QueryHint(name = HibernateHints.HINT_CACHE_REGION, value = "findAllHubRolesByStatusOrderByDisplayNameAsc")
	})
	List<HubRole> findAllByStatusOrderByDisplayNameAsc(String status);

	@NonNull
	@Override
	@QueryHints({
			@QueryHint(name = HibernateHints.HINT_CACHEABLE, value = "true"),
			@QueryHint(name = HibernateHints.HINT_CACHE_REGION, value = "findAllHubRoles")
	})
	List<HubRole> findAll();

	@Override
	default Class<HubRole> getClazz() {
		return HubRole.class;
	}
}
