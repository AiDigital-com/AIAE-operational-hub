package com.aidigital.operationalhub.service.netsuite.impl;

import com.aidigital.operationalhub.service.netsuite.NetSuiteSyncService;
import com.aidigital.operationalhub.service.netsuite.bigquery.AgencyLeadBigQueryService;
import com.aidigital.operationalhub.service.netsuite.bigquery.RipplingEmployeeBigQueryService;
import com.aidigital.operationalhub.service.netsuite.model.AgencyLead;
import com.aidigital.operationalhub.service.netsuite.model.RipplingEmployee;
import com.aidigital.operationalhub.service.netsuite.model.SyncSummary;
import com.aidigital.operationalhub.service.netsuite.org.OrgResolution;
import com.aidigital.operationalhub.service.netsuite.org.OrgTreeTeamResolver;
import com.aidigital.operationalhub.service.netsuite.org.ResolvedEmployee;
import com.aidigital.operationalhub.service.netsuite.org.ResolvedTeam;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Default {@link NetSuiteSyncService}. Reads the source-of-truth data (BigQuery) and resolves the org
 * tree with no database connection held, then delegates the write side to {@link NetSuiteSyncReconciler}
 * inside a single write transaction (see {@code team-by-team-lead-REMEDIATION.md} R2).
 *
 * <p>Teams are derived from the Rippling org tree ({@link OrgTreeTeamResolver}): each employee is
 * assigned to the team of their Team Lead (not their {@code department}), directors get no team, and
 * grade is set from the classified title. See {@code team-by-team-lead-PLAN.md}.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NetSuiteSyncServiceImpl implements NetSuiteSyncService {

	private final RipplingEmployeeBigQueryService ripplingEmployeeService;
	private final AgencyLeadBigQueryService agencyLeadService;
	private final OrgTreeTeamResolver orgTreeTeamResolver;
	private final NetSuiteSyncReconciler reconciler;

	/**
	 * Runs a full NetSuite/Rippling sync: reads the BigQuery sources and resolves the org tree with no
	 * database transaction/connection held, then delegates every write to {@link NetSuiteSyncReconciler}
	 * inside its own transaction. Self-invocation of a {@code @Transactional} method on this bean would not
	 * apply the proxy, which is why the write side lives on a separate bean rather than a private/local
	 * method here.
	 *
	 * @return the outcome of this sync run
	 */
	@Override
	public SyncSummary sync() {
		List<RipplingEmployee> employees = ripplingEmployeeService.loadActiveEmployees();
		OrgResolution resolution = orgTreeTeamResolver.resolve(employees);
		logDataQualityFlags(resolution);

		List<AgencyLead> agencyLeads = agencyLeadService.loadAgencyLeads();

		return reconciler.reconcile(resolution, agencyLeads);
	}

	/**
	 * Logs every data-quality flag surfaced by the org-tree resolution, for manual follow-up (e.g.
	 * unresolved teams, ambiguous manager names, pod/grade cross-check mismatches).
	 *
	 * @param resolution the org-tree resolution
	 */
	void logDataQualityFlags(OrgResolution resolution) {
		for (ResolvedEmployee employee : resolution.employees()) {
			if (!employee.flags().isEmpty()) {
				log.warn("NetSuite sync data-quality flags: workEmail={}, flags={}",
						employee.workEmail(), employee.flags());
			}
		}
		for (ResolvedTeam team : resolution.teams()) {
			if (!team.flags().isEmpty()) {
				log.warn("NetSuite sync data-quality flags: teamName={}, flags={}", team.teamName(), team.flags());
			}
		}
	}
}
