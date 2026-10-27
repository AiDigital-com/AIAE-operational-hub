package com.aidigital.operationalhub.service.netsuite.model;

import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubScopeType;

/**
 * One role assignment the sync wants a user to hold: the role, the scope type, and the scope id
 * ({@code hub_teams.id} for a {@code TEAM} scope). A user may want several - a Director holds one per
 * team in their streams - and the reconciler makes the user's active set exactly this list.
 *
 * @param role      the role the user should hold
 * @param scopeType the scope type
 * @param scopeId   the scope id, or {@code null} for an unscoped assignment
 */
public record DesiredAssignment(HubRole role, HubScopeType scopeType, Long scopeId) {

}
