package com.aidigital.operationalhub.service.netsuite.impl;

import com.aidigital.operationalhub.domain.enums.Grade;
import com.aidigital.operationalhub.service.netsuite.bigquery.AgencyLeadBigQueryService;
import com.aidigital.operationalhub.service.netsuite.bigquery.RipplingEmployeeBigQueryService;
import com.aidigital.operationalhub.service.netsuite.model.AgencyLead;
import com.aidigital.operationalhub.service.netsuite.model.RipplingEmployee;
import com.aidigital.operationalhub.service.netsuite.model.SyncSummary;
import com.aidigital.operationalhub.service.netsuite.org.DataQualityFlag;
import com.aidigital.operationalhub.service.netsuite.org.OrgResolution;
import com.aidigital.operationalhub.service.netsuite.org.OrgRole;
import com.aidigital.operationalhub.service.netsuite.org.OrgTreeTeamResolver;
import com.aidigital.operationalhub.service.netsuite.org.ResolvedEmployee;
import com.aidigital.operationalhub.service.netsuite.org.ResolvedTeam;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link NetSuiteSyncServiceImpl}. Since R2 ({@code
 * team-by-team-lead-REMEDIATION.md}) this class only reads BigQuery, resolves the org tree, and delegates
 * the write side to {@link NetSuiteSyncReconciler} - it holds no database transaction of its own. DB
 * reconciliation behavior (team upsert/deactivation, grade, role/scope assignment, agency mapping) is
 * covered by {@code NetSuiteSyncReconcilerTest}; the resolver's own algorithm is covered by
 * {@code OrgTreeTeamResolverTest}.
 */
@ExtendWith(MockitoExtension.class)
class NetSuiteSyncServiceImplTest {

	private static final String EMAIL = "jane@example.com";
	private static final String NAME = "Jane Lead";
	private static final Long AGENCY_ID = 500L;

	@Mock
	private RipplingEmployeeBigQueryService ripplingEmployeeService;

	@Mock
	private AgencyLeadBigQueryService agencyLeadService;

	@Mock
	private OrgTreeTeamResolver orgTreeTeamResolver;

	@Mock
	private NetSuiteSyncReconciler reconciler;

	@InjectMocks
	private NetSuiteSyncServiceImpl service;

	@Test
	void shouldResolveWithNoTransactionThenDelegateToTheReconcilerTest() {
		// Given: the resolution carries a data-quality flag, so the non-transactional read/resolve phase
		// must complete (and log it) before the reconciler is ever invoked
		List<RipplingEmployee> employees = List.of(
				new RipplingEmployee(NAME, "Media Optimization", EMAIL, "MPO Team Leads",
						"Team Lead, Media Optimization", null));
		List<AgencyLead> agencyLeads = List.of(new AgencyLead(AGENCY_ID, NAME));
		OrgResolution resolution = new OrgResolution(
				List.of(new ResolvedEmployee(EMAIL, NAME, OrgRole.TEAM_LEAD, Grade.TEAM_LEAD, EMAIL, "HOUSE",
						List.of(DataQualityFlag.DUPLICATE_TEAM_NAME))),
				List.of(new ResolvedTeam(EMAIL, NAME, "Media Optimization: Jane", "HOUSE",
						List.of(DataQualityFlag.DUPLICATE_TEAM_NAME))));
		SyncSummary reconcilerResult = new SyncSummary(1, 1, 1, 1);

		when(ripplingEmployeeService.loadActiveEmployees()).thenReturn(employees);
		when(orgTreeTeamResolver.resolve(employees)).thenReturn(resolution);
		when(agencyLeadService.loadAgencyLeads()).thenReturn(agencyLeads);
		when(reconciler.reconcile(resolution, agencyLeads)).thenReturn(reconcilerResult);

		// When:
		SyncSummary summary = service.sync();

		// Then:
		assertThat(summary).isSameAs(reconcilerResult);
		ArgumentCaptor<List<RipplingEmployee>> resolveCaptor = ArgumentCaptor.forClass(List.class);
		verify(orgTreeTeamResolver).resolve(resolveCaptor.capture());
		assertThat(resolveCaptor.getValue()).isSameAs(employees);
		verify(reconciler).reconcile(same(resolution), same(agencyLeads));
	}

	@Test
	void shouldDelegateEvenWhenNoFlagsAreSurfacedTest() {
		// Given: a clean resolution with no data-quality flags on either employees or teams
		List<RipplingEmployee> employees = List.of();
		List<AgencyLead> agencyLeads = List.of();
		OrgResolution resolution = new OrgResolution(List.of(), List.of());
		SyncSummary reconcilerResult = new SyncSummary(0, 0, 0, 0);

		when(ripplingEmployeeService.loadActiveEmployees()).thenReturn(employees);
		when(orgTreeTeamResolver.resolve(employees)).thenReturn(resolution);
		when(agencyLeadService.loadAgencyLeads()).thenReturn(agencyLeads);
		when(reconciler.reconcile(resolution, agencyLeads)).thenReturn(reconcilerResult);

		// When:
		SyncSummary summary = service.sync();

		// Then:
		assertThat(summary).isSameAs(reconcilerResult);
		verify(reconciler).reconcile(same(resolution), same(agencyLeads));
	}
}
