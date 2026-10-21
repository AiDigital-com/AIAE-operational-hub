package com.aidigital.operationalhub.service.rbac.model;

import java.util.List;

/**
 * The set of IO Lines agencies a user may see, derived from their RBAC scope, plus the individual
 * campaigns shared with them.
 *
 * <p>Three states: <em>unrestricted</em> (admin or an ALL-scoped role — sees every agency),
 * <em>restricted to</em> a set of agency ids (a TEAM-scoped role — sees only those teams' agencies)
 * and/or a set of shared campaign ids (campaign sharing — sees those campaigns wherever their agency
 * sits), and <em>sees nothing</em> (restricted with no agencies and no shared campaigns, e.g. a user
 * with no role and nothing shared).
 *
 * <p>A campaign is visible when its agency is in {@code agencyIds} OR its id is in
 * {@code campaignIds}. The two sets stay separate rather than being folded into one, because "may I
 * SHARE this campaign" is answered by the agency set alone: a share never lets its recipient share
 * onward.
 *
 * @param seesAll     whether the user sees every agency (no filtering)
 * @param agencyIds   the visible agency ids when restricted; empty when unrestricted
 * @param campaignIds the NetSuite campaign ids shared with the user when restricted; empty when
 *                    unrestricted
 */
public record AgencyVisibility(boolean seesAll, List<Long> agencyIds, List<Long> campaignIds) {

	public AgencyVisibility {
		agencyIds = agencyIds == null ? List.of() : List.copyOf(agencyIds);
		campaignIds = campaignIds == null ? List.of() : List.copyOf(campaignIds);
	}

	/**
	 * A visibility with no shared campaigns - the shape every caller before campaign sharing built.
	 *
	 * @param seesAll   whether the user sees every agency
	 * @param agencyIds the visible agency ids when restricted
	 */
	public AgencyVisibility(boolean seesAll, List<Long> agencyIds) {
		this(seesAll, agencyIds, List.of());
	}

	/**
	 * Visibility that imposes no agency filter.
	 *
	 * @return an unrestricted visibility
	 */
	public static AgencyVisibility unrestricted() {
		return new AgencyVisibility(true, List.of(), List.of());
	}

	/**
	 * Visibility restricted to exactly the given agency ids, with no shared campaigns.
	 *
	 * @param agencyIds the visible agency ids
	 * @return a restricted visibility
	 */
	public static AgencyVisibility restrictedTo(List<Long> agencyIds) {
		return new AgencyVisibility(false, agencyIds, List.of());
	}

	/**
	 * Visibility restricted to the given agency ids plus the given shared campaigns.
	 *
	 * @param agencyIds   the visible agency ids
	 * @param campaignIds the shared NetSuite campaign ids
	 * @return a restricted visibility
	 */
	public static AgencyVisibility restrictedTo(List<Long> agencyIds, List<Long> campaignIds) {
		return new AgencyVisibility(false, agencyIds, campaignIds);
	}

	/**
	 * Tells whether the user can see no campaign at all (restricted, with no agency and no share).
	 *
	 * @return {@code true} when the user has access to nothing
	 */
	public boolean seesNothing() {
		return !seesAll && agencyIds.isEmpty() && campaignIds.isEmpty();
	}

	/**
	 * Tells whether a campaign of the given agency is visible by the user's own scope - admin, an
	 * ALL-scoped role or a team owning that agency - as opposed to through a share.
	 *
	 * @param agencyId the campaign's agency id; {@code null} when the campaign carries none
	 * @return {@code true} when the agency is within the user's own scope
	 */
	public boolean ownsAgency(Long agencyId) {
		return seesAll || (agencyId != null && agencyIds.contains(agencyId));
	}
}
