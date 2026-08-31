package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.CampaignsApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConstructedEntityLevelEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConstructedEntityPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConstructedIdsPreviewRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConstructedIdsPreviewResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionAdjustmentRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardCreateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardDataSourceRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardDatasetRowsPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardDatasetRowsSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardPreviewV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionBreakdownRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionBreakdownV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionRowSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.InsertionOrderV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowAdjustmentRollbackRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowAdjustmentRollbackResultV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowAdjustmentsRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowBulkAdjustmentResultV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowFilterFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowsPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewUpsertV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewV1;
import com.aidigital.operationalhub.application.mapper.CampaignSearchContractMapper;
import com.aidigital.operationalhub.application.mapper.ConstructedEntityContractMapper;
import com.aidigital.operationalhub.application.mapper.ConversionAdjustmentXlsxAssembler;
import com.aidigital.operationalhub.application.mapper.ConversionBreakdownContractMapper;
import com.aidigital.operationalhub.application.mapper.DashboardContractMapper;
import com.aidigital.operationalhub.application.mapper.InsertionOrderContractMapper;
import com.aidigital.operationalhub.application.mapper.ReportRowContractMapper;
import com.aidigital.operationalhub.application.mapper.ReportRowFileSupport;
import com.aidigital.operationalhub.application.mapper.ReportRowSearchCommand;
import com.aidigital.operationalhub.application.mapper.ReportRowXlsxAssembler;
import com.aidigital.operationalhub.application.mapper.ReportRowXlsxExportAssembler;
import com.aidigital.operationalhub.application.mapper.ReportViewContractMapper;
import com.aidigital.operationalhub.application.mapper.XlsxDownloadResponder;
import com.aidigital.operationalhub.domain.entity.HubDashboard;
import com.aidigital.operationalhub.domain.entity.HubReportView;
import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.ConversionAdjustmentService;
import com.aidigital.operationalhub.service.agency.InsertionOrderService;
import com.aidigital.operationalhub.service.agency.ReportRowService;
import com.aidigital.operationalhub.service.agency.bigquery.model.ConstructedEntityLevel;
import com.aidigital.operationalhub.service.agency.model.AdjustmentRollbackResultModel;
import com.aidigital.operationalhub.service.agency.model.AdjustmentRowModel;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.model.ConstructedIdsPreviewModel;
import com.aidigital.operationalhub.service.agency.model.ConversionRowExportModel;
import com.aidigital.operationalhub.service.agency.model.ConversionRowModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowDateRangeModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowExportModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowPageModel;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import com.aidigital.operationalhub.service.agency.search.CampaignField;
import com.aidigital.operationalhub.service.agency.search.ReportRowSortField;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.dashboard.DashboardDataSourceService;
import com.aidigital.operationalhub.service.entity.HubDashboardService;
import com.aidigital.operationalhub.service.entity.HubReportViewService;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/**
 * REST controller for the {@code /api/v1/campaigns} endpoints.
 *
 * <p>Implements the OpenAPI-generated {@link CampaignsApi}. Contains no business logic: it resolves
 * the current user, delegates to {@link CampaignService}/{@link ReportRowService} (which query
 * BigQuery), and maps the result into the generated contract.
 */
@RestController
@RequiredArgsConstructor
public class CampaignController implements CampaignsApi {

	private final CampaignService campaignService;
	private final InsertionOrderService insertionOrderService;
	private final ReportRowService reportRowService;
	private final ConversionAdjustmentService conversionAdjustmentService;
	private final HubReportViewService reportViewService;
	private final HubDashboardService dashboardService;
	private final DashboardDataSourceService dashboardDataSourceService;
	private final CurrentUserService currentUserService;
	private final CampaignSearchContractMapper campaignSearchMapper;
	private final InsertionOrderContractMapper insertionOrderMapper;
	private final ReportRowContractMapper reportRowMapper;
	private final ReportRowXlsxExportAssembler reportRowXlsxExportAssembler;
	private final ReportRowXlsxAssembler reportRowXlsxAssembler;
	private final ConversionAdjustmentXlsxAssembler conversionAdjustmentXlsxAssembler;

