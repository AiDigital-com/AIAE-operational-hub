package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.CampaignV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionAdjustmentRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionAdjustmentRowV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionBreakdownRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionRowSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DirectionEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.InsertionOrderV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowAdjustmentV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowAdjustmentsRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowFilterFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowFilterV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowSortFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowsPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardCreateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardDataSourceRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardDatasetRowsPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardDatasetRowsSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardPreviewV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardTypeEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewTypeEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewStatusEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewUpsertV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewV1;
import com.aidigital.operationalhub.application.mapper.CampaignSearchContractMapper;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionBreakdownV1;
import com.aidigital.operationalhub.application.mapper.ConversionAdjustmentXlsxAssembler;
import com.aidigital.operationalhub.application.mapper.ConversionBreakdownContractMapper;
import com.aidigital.operationalhub.application.mapper.InsertionOrderContractMapper;
import com.aidigital.operationalhub.application.mapper.ReportRowContractMapper;
import com.aidigital.operationalhub.application.mapper.ReportRowFileSupport;
import com.aidigital.operationalhub.application.mapper.ReportRowSearchCommand;
import com.aidigital.operationalhub.application.mapper.ReportRowXlsxAssembler;
import com.aidigital.operationalhub.application.mapper.ReportRowXlsxExportAssembler;
import com.aidigital.operationalhub.application.mapper.DashboardContractMapper;
import com.aidigital.operationalhub.application.mapper.ReportViewContractMapper;
import com.aidigital.operationalhub.application.mapper.XlsxDownloadResponder;
import com.aidigital.operationalhub.application.mapper.XlsxWriter;
import com.aidigital.operationalhub.domain.entity.HubDashboard;
import com.aidigital.operationalhub.domain.entity.HubReportView;
import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.ConversionAdjustmentService;
import com.aidigital.operationalhub.service.agency.InsertionOrderService;
import com.aidigital.operationalhub.service.agency.ReportRowService;
import com.aidigital.operationalhub.service.agency.model.AdjustmentRowModel;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.model.ConversionBreakdownQuery;
import com.aidigital.operationalhub.service.agency.model.ConversionRowExportModel;
import com.aidigital.operationalhub.service.agency.model.ConversionRowModel;
import com.aidigital.operationalhub.service.agency.model.InsertionOrderModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowExportModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowFilterModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowPageModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowTotalsModel;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import com.aidigital.operationalhub.service.agency.search.CampaignField;
import com.aidigital.operationalhub.service.agency.search.ReportRowSortField;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import com.aidigital.operationalhub.service.common.search.SortDirection;
import com.aidigital.operationalhub.service.dashboard.DashboardDataSourceService;
import com.aidigital.operationalhub.service.dashboard.model.DashboardColumnChoice;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetCriteria;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetFilter;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetPage;
import com.aidigital.operationalhub.service.dashboard.model.DashboardPreview;
import com.aidigital.operationalhub.service.entity.HubDashboardService;
import com.aidigital.operationalhub.service.entity.HubReportViewService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.mock.web.MockMultipartFile;

import java.io.ByteArrayOutputStream;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link CampaignController}.
 */
@ExtendWith(MockitoExtension.class)
class CampaignControllerTest {

	@Mock
	private CampaignService campaignService;

	@Mock
	private InsertionOrderService insertionOrderService;

	@Mock
	private ReportRowService reportRowService;

	@Mock
	private ConversionAdjustmentService conversionAdjustmentService;

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private CampaignSearchContractMapper campaignSearchMapper;

	@Mock
	private InsertionOrderContractMapper insertionOrderMapper;

	@Mock
	private ReportRowContractMapper reportRowMapper;

	@Mock
	private ReportRowXlsxExportAssembler reportRowXlsxExportAssembler;

	@Mock
	private ReportRowXlsxAssembler reportRowXlsxAssembler;

	@Mock
	private ConversionAdjustmentXlsxAssembler conversionAdjustmentXlsxAssembler;

	@Mock
	private ConversionBreakdownContractMapper conversionBreakdownMapper;

	@Mock
	private XlsxDownloadResponder xlsxDownloadResponder;

	@Mock
	private ReportRowFileSupport reportRowFileSupport;

	@Mock
	private HubReportViewService reportViewService;

	@Mock
	private ReportViewContractMapper reportViewMapper;

	@Mock
	private HubDashboardService dashboardService;

	@Mock
	private DashboardContractMapper dashboardMapper;

	@Mock
	private DashboardDataSourceService dashboardDataSourceService;

	@InjectMocks
	private CampaignController controller;

