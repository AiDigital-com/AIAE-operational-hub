package com.aidigital.operationalhub.service.agency;

import java.util.Collection;
import java.util.List;

/**
 * Reads which NetSuite campaigns belong to a set of agencies - the campaign side of a team's agency
 * ownership, for the Pacing scope a team sees (every pacing on its agencies' campaigns, 2026-10-23).
 */
public interface AgencyCampaignIdService {

	/**
	 * Returns the distinct campaign ids of every IO Lines row under any of the given agencies. Cached
	 * with the other snapshot reads: the answer changes once a night, and every Pacing call of every
	 * member of the team asks it.
	 *
	 * @param agencyIds the agency ids; an empty set resolves to an empty result without touching BigQuery
	 * @return the campaign ids, sorted ascending, never {@code null}
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the BigQuery read fails
	 */
	List<Long> findCampaignIdsByAgencyIds(Collection<Long> agencyIds);
}
