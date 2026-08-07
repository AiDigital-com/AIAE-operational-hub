package com.aidigital.operationalhub.service.rbac.mapper;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.HubUserSummaryModel;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingConstants;

/**
 * Service-layer mapper between {@link HubUser} entities and RBAC service models.
 */
@Mapper(componentModel = MappingConstants.ComponentModel.SPRING)
public interface HubUserMapper {

	/**
	 * Maps a Hub user entity to its immutable {@link CurrentUserModel}.
	 *
	 * @param entity the Hub user entity to map
	 * @return the current-user model
	 */
	CurrentUserModel toCurrentUserModel(HubUser entity);

	/**
	 * Maps a Hub user entity and its resolved active role code and scoped team to a {@link HubUserSummaryModel}.
	 *
	 * @param entity   the Hub user entity to map
	 * @param roleCode the user's current active role code, or {@code null} when unassigned
	 * @param teamId   the team scoped by the active role, or {@code null} when not TEAM-scoped
	 * @return the user summary model
	 */
	@Mapping(target = "hubUserId", source = "entity.id")
	@Mapping(target = "fullName", source = "entity.displayName")
	@Mapping(target = "email", source = "entity.email")
	@Mapping(target = "status", source = "entity.status")
	@Mapping(target = "roleCode", source = "roleCode")
	@Mapping(target = "teamId", source = "teamId")
	HubUserSummaryModel toSummaryModel(HubUser entity, String roleCode, Long teamId);
}
