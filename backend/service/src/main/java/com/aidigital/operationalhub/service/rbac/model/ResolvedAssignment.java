package com.aidigital.operationalhub.service.rbac.model;

import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubScopeType;

/**
 * Resolved dictionary rows for a validated role-assignment command.
 *
 * @param role      the resolved role row
 * @param scopeType the resolved scope-type row
 */
public record ResolvedAssignment(HubRole role, HubScopeType scopeType) {

}
