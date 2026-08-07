package com.aidigital.operationalhub.service.netsuite.bigquery;

import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.netsuite.model.RipplingEmployee;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Reads active employees from the Rippling BigQuery table — one row per distinct employee with a work
 * email — using {@link BqRequest.Builder} and the shared {@link BigQuerySearchGateway}.
 *
 * <p>The source table carries one row per {@code business_partner_group_name} (People Coordinator /
 * Talent Acquisition Partner / People Partner), so the same employee appears up to three times with
 * identical {@code teams}/{@code title}/{@code manager} values; rows are collapsed to one per
 * {@code work_email} via {@code GROUP BY} + {@code ANY_VALUE(...)}, mirroring
 * {@link AgencyLeadBigQueryService}.
 */
@Service
@RequiredArgsConstructor
public class RipplingEmployeeBigQueryService {

	private static final String EMPLOYEE = "employee";
	private static final String DEPARTMENT = "department";
	private static final String WORK_EMAIL = "work_email";
	private static final String TEAMS = "teams";
	private static final String TITLE = "title";
	private static final String MANAGER = "manager";
	private static final String EMPLOYMENT_STATUS = "employment_status";
	private static final String ACTIVE_STATUS = "Active";

	private final BigQuerySearchGateway gateway;
	private final BigQueryProperties properties;

	/**
	 * Loads the active employees, one row per distinct {@code work_email}.
	 *
	 * @return the active employees, never {@code null}
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException when the BigQuery read fails
	 */
	public List<RipplingEmployee> loadActiveEmployees() {
		BqRequest request = new BqRequest.Builder()
				.from(gateway.qualify(properties.getRipplingEmployeesTable()))
				.selectAnyValue(EMPLOYEE)
				.selectAnyValue(DEPARTMENT)
				.select(WORK_EMAIL)
				.selectAnyValue(TEAMS)
				.selectAnyValue(TITLE)
				.selectAnyValue(MANAGER)
				.whereEquals(EMPLOYMENT_STATUS, ACTIVE_STATUS)
				.whereNotNull(WORK_EMAIL)
				.groupBy(WORK_EMAIL)
				.build();
		return gateway.fetch(request, this::toEmployee);
	}

	/**
	 * Maps a result row into a {@link RipplingEmployee}.
	 *
	 * @param row the result row
	 * @return the employee
	 */
	RipplingEmployee toEmployee(BqRow row) {
		return new RipplingEmployee(
				row.getTrimmedString(EMPLOYEE),
				row.getTrimmedString(DEPARTMENT),
				row.getTrimmedString(WORK_EMAIL),
				row.getTrimmedString(TEAMS),
				row.getTrimmedString(TITLE),
				row.getTrimmedString(MANAGER));
	}
}