	private final ConversionBreakdownContractMapper conversionBreakdownMapper;
	private final ReportRowFileSupport reportRowFileSupport;
	private final XlsxDownloadResponder xlsxDownloadResponder;
	private final ReportViewContractMapper reportViewMapper;
	private final DashboardContractMapper dashboardMapper;
	private final ConstructedEntityContractMapper constructedEntityMapper;

	@Override
	public ResponseEntity<CampaignPageResponseV1> searchCampaigns(
			Integer pageNumber, Integer pageSize, CampaignSearchRequestV1 campaignSearchRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		SearchCriteria<CampaignField> criteria =
				campaignSearchMapper.toCriteria(campaignSearchRequestV1, pageNumber, pageSize);
		Page<CampaignModel> page = campaignService.searchCampaigns(currentUser, criteria);
		return ResponseEntity.ok(campaignSearchMapper.toPageResponse(page));
	}

	@Override
	public ResponseEntity<CampaignV1> getCampaign(Long campaignId) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		return ResponseEntity.ok(
				campaignSearchMapper.toV1(campaignService.getVisibleCampaign(currentUser, campaignId)));
	}

	@Override
	public ResponseEntity<List<InsertionOrderV1>> listCampaignInsertionOrders(Long campaignId) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		return ResponseEntity.ok(insertionOrderMapper.toV1(
				insertionOrderService.findCampaignInsertionOrders(currentUser, campaignId)));
	}

	@Override
	public ResponseEntity<ReportRowsPageResponseV1> listCampaignReportRows(
			Long campaignId, Integer pageNumber, Integer pageSize, ReportRowSearchRequestV1 reportRowSearchRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		ReportRowSearchCommand search = reportRowMapper.toSearchCommand(reportRowSearchRequestV1);
		ReportRowPageModel page = reportRowService.findReportRows(
				currentUser, campaignId, pageNumber, pageSize,
				search.groupBy(), search.sort(), search.filters(), search.dateRange());
		return ResponseEntity.ok(reportRowMapper.toPageResponse(page));
	}

	@Override
	public ResponseEntity<List<String>> listReportRowDistinctValues(Long campaignId, ReportRowFilterFieldEnumV1 field) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		ReportRowSortField sortField = reportRowMapper.toFilterField(field);
		return ResponseEntity.ok(reportRowService.findDistinctValues(currentUser, campaignId, sortField));
	}

	@Override
	public ResponseEntity<ConstructedEntityPageResponseV1> listConstructedEntities(
			Long campaignId, ConstructedEntityLevelEnumV1 level, String platform, String accountId, String name,
			Integer pageNumber, Integer pageSize) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		ConstructedEntityLevel resolvedLevel = constructedEntityMapper.toLevel(level);
		return ResponseEntity.ok(constructedEntityMapper.toPageResponse(reportRowService.findConstructedEntities(
				currentUser, campaignId, resolvedLevel, platform, accountId, name, pageNumber, pageSize)));
	}

	@Override
	public ResponseEntity<ConstructedIdsPreviewResponseV1> previewConstructedIds(
			Long campaignId, ConstructedIdsPreviewRequestV1 constructedIdsPreviewRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		ConstructedIdsPreviewModel preview = reportRowService.previewConstructedIds(
				currentUser, campaignId,
				constructedEntityMapper.toName(constructedIdsPreviewRequestV1),
				constructedEntityMapper.toNameLvl2(constructedIdsPreviewRequestV1),
				constructedEntityMapper.toNameLvl3(constructedIdsPreviewRequestV1));
		return ResponseEntity.ok(constructedEntityMapper.toResponse(preview));
	}

	@Override
	public ResponseEntity<Void> saveReportRowAdjustments(
			Long campaignId, ReportRowAdjustmentsRequestV1 reportRowAdjustmentsRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		List<AdjustmentRowModel> adjustments =
				reportRowMapper.toAdjustmentModels(reportRowAdjustmentsRequestV1.getAdjustments());
		reportRowService.saveAdjustments(currentUser, campaignId, adjustments);
		return ResponseEntity.noContent().build();
	}

	@Override
	public ResponseEntity<ReportRowAdjustmentRollbackResultV1> previewAdjustmentRollback(
			Long campaignId, ReportRowAdjustmentRollbackRequestV1 reportRowAdjustmentRollbackRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		AdjustmentRollbackResultModel preview = reportRowService.previewAdjustmentRollback(
				currentUser, campaignId,
				reportRowAdjustmentRollbackRequestV1.getCampaignConstructedNames(),
				reportRowAdjustmentRollbackRequestV1.getDateFrom().toString(),
				reportRowAdjustmentRollbackRequestV1.getDateTo().toString());
		return ResponseEntity.ok(reportRowMapper.toRollbackResult(preview));
	}

	@Override
	public ResponseEntity<ReportRowAdjustmentRollbackResultV1> rollbackAdjustments(
			Long campaignId, ReportRowAdjustmentRollbackRequestV1 reportRowAdjustmentRollbackRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		AdjustmentRollbackResultModel result = reportRowService.rollbackAdjustments(
				currentUser, campaignId,
				reportRowAdjustmentRollbackRequestV1.getCampaignConstructedNames(),
				reportRowAdjustmentRollbackRequestV1.getDateFrom().toString(),
				reportRowAdjustmentRollbackRequestV1.getDateTo().toString());
		return ResponseEntity.ok(reportRowMapper.toRollbackResult(result));
	}

	@Override
	public ResponseEntity<Resource> exportReportRows(
			Long campaignId, ReportRowSearchRequestV1 reportRowSearchRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		ReportRowSearchCommand search = reportRowMapper.toSearchCommand(reportRowSearchRequestV1);
		ReportRowExportModel export = reportRowService.exportReportRows(
				currentUser, campaignId, search.groupBy(), search.sort(), search.filters(), search.dateRange());
		return xlsxDownloadResponder.respond(export.campaignName(), "report", export.truncated(),
				out -> reportRowXlsxExportAssembler.writeWorkbook(
						out, export.rows(), search.columns(), search.columnOrder(), export.totals()));
	}

	@Override
	public ResponseEntity<Resource> downloadBulkAdjustmentTemplate(
			Long campaignId, ReportRowSearchRequestV1 reportRowSearchRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		ReportRowSearchCommand search = reportRowMapper.toSearchCommand(reportRowSearchRequestV1);
		// Always raw rows, whatever the on-screen report groups by: an upload of this template is matched
		// back to existing rows by natural key, and an aggregate row matches none of them.
		ReportRowExportModel export = reportRowService.exportReportRows(
				currentUser, campaignId, List.of(), search.sort(), search.filters(), search.dateRange());
		return xlsxDownloadResponder.respond(export.campaignName(), "bulk template", export.truncated(),
				out -> reportRowXlsxAssembler.writeWorkbook(out, export.rows()));
	}

	@Override
	public ResponseEntity<ReportRowBulkAdjustmentResultV1> uploadBulkAdjustments(Long campaignId, MultipartFile file) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		List<WorkbookAdjustmentRow> rows = reportRowXlsxAssembler.parse(reportRowFileSupport.readBytes(file));
		int applied = reportRowService.applyBulkAdjustments(currentUser, campaignId, rows);
		return ResponseEntity.ok(new ReportRowBulkAdjustmentResultV1().applied(applied));
	}

	@Override
	public ResponseEntity<Resource> downloadConversionAdjustmentTemplate(
			Long campaignId, ConversionRowSearchRequestV1 conversionRowSearchRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		ReportRowDateRangeModel dateRange = reportRowMapper.toDateRange(
				conversionRowSearchRequestV1 == null ? null : conversionRowSearchRequestV1.getDateFrom(),
				conversionRowSearchRequestV1 == null ? null : conversionRowSearchRequestV1.getDateTo());
		// The campaign is resolved once, inside the service; its name comes back with the rows rather than
		// being fetched again here just to name the file.
		ConversionRowExportModel export =
				conversionAdjustmentService.findConversionRows(currentUser, campaignId, dateRange);
		return xlsxDownloadResponder.respond(export.campaignName(), "conversions template", export.truncated(),
				out -> conversionAdjustmentXlsxAssembler.writeWorkbook(out, export.rows()));
	}

	@Override
	public ResponseEntity<ReportRowBulkAdjustmentResultV1> uploadConversionAdjustments(
			Long campaignId, MultipartFile file) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		List<WorkbookAdjustmentRow> rows =
				conversionAdjustmentXlsxAssembler.parse(reportRowFileSupport.readBytes(file));
		int applied = conversionAdjustmentService.applyConversionAdjustments(currentUser, campaignId, rows);
		return ResponseEntity.ok(new ReportRowBulkAdjustmentResultV1().applied(applied));
	}

	@Override
	public ResponseEntity<ConversionBreakdownV1> listConversionBreakdown(
			Long campaignId, ConversionBreakdownRequestV1 conversionBreakdownRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		List<ConversionRowModel> rows = conversionAdjustmentService.findConversionRowsBehind(
				currentUser, campaignId, conversionBreakdownMapper.toQuery(conversionBreakdownRequestV1));
		return ResponseEntity.ok(conversionBreakdownMapper.toBreakdown(rows));
	}

	@Override
	public ResponseEntity<ReportRowBulkAdjustmentResultV1> applyConversionAdjustments(
			Long campaignId, ConversionAdjustmentRequestV1 conversionAdjustmentRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		// The same service call the upload makes: an edited cell and an edited sheet differ only in how
		// the rows were typed, so they must not differ in how they are matched and written.
		int applied = conversionAdjustmentService.applyConversionAdjustments(
				currentUser, campaignId, conversionBreakdownMapper.toSubmittedRows(conversionAdjustmentRequestV1));
		return ResponseEntity.ok(new ReportRowBulkAdjustmentResultV1().applied(applied));
	}

	@Override
	public ResponseEntity<ReportViewPageResponseV1> listReportViews(
			Long campaignId, Integer pageNumber, Integer pageSize) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		campaignService.getVisibleCampaignIdentity(currentUser, campaignId);
		return ResponseEntity.ok(reportViewMapper.toPageResponse(
				reportViewService.listByCampaign(campaignId, pageNumber, pageSize)));
	}

	@Override
	public ResponseEntity<ReportViewV1> createReportView(Long campaignId, ReportViewUpsertV1 reportViewUpsertV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		campaignService.getVisibleCampaignIdentity(currentUser, campaignId);
		HubReportView created = reportViewService.create(campaignId, reportViewMapper.fromUpsert(reportViewUpsertV1));
		return ResponseEntity.status(HttpStatus.CREATED).body(reportViewMapper.toV1(created));
	}

	@Override
	public ResponseEntity<ReportViewV1> updateReportView(
			Long campaignId, Long viewId, ReportViewUpsertV1 reportViewUpsertV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		campaignService.getVisibleCampaignIdentity(currentUser, campaignId);
		HubReportView updated =
				reportViewService.update(campaignId, viewId, reportViewMapper.fromUpsert(reportViewUpsertV1));
		return ResponseEntity.ok(reportViewMapper.toV1(updated));
	}

	@Override
	public ResponseEntity<Void> deleteReportView(Long campaignId, Long viewId) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		campaignService.getVisibleCampaignIdentity(currentUser, campaignId);
		reportViewService.delete(campaignId, viewId);
		return ResponseEntity.noContent().build();
	}

	@Override
	public ResponseEntity<ReportViewV1> duplicateReportView(Long campaignId, Long viewId) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		campaignService.getVisibleCampaignIdentity(currentUser, campaignId);
		HubReportView copy = reportViewService.duplicate(campaignId, viewId);
		return ResponseEntity.status(HttpStatus.CREATED).body(reportViewMapper.toV1(copy));
	}

	@Override
	public ResponseEntity<DashboardPageResponseV1> listDashboards(
			Long campaignId, Integer pageNumber, Integer pageSize) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		campaignService.getVisibleCampaignIdentity(currentUser, campaignId);
		return ResponseEntity.ok(dashboardMapper.toPageResponse(
				dashboardService.listByCampaign(campaignId, pageNumber, pageSize)));
	}

	@Override
	public ResponseEntity<DashboardV1> createDashboard(Long campaignId, DashboardCreateV1 dashboardCreateV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		campaignService.getVisibleCampaignIdentity(currentUser, campaignId);
		HubDashboard created = dashboardService.create(campaignId, dashboardMapper.fromCreate(dashboardCreateV1));
		return ResponseEntity.status(HttpStatus.CREATED).body(dashboardMapper.toV1(created));
	}

	@Override
	public ResponseEntity<DashboardV1> updateDashboard(
			Long campaignId, Long dashboardId, DashboardUpdateV1 dashboardUpdateV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		campaignService.getVisibleCampaignIdentity(currentUser, campaignId);
		HubDashboard updated =
				dashboardService.update(campaignId, dashboardId, dashboardMapper.fromUpdate(dashboardUpdateV1));
		return ResponseEntity.ok(dashboardMapper.toV1(updated));
	}

	@Override
	public ResponseEntity<Void> deleteDashboard(Long campaignId, Long dashboardId) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		campaignService.getVisibleCampaignIdentity(currentUser, campaignId);
		dashboardService.delete(campaignId, dashboardId);
		return ResponseEntity.noContent().build();
	}

	@Override
	public ResponseEntity<DashboardV1> duplicateDashboard(Long campaignId, Long dashboardId) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		campaignService.getVisibleCampaignIdentity(currentUser, campaignId);
		HubDashboard copy = dashboardService.duplicate(campaignId, dashboardId);
		return ResponseEntity.status(HttpStatus.CREATED).body(dashboardMapper.toV1(copy));
	}

	@Override
	public ResponseEntity<DashboardPreviewV1> previewDashboardDataset(Long campaignId, Long dashboardId) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		// The campaign is resolved inside the service here, not in the controller: the write and the count run
		// the same query, and both have to be narrowed by the same resolved campaign.
		return ResponseEntity.ok(dashboardMapper.toV1(
				dashboardDataSourceService.preview(currentUser, campaignId, dashboardId)));
	}

	@Override
	public ResponseEntity<DashboardDatasetRowsPageResponseV1> listDashboardDatasetRows(
			Long campaignId,
			Long dashboardId,
			Integer pageNumber,
			Integer pageSize,
			DashboardDatasetRowsSearchRequestV1 dashboardDatasetRowsSearchRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		return ResponseEntity.ok(dashboardMapper.toPageResponse(dashboardDataSourceService.previewRows(
				currentUser,
				campaignId,
				dashboardId,
				pageNumber,
				pageSize,
				dashboardMapper.toCriteria(dashboardDatasetRowsSearchRequestV1))));
	}

	@Override
	public ResponseEntity<List<String>> listDashboardDatasetDistinctValues(
			Long campaignId, Long dashboardId, String field) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		return ResponseEntity.ok(dashboardDataSourceService.distinctValues(
				currentUser, campaignId, dashboardId, field));
	}

	@Override
	public ResponseEntity<DashboardV1> createDashboardDataSource(
			Long campaignId, Long dashboardId, DashboardDataSourceRequestV1 dashboardDataSourceRequestV1) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		HubDashboard live = dashboardDataSourceService.createDataSource(
				currentUser, campaignId, dashboardId, dashboardDataSourceRequestV1.getDisplayCampaignName());
		return ResponseEntity.ok(dashboardMapper.toV1(live));
	}

	@Override
	public ResponseEntity<DashboardV1> removeDashboardDataSource(Long campaignId, Long dashboardId) {
		CurrentUserModel currentUser = currentUserService.resolveCurrentUser();
		HubDashboard draft = dashboardDataSourceService.removeDataSource(currentUser, campaignId, dashboardId);
		return ResponseEntity.ok(dashboardMapper.toV1(draft));
	}
}
