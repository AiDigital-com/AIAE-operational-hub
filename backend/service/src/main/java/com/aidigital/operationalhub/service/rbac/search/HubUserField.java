package com.aidigital.operationalhub.service.rbac.search;

import com.aidigital.operationalhub.domain.entity.HubRole_;
import com.aidigital.operationalhub.domain.entity.HubUser_;
import com.aidigital.operationalhub.service.common.search.SearchableField;
import lombok.RequiredArgsConstructor;

/**
 * Sortable and filterable fields of the user-management listing.
 *
 * <p>For columns owned by {@code hub_users} the {@code expression} is the JPA attribute name on the
 * {@link com.aidigital.operationalhub.domain.entity.HubUser} entity, used directly for Criteria
 * predicates and {@code Pageable} sorting. {@link #ROLE_CODE} is not a column on the user entity: it
 * is resolved through the active role-assignment subquery built by the user specification factory,
 * so it is filterable but not sortable.
 */
@RequiredArgsConstructor
public enum HubUserField implements SearchableField {

	/**
	 * The {@code hub_users.id} primary key.
	 */
	HUB_USER_ID(HubUser_.ID, true),

	/**
	 * The user's display name.
	 */
	FULL_NAME(HubUser_.DISPLAY_NAME, false),

	/**
	 * The user's email address.
	 */
	EMAIL(HubUser_.EMAIL, false),

	/**
	 * The user's lifecycle status.
	 */
	STATUS(HubUser_.STATUS, false),

	/**
	 * The user's single active role code, resolved through the role-assignment subquery.
	 */
	ROLE_CODE(HubRole_.ROLE_CODE, false);

	private final String expression;
	private final boolean numeric;

	@Override
	public String expression() {
		return expression;
	}

	@Override
	public boolean numeric() {
		return numeric;
	}
}
