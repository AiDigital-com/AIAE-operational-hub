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
 * Reads the agency-to-lead pairs from the IO Lines BigQuery table — one row per distinct
 * (agency, MPO team lead) pair, since NetSuite records ownership per line item and an agency can be
 * genuinely co-owned by several teams — using {@link BqRequest.Builder} and the shared
 * {@link BigQuerySearchGateway}.
 */
@Service
@RequiredArgsConstructor
public class AgencyLeadBigQueryService {

	private static final String AGENCY_ID = BigQueryIoLinesColumns.AGENCY_ID;
	private static final String MPO_TEAM_LEAD = BigQueryIoLinesColumns.MPO_TEAM_LEAD;

	private final BigQuerySearchGateway gateway;

	/**
	 * Loads the agency-to-lead pairs, one row per distinct (agency, MPO team lead) pair - several rows
	 * per agency when it is co-owned by more than one team.
	 *
	 * @return the agency leads, never {@code null}
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException when the BigQuery read fails
	 */
	public List<AgencyLead> loadAgencyLeads() {
		BqRequest request = new BqRequest.Builder()
				.from(gateway.table())
				.distinct()
				.select(AGENCY_ID)
				.select(MPO_TEAM_LEAD)
				.whereNotNull(AGENCY_ID)
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
