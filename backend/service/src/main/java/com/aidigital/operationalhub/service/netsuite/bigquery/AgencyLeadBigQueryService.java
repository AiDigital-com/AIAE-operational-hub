package com.aidigital.operationalhub.service.netsuite.bigquery;

import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.netsuite.model.AgencyLead;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Reads the agency-to-lead pairs from the IO Lines BigQuery table — one row per agency, choosing a
 * single MPO team lead per agency (as the agency aggregation does for the agency name) — using
 * {@link BqRequest.Builder} and the shared {@link BigQuerySearchGateway}.
 */
@Service
@RequiredArgsConstructor
public class AgencyLeadBigQueryService {

	private static final String AGENCY_ID = BigQueryIoLinesColumns.AGENCY_ID;
	private static final String MPO_TEAM_LEAD = BigQueryIoLinesColumns.MPO_TEAM_LEAD;

	private final BigQuerySearchGateway gateway;

	/**
	 * Loads the agency-to-lead pairs, one row per agency.
	 *
	 * @return the agency leads, never {@code null}
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException when the BigQuery read fails
	 */
	public List<AgencyLead> loadAgencyLeads() {
		BqRequest request = new BqRequest.Builder()
				.from(gateway.table())
				.select(AGENCY_ID)
				.selectAnyValue(MPO_TEAM_LEAD)
				.whereNotNull(AGENCY_ID)
				.groupBy(AGENCY_ID)
				.build();
		return gateway.fetch(request, this::toAgencyLead);
	}

	/**
	 * Maps a result row into an {@link AgencyLead}.
	 *
	 * @param row the result row
	 * @return the agency lead
	 */
	AgencyLead toAgencyLead(BqRow row) {
		return new AgencyLead(row.getLong(AGENCY_ID), row.getTrimmedString(MPO_TEAM_LEAD));
	}
}
