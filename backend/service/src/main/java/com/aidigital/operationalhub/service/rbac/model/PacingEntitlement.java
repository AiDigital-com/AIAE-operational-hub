package com.aidigital.operationalhub.service.rbac.model;

/**
 * The Pacing-service entitlement resolved from a user's Hub RBAC access: the {@link PacingScope} that
 * filters which pacings they may see, and whether they may create one.
 *
 * @param scope     the resolved Pacing scope
 * @param canCreate whether the user may create a pacing
 * @since 1.0
 */
public record PacingEntitlement(PacingScope scope, boolean canCreate) {

}
