package com.aidigital.operationalhub.service.rbac;

import com.aidigital.operationalhub.service.rbac.model.AssignableOwner;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import java.util.List;

/**
 * Who the current user may hand a pacing to (§11 of the migration plan, US-131's "only users in
 * scope can be selected").
 *
 * <p>Answers from the SAME entitlement that filters what the user can see, so the rule is one rule:
 * what you can see, you can assign to. Pacing enforces it again on the transfer itself — this exists
 * so a picker offers the right choices, not as the check.
 */
public interface AssignableOwnerService {

	/**
	 * Resolves the people this entitlement allows as owners.
	 *
	 * @param entitlement the caller's resolved Pacing entitlement
	 * @return the assignable owners, sorted by name; empty when nobody is in scope
	 */
	List<AssignableOwner> resolveFor(PacingEntitlement entitlement);
}
