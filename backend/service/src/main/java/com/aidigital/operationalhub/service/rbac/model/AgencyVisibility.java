package com.aidigital.operationalhub.service.rbac.model;

import java.util.List;

/**
 * The set of IO Lines agencies a user may see, derived from their RBAC scope.
 *
 * <p>Three states: <em>unrestricted</em> (admin or an ALL-scoped role — sees every agency),
 * <em>restricted to</em> a non-empty set of agency ids (a TEAM-scoped role — sees only those teams'
 * agencies), and <em>sees nothing</em> (restricted with no agencies, e.g. a user with no role).
 *
 * @param seesAll   whether the user sees every agency (no filtering)
 * @param agencyIds the visible agency ids when restricted; empty when unrestricted
 */
public record AgencyVisibility(boolean seesAll, List<Long> agencyIds) {

	public AgencyVisibility {
		agencyIds = agencyIds == null ? List.of() : List.copyOf(agencyIds);
	}

	/**
	 * Visibility that imposes no agency filter.
	 *
	 * @return an unrestricted visibility
	 */
	public static AgencyVisibility unrestricted() {
		return new AgencyVisibility(true, List.of());
	}

	/**
	 * Visibility restricted to exactly the given agency ids.
	 *
	 * @param agencyIds the visible agency ids
	 * @return a restricted visibility
	 */
	public static AgencyVisibility restrictedTo(List<Long> agencyIds) {
		return new AgencyVisibility(false, agencyIds);
	}

	/**
	 * Tells whether the user can see no agency at all (restricted with an empty id set).
	 *
	 * @return {@code true} when the user has access to no agency
	 */
	public boolean seesNothing() {
		return !seesAll && agencyIds.isEmpty();
	}
}
