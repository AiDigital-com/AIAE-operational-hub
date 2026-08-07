package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.UserV1;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.EffectiveAccessContext;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingConstants;

/**
 * Mapper for {@link UserV1}.
 */
@Mapper(
		componentModel = MappingConstants.ComponentModel.SPRING,
		uses = {RoleAssignmentContractMapper.class}
)
public interface UserContractMapper {

	/**
	 * Builds the {@code /auth/me} payload from the current user and its effective access context.
	 *
	 * @param user   the resolved current user
	 * @param access the effective access context for the user
	 * @return the generated {@link UserV1}
	 */
	@Mapping(target = "userId", source = "user.clerkUserId")
	@Mapping(target = "email", source = "user.email")
	@Mapping(target = "fullName", source = "user.displayName")
	@Mapping(target = "hubUserId", source = "user.id")
	@Mapping(target = "status", source = "user.status")
	@Mapping(target = "roles", source = "access.roleCodes")
	@Mapping(target = "assignments", source = "access.assignments")
	UserV1 toV1(CurrentUserModel user, EffectiveAccessContext access);
}
