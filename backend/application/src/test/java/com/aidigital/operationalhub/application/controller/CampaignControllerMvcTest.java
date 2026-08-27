package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.exception.GlobalExceptionHandler;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelperImpl;
import com.aidigital.operationalhub.application.mapper.CampaignSearchContractMapper;
import com.aidigital.operationalhub.application.mapper.ConstructedEntityContractMapper;
import com.aidigital.operationalhub.application.mapper.ConversionAdjustmentXlsxAssembler;
import com.aidigital.operationalhub.application.mapper.ConversionBreakdownContractMapper;
import com.aidigital.operationalhub.application.mapper.DashboardContractMapper;
import com.aidigital.operationalhub.application.mapper.InsertionOrderContractMapper;
import com.aidigital.operationalhub.application.mapper.ReportRowContractMapper;
import com.aidigital.operationalhub.application.mapper.ReportRowFileSupport;
import com.aidigital.operationalhub.application.mapper.ReportRowXlsxAssembler;
import com.aidigital.operationalhub.application.mapper.ReportRowXlsxExportAssembler;
import com.aidigital.operationalhub.application.mapper.ReportViewContractMapper;
import com.aidigital.operationalhub.application.mapper.XlsxDownloadResponder;
import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.ConversionAdjustmentService;
import com.aidigital.operationalhub.service.agency.InsertionOrderService;
import com.aidigital.operationalhub.service.agency.ReportRowService;
import com.aidigital.operationalhub.service.agency.model.AdjustmentRowModel;
import com.aidigital.operationalhub.service.dashboard.DashboardDataSourceService;
import com.aidigital.operationalhub.service.entity.HubDashboardService;
import com.aidigital.operationalhub.service.entity.HubReportViewService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc contract tests for the PDI_117 Add Line endpoints on {@link CampaignController} - one negative
 * {@code 400} test per constrained new operation (`.claude/rules/30-web-openapi.md`).
 */
@ExtendWith(MockitoExtension.class)
class CampaignControllerMvcTest {

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

	@Mock
	private ConstructedEntityContractMapper constructedEntityMapper;

	@InjectMocks
	private CampaignController controller;

	@Test
	void shouldRejectListConstructedEntitiesWhenTheRequiredLevelParamIsMissingTest() throws Exception {
		// Given: level is a required query parameter with no default
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		lenient().doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When/Then:
		mockMvc.perform(get("/api/v1/campaigns/42/report-rows/constructed-entities"))
				.andExpect(status().isBadRequest());
	}

	@Test
	void shouldRejectPreviewConstructedIdsWhenALevelNameIsBlankTest() throws Exception {
		// Given: constructed_name has minLength: 1 - blank fails bean validation on the request body
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		lenient().doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When/Then:
		mockMvc.perform(post("/api/v1/campaigns/42/report-rows/constructed-ids/preview")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"constructed_name\":\"\",\"constructed_name_lvl2\":\"L2\","
								+ "\"constructed_name_lvl3\":\"L3\"}"))
				.andExpect(status().isBadRequest());
	}

	@Test
	void shouldRejectPreviewConstructedIdsWhenALevelNameIsMissingTest() throws Exception {
		// Given: all three names are required
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		lenient().doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When/Then:
		mockMvc.perform(post("/api/v1/campaigns/42/report-rows/constructed-ids/preview")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"constructed_name\":\"L1\",\"constructed_name_lvl2\":\"L2\"}"))
				.andExpect(status().isBadRequest());
	}

	@Test
	void shouldRejectSaveReportRowAdjustmentsWhenAGeneratedLevelAlreadyExistsInPlatformDataTest() throws Exception {
		// Given: PDI_117 V8 - AddedRowValidator rejects a level submitted for generation whose name
		// already resolves to real mart data, surfaced by saveReportRowAdjustments as OPH_049
		CurrentUserModel currentUser = Instancio.create(CurrentUserModel.class);
		List<AdjustmentRowModel> mappedAdjustments = List.of(Instancio.create(AdjustmentRowModel.class));
		lenient().doReturn(currentUser).when(currentUserService).resolveCurrentUser();
		lenient().doReturn(mappedAdjustments).when(reportRowMapper).toAdjustmentModels(any());
		doThrow(new BusinessException(OperationalHubErrorReason.OPH_049))
				.when(reportRowService).saveAdjustments(eq(currentUser), eq(42L), eq(mappedAdjustments));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When/Then:
		mockMvc.perform(post("/api/v1/campaigns/42/report-rows/adjustments")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"adjustments\":[{\"added\":true,\"date\":\"2026-03-15\"}]}"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.code").value("OPH_049"));
	}
}
