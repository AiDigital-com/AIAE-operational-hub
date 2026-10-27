package com.aidigital.operationalhub.service.rbac;

import java.util.Set;

/**
 * Which NetSuite campaigns carry at least one pacing, as Pacing knows it - the filter that keeps a
 * team's Pacing scope down to the campaigns there is something to see on (2026-10-23).
 */
public interface PacingCampaignIndexService {

	/**
	 * Name of the cache holding the one fleet-wide set of campaign ids with pacings.
	 *
	 * <p>A short time-to-live (see {@code ehcache.xml}) rather than eviction wiring: the set only grows
	 * when a pacing is created or re-planned onto a new campaign, and the Hub evicts it itself after
	 * the creates it performs ({@link #evict()}); a pacing created from anywhere else shows up to a
	 * team within the TTL.
	 */
	String CAMPAIGNS_WITH_PACINGS_CACHE = "pacingCampaignIdsWithPacings";

	/**
	 * Returns every campaign id, as text, that at least one pacing covers.
	 *
	 * @return the campaign ids, never {@code null}
	 * @throws com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException
	 *         when Pacing cannot be reached or refuses the call (unchecked)
	 */
	Set<String> campaignIdsWithPacings();

	/**
	 * Forgets the cached set, so the next read asks Pacing again - called after this Hub creates a
	 * pacing or saves a plan, so the team sees the new pacing at once rather than within the TTL.
	 */
	void evict();
}