	@Test
	void shouldSearchCampaignsForCurrentUserTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		SearchCriteria<CampaignField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);
		Page<CampaignModel> page = new PageImpl<>(
				List.of(new CampaignModel(1L, "Fall Campaign", 10L, "Space Coast",
						20L, "&Barr", "Finished", "2025-10-14", "2026-01-31",
						50000.0, List.of("Display"), "Automotive", 4L)),
				PageRequest.of(0, 20), 1);
		CampaignPageResponseV1 response = new CampaignPageResponseV1();
		response.setTotalElements(1L);
		response.setContent(List.of());
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		when(campaignSearchMapper.toCriteria(null, 1, 20)).thenReturn(criteria);
		doReturn(page).when(campaignService).searchCampaigns(currentUser, criteria);
		doReturn(response).when(campaignSearchMapper).toPageResponse(page);

		// When:
		var result = controller.searchCampaigns(1, 20, null);

		// Then:
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		assertThat(result.getBody()).isNotNull();
		assertThat(result.getBody().getTotalElements()).isEqualTo(1L);
		verify(campaignService).searchCampaigns(currentUser, criteria);
	}

	@Test
	void shouldReturnOneVisibleCampaignByIdForTheCurrentUserTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		CampaignModel model = Instancio.create(CampaignModel.class);
		CampaignV1 body = new CampaignV1();
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(model).when(campaignService).getVisibleCampaign(currentUser, 46252L);
		doReturn(body).when(campaignSearchMapper).toV1(model);

		// When:
		var result = controller.getCampaign(46252L);

		// Then:
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		assertThat(result.getBody()).isSameAs(body);
		verify(campaignService).getVisibleCampaign(currentUser, 46252L);
	}

	@Test
	void shouldReturnCampaignInsertionOrdersForTheCurrentUserTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		List<InsertionOrderModel> models = List.of(Instancio.create(InsertionOrderModel.class));
		List<InsertionOrderV1> body = List.of(new InsertionOrderV1());
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(models).when(insertionOrderService).findCampaignInsertionOrders(currentUser, 46252L);
		doReturn(body).when(insertionOrderMapper).toV1(models);

		// When:
		var result = controller.listCampaignInsertionOrders(46252L);

		// Then:
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		assertThat(result.getBody()).isSameAs(body);
		verify(insertionOrderService).findCampaignInsertionOrders(currentUser, 46252L);
	}

	@Test
	void shouldListReportRowsForCurrentUserTest() {
		// Given: no request body at all (an optional POST body), so neither sort nor filters are requested
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		ReportRowSearchCommand search = new ReportRowSearchCommand(List.of(), null, List.of(), null, List.of(), List.of());
		ReportRowPageModel page = new ReportRowPageModel(List.of(), 1, 25, false, 0L, null, null, null, 0);
		ReportRowsPageResponseV1 response = new ReportRowsPageResponseV1();
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(search).when(reportRowMapper).toSearchCommand(null);
		doReturn(page).when(reportRowService).findReportRows(currentUser, 42L, 1, 25, List.of(), null, List.of(), null);
		doReturn(response).when(reportRowMapper).toPageResponse(page);

		// When:
		var result = controller.listCampaignReportRows(42L, 1, 25, null);

		// Then:
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		assertThat(result.getBody()).isEqualTo(response);
		verify(reportRowService).findReportRows(currentUser, 42L, 1, 25, List.of(), null, List.of(), null);
	}

	@Test
	void shouldMapTheRequestedSortThroughToTheServiceCallTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		ReportRowPageModel page = new ReportRowPageModel(List.of(), 1, 25, false, 0L, null, null, null, 0);
		SortCriterion<ReportRowSortField> sort = new SortCriterion<>(ReportRowSortField.CHANNEL, SortDirection.DESC);
		ReportRowSearchRequestV1 request = new ReportRowSearchRequestV1();
		request.setSortField(ReportRowSortFieldEnumV1.CHANNEL);
		request.setSortDirection(DirectionEnumV1.DESC);
		ReportRowSearchCommand search = new ReportRowSearchCommand(List.of(), sort, List.of(), null, List.of(), List.of());
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(search).when(reportRowMapper).toSearchCommand(request);
		doReturn(page).when(reportRowService).findReportRows(currentUser, 42L, 1, 25, List.of(), sort, List.of(), null);

		// When:
		controller.listCampaignReportRows(42L, 1, 25, request);

		// Then:
		verify(reportRowService).findReportRows(currentUser, 42L, 1, 25, List.of(), sort, List.of(), null);
	}

	@Test
	void shouldMapTheRequestedFiltersThroughToTheServiceCallTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		ReportRowPageModel page = new ReportRowPageModel(List.of(), 1, 25, false, 0L, null, null, null, 0);
		ReportRowFilterV1 filterV1 = new ReportRowFilterV1();
		filterV1.setField(ReportRowFilterFieldEnumV1.CHANNEL);
		filterV1.setValues(List.of("Display", "Video"));
		ReportRowSearchRequestV1 request = new ReportRowSearchRequestV1();
		request.setFilters(List.of(filterV1));
		List<ReportRowFilterModel> filters =
				List.of(new ReportRowFilterModel(ReportRowSortField.CHANNEL, List.of("Display", "Video")));
		ReportRowSearchCommand search = new ReportRowSearchCommand(List.of(), null, filters, null, List.of(), List.of());
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(search).when(reportRowMapper).toSearchCommand(request);
		doReturn(page).when(reportRowService).findReportRows(currentUser, 42L, 1, 25, List.of(), null, filters, null);

		// When:
		controller.listCampaignReportRows(42L, 1, 25, request);

		// Then:
		verify(reportRowService).findReportRows(currentUser, 42L, 1, 25, List.of(), null, filters, null);
	}

	@Test
	void shouldListDistinctValuesForCurrentUserTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		List<String> values = List.of("Display", "Video");
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(ReportRowSortField.CHANNEL).when(reportRowMapper).toFilterField(ReportRowFilterFieldEnumV1.CHANNEL);
		doReturn(values).when(reportRowService).findDistinctValues(currentUser, 42L, ReportRowSortField.CHANNEL);

		// When:
		var result = controller.listReportRowDistinctValues(42L, ReportRowFilterFieldEnumV1.CHANNEL);

		// Then:
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		assertThat(result.getBody()).isEqualTo(values);
		verify(reportRowService).findDistinctValues(currentUser, 42L, ReportRowSortField.CHANNEL);
	}

	@Test
	void shouldSaveReportRowAdjustmentsForCurrentUserTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		ReportRowAdjustmentV1 adjustmentV1 = new ReportRowAdjustmentV1();
		adjustmentV1.setAdded(false);
		adjustmentV1.setImpressions(1234L);
		ReportRowAdjustmentsRequestV1 request = new ReportRowAdjustmentsRequestV1();
		request.setAdjustments(List.of(adjustmentV1));
		AdjustmentRowModel model = Instancio.create(AdjustmentRowModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(List.of(model)).when(reportRowMapper).toAdjustmentModels(List.of(adjustmentV1));

		// When:
		var result = controller.saveReportRowAdjustments(42L, request);

		// Then:
		assertThat(result.getStatusCode().value()).isEqualTo(204);
		verify(reportRowService).saveAdjustments(currentUser, 42L, List.of(model));
	}

	@Test
	void shouldExportReportRowsAsXlsxTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		ReportRowExportModel export = new ReportRowExportModel(
				List.of(), false, "Q1 Launch/Promo", Instancio.create(ReportRowTotalsModel.class));
		ReportRowSearchRequestV1 request = new ReportRowSearchRequestV1();
		request.setDimensions(List.of("date", "line_item_id"));
		request.setMetrics(List.of("impressions"));
		request.setColumnOrder(List.of("impressions", "date", "line_item_id"));
		ReportRowSearchCommand search =
				new ReportRowSearchCommand(List.of(), null, List.of(), null,
						List.of("date", "line_item_id", "impressions"),
						List.of("impressions", "date", "line_item_id"));
		Resource streamedResource = new ByteArrayResource(new byte[] {1, 2, 3});
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(search).when(reportRowMapper).toSearchCommand(request);
		doReturn(export).when(reportRowService).exportReportRows(currentUser, 42L, List.of(), null, List.of(), null);
		doReturn(ResponseEntity.ok(streamedResource)).when(xlsxDownloadResponder)
				.respond(eq("Q1 Launch/Promo"), eq("report"), eq(false), any(XlsxWriter.class));

		// When:
		var result = controller.exportReportRows(42L, request);

		// Then: the campaign name, what the file is, and whether it was capped - the headers built from
		// those are XlsxDownloadResponder's own test's business
		assertThat(result.getStatusCode().value()).isEqualTo(200);
		assertThat(result.getBody()).isSameAs(streamedResource);

		// The controller hands the responder a writer closure - invoke it here to verify it delegates
		// to the export assembler with the resolved rows, current-view columns, the requested column
		// order and the report's totals.
		ArgumentCaptor<XlsxWriter> writerCaptor = ArgumentCaptor.forClass(XlsxWriter.class);
		verify(xlsxDownloadResponder).respond(eq("Q1 Launch/Promo"), eq("report"), eq(false), writerCaptor.capture());
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		writerCaptor.getValue().write(out);
		verify(reportRowXlsxExportAssembler).writeWorkbook(
				out, export.rows(), List.of("date", "line_item_id", "impressions"),
				List.of("impressions", "date", "line_item_id"), export.totals());
	}

	@Test
	void shouldPassAnAbsentColumnOrderThroughToTheAssemblerUntouchedTest() throws Exception {
		// Given: a request that never sets columnOrder - the command carries whatever the mapper resolved
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		ReportRowExportModel export = new ReportRowExportModel(
				List.of(), false, "Q1 Launch/Promo", Instancio.create(ReportRowTotalsModel.class));
		ReportRowSearchRequestV1 request = new ReportRowSearchRequestV1();
		ReportRowSearchCommand search = new ReportRowSearchCommand(List.of(), null, List.of(), null, List.of(), null);
		Resource streamedResource = new ByteArrayResource(new byte[] {1, 2, 3});
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(search).when(reportRowMapper).toSearchCommand(request);
		doReturn(export).when(reportRowService).exportReportRows(currentUser, 42L, List.of(), null, List.of(), null);
		doReturn(ResponseEntity.ok(streamedResource)).when(xlsxDownloadResponder)
				.respond(eq("Q1 Launch/Promo"), eq("report"), eq(false), any(XlsxWriter.class));

		// When:
		controller.exportReportRows(42L, request);

		// Then: the controller forwards the null it was given rather than inventing a default itself
		ArgumentCaptor<XlsxWriter> writerCaptor = ArgumentCaptor.forClass(XlsxWriter.class);
		verify(xlsxDownloadResponder).respond(eq("Q1 Launch/Promo"), eq("report"), eq(false), writerCaptor.capture());
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		writerCaptor.getValue().write(out);
		verify(reportRowXlsxExportAssembler).writeWorkbook(out, export.rows(), List.of(), null, export.totals());
	}

	@Test
	void shouldExportTheCurrentViewAtItsOwnGrainTest() {
		// Given: a current-view export of a report grouped by date + channel
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		ReportRowExportModel export = new ReportRowExportModel(
				List.of(), false, "Q1 Launch", Instancio.create(ReportRowTotalsModel.class));
		ReportRowSearchRequestV1 request = new ReportRowSearchRequestV1();
		request.setGroupBy(List.of(ReportRowFilterFieldEnumV1.DATE, ReportRowFilterFieldEnumV1.CHANNEL));
		List<ReportRowSortField> groupBy = List.of(ReportRowSortField.DATE, ReportRowSortField.CHANNEL);
		ReportRowSearchCommand search = new ReportRowSearchCommand(groupBy, null, List.of(), null, List.of(), List.of());
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(search).when(reportRowMapper).toSearchCommand(request);
		doReturn(export).when(reportRowService).exportReportRows(currentUser, 42L, groupBy, null, List.of(), null);

		// When:
		controller.exportReportRows(42L, request);

		// Then: the export reads the grouped view, so the file matches the table row for row
		verify(reportRowService).exportReportRows(same(currentUser), eq(42L), eq(groupBy), eq(null), eq(List.of()), eq(null));
	}

	@Test
	void shouldKeepTheBulkTemplateRawEvenWhenTheReportIsGroupedTest() {
		// Given: the same grouped report, but the offline bulk-adjustment template
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		ReportRowExportModel export = new ReportRowExportModel(
				List.of(), false, "Q1 Launch", Instancio.create(ReportRowTotalsModel.class));
		ReportRowSearchRequestV1 request = new ReportRowSearchRequestV1();
		request.setGroupBy(List.of(ReportRowFilterFieldEnumV1.DATE));
		ReportRowSearchCommand search =
				new ReportRowSearchCommand(List.of(ReportRowSortField.DATE), null, List.of(), null, List.of(), List.of());
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(search).when(reportRowMapper).toSearchCommand(request);
		doReturn(export).when(reportRowService).exportReportRows(currentUser, 42L, List.of(), null, List.of(), null);

		// When:
		controller.downloadBulkAdjustmentTemplate(42L, request);

		// Then: raw rows regardless - an uploaded aggregate row would match no existing row on save
		verify(reportRowService).exportReportRows(same(currentUser), eq(42L), eq(List.of()), eq(null), eq(List.of()), eq(null));
	}

	@Test
	void shouldDownloadBulkAdjustmentTemplateAsXlsxTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		ReportRowExportModel export = new ReportRowExportModel(
				List.of(), false, "Q1 Launch/Promo", Instancio.create(ReportRowTotalsModel.class));
		ReportRowSearchRequestV1 request = new ReportRowSearchRequestV1();
		ReportRowSearchCommand search = new ReportRowSearchCommand(List.of(), null, List.of(), null, List.of(), List.of());
		Resource streamedResource = new ByteArrayResource(new byte[] {1, 2, 3});
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(search).when(reportRowMapper).toSearchCommand(request);
		doReturn(export).when(reportRowService).exportReportRows(currentUser, 42L, List.of(), null, List.of(), null);
		doReturn(ResponseEntity.ok(streamedResource)).when(xlsxDownloadResponder)
				.respond(eq("Q1 Launch/Promo"), eq("bulk template"), eq(false), any(XlsxWriter.class));

		// When:
		var result = controller.downloadBulkAdjustmentTemplate(42L, request);

		// Then: its own file suffix, so the two templates cannot be confused for one another on disk
		assertThat(result.getStatusCode().value()).isEqualTo(200);
		assertThat(result.getBody()).isSameAs(streamedResource);
		verify(reportRowService).exportReportRows(same(currentUser), eq(42L), eq(List.of()), eq(null), eq(List.of()), eq(null));

		ArgumentCaptor<XlsxWriter> writerCaptor = ArgumentCaptor.forClass(XlsxWriter.class);
		verify(xlsxDownloadResponder)
				.respond(eq("Q1 Launch/Promo"), eq("bulk template"), eq(false), writerCaptor.capture());
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		writerCaptor.getValue().write(out);
		verify(reportRowXlsxAssembler).writeWorkbook(out, export.rows());
	}

	@Test
	void shouldApplyUploadedBulkAdjustmentsAndReturnTheAppliedCountTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		byte[] fileBytes = {4, 5, 6};
		MockMultipartFile file = new MockMultipartFile("file", "edits.xlsx", "application/octet-stream", fileBytes);
		List<WorkbookAdjustmentRow> rows = List.of(new WorkbookAdjustmentRow(2, Map.of("date", "2026-03-10")));
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(fileBytes).when(reportRowFileSupport).readBytes(file);
		doReturn(rows).when(reportRowXlsxAssembler).parse(fileBytes);
		doReturn(3).when(reportRowService).applyBulkAdjustments(currentUser, 42L, rows);

		// When:
		var result = controller.uploadBulkAdjustments(42L, file);

		// Then:
		assertThat(result.getStatusCode().value()).isEqualTo(200);
		assertThat(result.getBody().getApplied()).isEqualTo(3);
		verify(reportRowService).applyBulkAdjustments(same(currentUser), eq(42L), same(rows));
	}

	@Test
	void shouldDownloadTheConversionsTemplateAsXlsxTest() throws Exception {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		List<ConversionRowModel> rows = List.of(Instancio.create(ConversionRowModel.class));
		ConversionRowExportModel export = new ConversionRowExportModel(rows, true, "Q1 Launch/Promo");
		Resource streamedResource = new ByteArrayResource(new byte[] {1, 2, 3});
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(null).when(reportRowMapper).toDateRange(null, null);
		doReturn(export).when(conversionAdjustmentService).findConversionRows(currentUser, 42L, null);
		doReturn(ResponseEntity.ok(streamedResource)).when(xlsxDownloadResponder)
				.respond(eq("Q1 Launch/Promo"), eq("conversions template"), eq(true), any(XlsxWriter.class));

		// When:
		var result = controller.downloadConversionAdjustmentTemplate(42L, new ConversionRowSearchRequestV1());

		// Then: its own file suffix, and the truncation flag passed on - a short template looks exactly
		// like a complete one, so the cap has to reach the client
		assertThat(result.getStatusCode().value()).isEqualTo(200);
		assertThat(result.getBody()).isSameAs(streamedResource);

		ArgumentCaptor<XlsxWriter> writerCaptor = ArgumentCaptor.forClass(XlsxWriter.class);
		verify(xlsxDownloadResponder)
				.respond(eq("Q1 Launch/Promo"), eq("conversions template"), eq(true), writerCaptor.capture());
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		writerCaptor.getValue().write(out);
		verify(conversionAdjustmentXlsxAssembler).writeWorkbook(out, rows);
	}

	@Test
	void shouldApplyUploadedConversionAdjustmentsAndReturnTheAppliedCountTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		byte[] fileBytes = {4, 5, 6};
		MockMultipartFile file = new MockMultipartFile("file", "conversions.xlsx", null, fileBytes);
		List<WorkbookAdjustmentRow> rows = List.of(new WorkbookAdjustmentRow(2, Map.of("conversions", "30")));
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(fileBytes).when(reportRowFileSupport).readBytes(file);
		doReturn(rows).when(conversionAdjustmentXlsxAssembler).parse(fileBytes);
		doReturn(2).when(conversionAdjustmentService).applyConversionAdjustments(currentUser, 42L, rows);

		// When:
		var result = controller.uploadConversionAdjustments(42L, file);

		// Then: parsed by the conversions assembler and written by the conversions service, not the
		// delivery pair - the two tables have different keys and different grains
		assertThat(result.getStatusCode().value()).isEqualTo(200);
		assertThat(result.getBody().getApplied()).isEqualTo(2);
		verify(conversionAdjustmentService).applyConversionAdjustments(same(currentUser), eq(42L), same(rows));
		verify(reportRowService, never()).applyBulkAdjustments(any(), anyLong(), any());
	}

	@Test
	void shouldReturnTheConversionsBehindOneReportRowTest() {
		// Given: a report row named by the columns the report joins conversions on
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		ConversionBreakdownRequestV1 request = new ConversionBreakdownRequestV1()
				.date(LocalDate.of(2026, 4, 23))
				.levelOneName("barr_SCOT_Fall Campaign_Display");
		ConversionBreakdownQuery query = new ConversionBreakdownQuery(
				"2026-04-23", "barr_SCOT_Fall Campaign_Display", null, "Display");
		List<ConversionRowModel> rows = List.of(Instancio.create(ConversionRowModel.class));
		ConversionBreakdownV1 response = new ConversionBreakdownV1().rows(List.of());
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(query).when(conversionBreakdownMapper).toQuery(request);
		doReturn(rows).when(conversionAdjustmentService)
				.findConversionRowsBehind(same(currentUser), eq(42L), same(query));
		doReturn(response).when(conversionBreakdownMapper).toBreakdown(rows);

		// When:
		var result = controller.listConversionBreakdown(42L, request);

		// Then:
		assertThat(result.getStatusCode().value()).isEqualTo(200);
		assertThat(result.getBody()).isSameAs(response);
		verify(conversionAdjustmentService).findConversionRowsBehind(same(currentUser), eq(42L), same(query));
	}

	@Test
	void shouldSendAnEditedRowThroughTheUploadsOwnWritePathTest() {
		// Given: one row edited in the report itself rather than in a spreadsheet
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		ConversionAdjustmentRequestV1 request = new ConversionAdjustmentRequestV1().rows(List.of(
				new ConversionAdjustmentRowV1().date("2026-04-23").conversions(4444.0)));
		List<WorkbookAdjustmentRow> rows = List.of(new WorkbookAdjustmentRow(1, Map.of("conversions", "4444.0")));
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(rows).when(conversionBreakdownMapper).toSubmittedRows(request);
		doReturn(1).when(conversionAdjustmentService)
				.applyConversionAdjustments(same(currentUser), eq(42L), same(rows));

		// When:
		var result = controller.applyConversionAdjustments(42L, request);

		// Then: the same service call the upload makes - one matching-and-writing path, whichever way the
		// rows were typed. The delivery pair stays out of it: different table, different key.
		assertThat(result.getStatusCode().value()).isEqualTo(200);
		assertThat(result.getBody().getApplied()).isEqualTo(1);
		verify(conversionAdjustmentService).applyConversionAdjustments(same(currentUser), eq(42L), same(rows));
		verify(reportRowService, never()).applyBulkAdjustments(any(), anyLong(), any());
	}

	private ReportViewUpsertV1 upsertRequest(String name) {
		ReportViewUpsertV1 request = new ReportViewUpsertV1();
		request.setName(name);
		request.setType(ReportViewTypeEnumV1.BASIC);
		request.setStatus(ReportViewStatusEnumV1.DRAFT);
		request.setDimensions(List.of("date"));
		request.setMetrics(List.of("spend"));
		return request;
	}

	@Test
	void shouldListReportViewsForVisibleCampaignTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.create(CampaignModel.class);
		HubReportView entity = new HubReportView();
		Page<HubReportView> page = new PageImpl<>(List.of(entity), PageRequest.of(0, 25), 1);
		ReportViewPageResponseV1 response = new ReportViewPageResponseV1();
		response.setTotalElements(1L);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(currentUser, 42L);
		doReturn(page).when(reportViewService).listByCampaign(42L, 1, 25);
		doReturn(response).when(reportViewMapper).toPageResponse(page);

		// When:
		var result = controller.listReportViews(42L, 1, 25);

		// Then:
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		assertThat(result.getBody()).isEqualTo(response);
		verify(reportViewService).listByCampaign(42L, 1, 25);
	}

	@Test
	void shouldCreateReportViewTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.create(CampaignModel.class);
		ReportViewUpsertV1 request = upsertRequest("New report");
		HubReportView mapped = new HubReportView();
		HubReportView created = new HubReportView();
		ReportViewV1 v1 = new ReportViewV1();
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(currentUser, 42L);
		doReturn(mapped).when(reportViewMapper).fromUpsert(request);
		doReturn(created).when(reportViewService).create(42L, mapped);
		doReturn(v1).when(reportViewMapper).toV1(created);

		// When:
		var result = controller.createReportView(42L, request);

		// Then:
		assertThat(result.getStatusCode().value()).isEqualTo(201);
		assertThat(result.getBody()).isEqualTo(v1);
		verify(reportViewService).create(42L, mapped);
	}

	@Test
	void shouldUpdateReportViewTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.create(CampaignModel.class);
		ReportViewUpsertV1 request = upsertRequest("Renamed report");
		HubReportView mapped = new HubReportView();
		HubReportView updated = new HubReportView();
		ReportViewV1 v1 = new ReportViewV1();
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(currentUser, 42L);
		doReturn(mapped).when(reportViewMapper).fromUpsert(request);
		doReturn(updated).when(reportViewService).update(42L, 7L, mapped);
		doReturn(v1).when(reportViewMapper).toV1(updated);

		// When:
		var result = controller.updateReportView(42L, 7L, request);

		// Then:
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		assertThat(result.getBody()).isEqualTo(v1);
		verify(reportViewService).update(42L, 7L, mapped);
	}

	@Test
	void shouldDeleteReportViewTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.create(CampaignModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(currentUser, 42L);

		// When:
		var result = controller.deleteReportView(42L, 7L);

		// Then:
		assertThat(result.getStatusCode().value()).isEqualTo(204);
		verify(reportViewService).delete(42L, 7L);
	}

	@Test
	void shouldDuplicateReportViewTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.create(CampaignModel.class);
		HubReportView copy = new HubReportView();
		ReportViewV1 v1 = new ReportViewV1();
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(currentUser, 42L);
		doReturn(copy).when(reportViewService).duplicate(42L, 7L);
		doReturn(v1).when(reportViewMapper).toV1(copy);

		// When:
		var result = controller.duplicateReportView(42L, 7L);

		// Then:
		assertThat(result.getStatusCode().value()).isEqualTo(201);
		assertThat(result.getBody()).isEqualTo(v1);
		verify(reportViewService).duplicate(42L, 7L);
	}

	@Test
	void shouldListDashboardsForVisibleCampaignTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.create(CampaignModel.class);
		HubDashboard entity = new HubDashboard();
		Page<HubDashboard> page = new PageImpl<>(List.of(entity), PageRequest.of(0, 25), 1);
		DashboardPageResponseV1 response = new DashboardPageResponseV1();
		response.setTotalElements(1L);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(currentUser, 42L);
		doReturn(page).when(dashboardService).listByCampaign(42L, 1, 25);
		doReturn(response).when(dashboardMapper).toPageResponse(page);

		// When:
		var result = controller.listDashboards(42L, 1, 25);

		// Then:
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		assertThat(result.getBody()).isEqualTo(response);
		verify(dashboardService).listByCampaign(42L, 1, 25);
	}

	@Test
	void shouldCreateDashboardTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.create(CampaignModel.class);
		DashboardCreateV1 request = new DashboardCreateV1()
				.name("Client dashboard")
				.type(DashboardTypeEnumV1.BASIC)
				.optionalColumns(List.of("creative", "cpa"));
		HubDashboard mapped = new HubDashboard();
		HubDashboard created = new HubDashboard();
		DashboardV1 v1 = new DashboardV1();
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(currentUser, 42L);
		doReturn(mapped).when(dashboardMapper).fromCreate(request);
		doReturn(created).when(dashboardService).create(42L, mapped);
		doReturn(v1).when(dashboardMapper).toV1(created);

		// When:
		var result = controller.createDashboard(42L, request);

		// Then:
		assertThat(result.getStatusCode().value()).isEqualTo(201);
		assertThat(result.getBody()).isEqualTo(v1);
		verify(dashboardService).create(42L, mapped);
	}

	@Test
	void shouldUpdateDashboardTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.create(CampaignModel.class);
		DashboardUpdateV1 request = new DashboardUpdateV1()
				.name("Renamed dashboard")
				.optionalColumns(List.of("cpa"));
		HubDashboard mapped = new HubDashboard();
		HubDashboard updated = new HubDashboard();
		DashboardV1 v1 = new DashboardV1();
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(currentUser, 42L);
		doReturn(mapped).when(dashboardMapper).fromUpdate(request);
		doReturn(updated).when(dashboardService).update(42L, 7L, mapped);
		doReturn(v1).when(dashboardMapper).toV1(updated);

		// When:
		var result = controller.updateDashboard(42L, 7L, request);

		// Then:
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		assertThat(result.getBody()).isEqualTo(v1);
		verify(dashboardService).update(42L, 7L, mapped);
	}

	@Test
	void shouldDeleteDashboardTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.create(CampaignModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(currentUser, 42L);

		// When:
		var result = controller.deleteDashboard(42L, 7L);

		// Then:
		assertThat(result.getStatusCode().value()).isEqualTo(204);
		verify(dashboardService).delete(42L, 7L);
	}

	@Test
	void shouldDuplicateDashboardTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		CampaignModel campaign = Instancio.create(CampaignModel.class);
		HubDashboard copy = new HubDashboard();
		DashboardV1 v1 = new DashboardV1();
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(campaign).when(campaignService).getVisibleCampaignIdentity(currentUser, 42L);
		doReturn(copy).when(dashboardService).duplicate(42L, 7L);
		doReturn(v1).when(dashboardMapper).toV1(copy);

		// When:
		var result = controller.duplicateDashboard(42L, 7L);

		// Then:
		assertThat(result.getStatusCode().value()).isEqualTo(201);
		assertThat(result.getBody()).isEqualTo(v1);
		verify(dashboardService).duplicate(42L, 7L);
	}

	@Test
	void shouldPreviewTheDashboardDatasetTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		DashboardPreview preview = new DashboardPreview(1234L, new DashboardColumnChoice(true, false), "p.d.t");
		DashboardPreviewV1 v1 = new DashboardPreviewV1();
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(preview).when(dashboardDataSourceService).preview(currentUser, 42L, 7L);
		doReturn(v1).when(dashboardMapper).toV1(preview);

		// When:
		var result = controller.previewDashboardDataset(42L, 7L);

		// Then:
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		assertThat(result.getBody()).isEqualTo(v1);
	}

	@Test
	void shouldListDashboardDatasetRowsTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		DashboardDatasetRowsSearchRequestV1 request = new DashboardDatasetRowsSearchRequestV1();
		DashboardDatasetCriteria criteria = new DashboardDatasetCriteria(
				List.of(new DashboardDatasetFilter("Channel", List.of("Display"))), null, null);
		DashboardDatasetPage page = new DashboardDatasetPage(1, 25, 1L, 1, List.of());
		DashboardDatasetRowsPageResponseV1 response = new DashboardDatasetRowsPageResponseV1();
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(criteria).when(dashboardMapper).toCriteria(request);
		doReturn(page).when(dashboardDataSourceService).previewRows(currentUser, 42L, 7L, 1, 25, criteria);
		doReturn(response).when(dashboardMapper).toPageResponse(page);

		// When:
		var result = controller.listDashboardDatasetRows(42L, 7L, 1, 25, request);

		// Then:
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		assertThat(result.getBody()).isEqualTo(response);
		verify(dashboardDataSourceService).previewRows(currentUser, 42L, 7L, 1, 25, criteria);
	}

	@Test
	void shouldListDashboardDatasetDistinctValuesTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(List.of("Display", "Video"))
				.when(dashboardDataSourceService).distinctValues(currentUser, 42L, 7L, "Channel");

		// When:
		var result = controller.listDashboardDatasetDistinctValues(42L, 7L, "Channel");

		// Then:
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		assertThat(result.getBody()).containsExactly("Display", "Video");
		verify(dashboardDataSourceService).distinctValues(currentUser, 42L, 7L, "Channel");
	}

	@Test
	void shouldCreateTheDashboardDataSourceWithTheConfirmedNameTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		DashboardDataSourceRequestV1 request = new DashboardDataSourceRequestV1()
				.displayCampaignName("Acme - Summer");
		HubDashboard live = new HubDashboard();
		DashboardV1 v1 = new DashboardV1();
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(live).when(dashboardDataSourceService)
				.createDataSource(currentUser, 42L, 7L, "Acme - Summer");
		doReturn(v1).when(dashboardMapper).toV1(live);

		// When:
		var result = controller.createDashboardDataSource(42L, 7L, request);

		// Then:
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		assertThat(result.getBody()).isEqualTo(v1);
		verify(dashboardDataSourceService).createDataSource(currentUser, 42L, 7L, "Acme - Summer");
	}

	@Test
	void shouldRemoveTheDashboardDataSourceTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		HubDashboard draft = new HubDashboard();
		DashboardV1 v1 = new DashboardV1();
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doReturn(draft).when(dashboardDataSourceService).removeDataSource(currentUser, 42L, 7L);
		doReturn(v1).when(dashboardMapper).toV1(draft);

		// When:
		var result = controller.removeDashboardDataSource(42L, 7L);

		// Then:
		assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
		assertThat(result.getBody()).isEqualTo(v1);
		verify(dashboardDataSourceService).removeDataSource(currentUser, 42L, 7L);
	}

	@Test
	void shouldRejectDashboardAccessWhenCampaignNotVisibleTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doThrow(new BusinessException(OperationalHubErrorReason.OPH_025, 99L))
				.when(campaignService).getVisibleCampaignIdentity(currentUser, 99L);

		// When-Then: a campaign nobody may see has no dashboards to list either
		assertThatThrownBy(() -> controller.listDashboards(99L, 1, 25))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_025");
	}

	@Test
	void shouldRejectReportViewAccessWhenCampaignNotVisibleTest() {
		// Given:
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		doThrow(new BusinessException(OperationalHubErrorReason.OPH_025, 99L))
				.when(campaignService).getVisibleCampaignIdentity(currentUser, 99L);

		// When/Then:
		assertThatThrownBy(() -> controller.listReportViews(99L, 1, 25))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_025");
	}
}
