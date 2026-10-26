package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.AgencyCampaignIdService;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.List;
import java.util.Objects;

/**
 * BigQuery-backed {@link AgencyCampaignIdService}: one {@code SELECT DISTINCT campaign_id} over the IO
 * Lines table for the agency set, read through the gateway's search-result cache.
 *
 * <p>The agency ids are sorted before the query is built so that two callers naming the same set in a
 * different order render the same SQL and share one cache entry - the cache is keyed by the rendered
 * SQL (see {@code CachedBigQuerySearchExecutor}).
 */
@Service
@RequiredArgsConstructor
public class BigQueryAgencyCampaignIdService implements AgencyCampaignIdService {

	private static final String CAMPAIGN_ID = BigQueryIoLinesColumns.CAMPAIGN_ID;
	private static final String AGENCY_ID = BigQueryIoLinesColumns.AGENCY_ID;

	private final BigQuerySearchGateway gateway;

	@Override
	public List<Long> findCampaignIdsByAgencyIds(Collection<Long> agencyIds) {
		if (agencyIds == null || agencyIds.isEmpty()) {
			return List.of();
		}
		List<Long> sortedAgencyIds = agencyIds.stream().filter(Objects::nonNull).distinct().sorted().toList();
		if (sortedAgencyIds.isEmpty()) {
			return List.of();
		}
		BqRequest request = new BqRequest.Builder()
				.from(gateway.table())
				.distinct()
				.select(CAMPAIGN_ID)
				.whereNotNull(CAMPAIGN_ID)
				.whereIn(AGENCY_ID, sortedAgencyIds)
				.orderBy(CAMPAIGN_ID)
				.build();
		return gateway.fetchCached(request, row -> row.getLong(CAMPAIGN_ID)).stream()
				.filter(Objects::nonNull)
				.toList();
	}
}
