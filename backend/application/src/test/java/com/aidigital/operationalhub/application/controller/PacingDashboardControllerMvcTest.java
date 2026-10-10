package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingAddableLineItemsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingMappingSuggestionsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDashboardV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDisplayUpdateResultV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffCountsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingNsDiffReportV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingPlanUpdateResultV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingRefreshStatusV1;
import com.aidigital.operationalhub.application.exception.GlobalExceptionHandler;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelperImpl;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingDashboardContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingNsDiffContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingPlanContractMapper;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAddableLineItems;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleBand;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleBase;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleDays;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleFactor;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleGapDays;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleGapPp;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleSpend;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleThresholdPct;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertRuleWindowThreshold;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAlertsConfig;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDashboardData;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDataSettings;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignLink;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLineItemPlanUpdate;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDisplaySaveOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNotifyMetrics;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNotifySettings;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffReport;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshOutcome;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingThirdPartyCampaignV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingThirdPartyCampaignsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingThirdPartyDataV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingThirdPartyStatusV1;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyCampaign;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingMappingSuggestions;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyRefetchOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyCampaigns;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyData;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingThirdPartyStatus;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshStatus;
import com.aidigital.operationalhub.service.pacinglinks.CampaignLinksValidator;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
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
import java.util.Map;

import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc contract tests for {@link PacingDashboardController} (§6 of the migration plan).
 */
@ExtendWith(MockitoExtension.class)
class PacingDashboardControllerMvcTest {

	// §14 - PacingNotifySettingsV1 is a whole-object replace, so every one of the 13 alert keys is a
	// required field; a partial body like the data-settings tests use would 400 before the controller
	// even runs.
	private static final String FULL_NOTIFY_SETTINGS_JSON = "{"
			+ "\"alerts\":{\"enabled\":true,"
			+ "\"bidFactAbovePlan\":{\"enabled\":true,\"slack\":true,\"window\":2,\"thresholdPct\":5},"
			+ "\"dataGap\":{\"enabled\":true,\"slack\":true,\"gapDays\":1},"
			+ "\"ctrBelowTarget\":{\"enabled\":true,\"slack\":true,\"factor\":0.7},"
			+ "\"vcrBelowTarget\":{\"enabled\":true,\"slack\":true,\"factor\":0.7},"
			+ "\"ctrAboveTarget\":{\"enabled\":true,\"slack\":true,\"factor\":2.0},"
			+ "\"vcrOver100\":{\"enabled\":true,\"slack\":true},"
			+ "\"noImpressionsYet\":{\"enabled\":true,\"slack\":true},"
			+ "\"pacingOffPace\":{\"enabled\":true,\"slack\":true,\"low\":-5,\"high\":5},"
			+ "\"marginBelowTarget\":{\"enabled\":true,\"slack\":true,\"gapPp\":3},"
			+ "\"spendOverspend\":{\"enabled\":true,\"slack\":true,\"warnPct\":90,\"badPct\":100},"
			+ "\"dspForecastOverspend\":{\"enabled\":true,\"slack\":true},"
			+ "\"staleData\":{\"enabled\":true,\"slack\":true,\"days\":2},"
			+ "\"rateCostAbovePlan\":{\"enabled\":true,\"slack\":true,\"thresholdPct\":10}},"
			+ "\"metrics\":{\"vcr\":false},\"hidePaused\":false,\"summaryProjection\":\"reforecast\"}";

	@Mock
	private CurrentUserService currentUserService;

	@Mock
	private PacingScopeResolver pacingScopeResolver;

	@Mock
	private PacingClient pacingClient;

	@Mock
	private PacingContractMapper assertionMapper;

	@Mock
	private PacingDashboardContractMapper mapper;

	@Mock
	private PacingPlanContractMapper planMapper;

	@Mock
	private PacingNsDiffContractMapper nsDiffMapper;

	@Mock
	private HubUserService hubUserService;

	@Mock
	private CampaignLinksValidator campaignLinksValidator;

	@InjectMocks
	private PacingDashboardController controller;

	private void stubCurrentUser() {
		CurrentUserModel user = Instancio.create(CurrentUserModel.class);
		PacingEntitlement entitlement = new PacingEntitlement(PacingScope.all(), true);
		HubAssertion assertion = new HubAssertion(user.email(), PacingScope.KIND_ALL, List.of(), true);
		doReturn(user).when(currentUserService).resolveCurrentUser();
		doReturn(entitlement).when(pacingScopeResolver).resolveForCurrentUser(user);
		doReturn(assertion).when(assertionMapper).toAssertion(user, entitlement);
	}

	@Test
	void shouldReturnDashboardPayloadTest() throws Exception {
		// Given:
		stubCurrentUser();
		PacingDashboardData data =
				new PacingDashboardData(
						null, Map.of(), List.of(), null,
				// types / availableSplits / availableMetrics / conversionTags - the four the moved
				// widget renderer reads; unset here because these cases are about the other fields.
				null, null, null, null, null, null, null, null, null, Map.of(), Map.of(), null, null, null, null,
						null, List.of());
		doReturn(data).when(pacingClient).getDashboardData(any(), eq("nike-ss26"));
		// Unstubbed hubUserService.findByClerkUserId(...) answers Optional.empty() (Mockito's default for
		// Optional-returning methods), so the resolved own-pacing-user-id is null here - an unrestricted
		// (kind=all) scope from stubCurrentUser() still resolves canEdit to true regardless.
		doReturn(new PacingDashboardV1().display(Map.of("widgets", List.of())).journal(List.of())
				.planByLineItem(Map.of()).factsDaily(List.of()))
				.when(mapper).toV1(data, null, true);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/dashboards/{slug}", "nike-ss26"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.display.widgets").isArray());
	}

	@Test
	void shouldSavePacingPlanTest() throws Exception {
		// Given: §9 (US-125/126/127) - a straight passthrough, no figure computed along the way.
		stubCurrentUser();
		List<PacingLineItemPlanUpdate> lineItems = List.of(
				new PacingLineItemPlanUpdate("111", null, null, null, null, null, "CPM", 5000.0, 1_000_000.0,
						20.0, null, null, "2026-01-01", "2026-01-31", null, null, null, null, List.of()));
		doReturn(lineItems).when(planMapper).toPlanUpdateLineItems(any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		String body = "{\"lineItems\":[{\"lineItemId\":\"111\",\"rateType\":\"CPM\","
				+ "\"nativeBudget\":5000,\"targetImpressions\":1000000,\"marginTargetPct\":20,"
				+ "\"flightStart\":\"2026-01-01\",\"flightEnd\":\"2026-01-31\"}]}";

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/plan", "nike-ss26")
						.contentType(APPLICATION_JSON).content(body))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.saved").value(true));
		verify(pacingClient).savePlan(any(), eq("nike-ss26"), eq(lineItems));
	}

	@Test
	void shouldForwardPacingsCoefRejectionAsBadRequestWithFieldNamingDetailTest() throws Exception {
		// Given: US-125's acceptance criteria - the rejection must name the field, never a bare code.
		stubCurrentUser();
		doReturn(List.of()).when(planMapper).toPlanUpdateLineItems(any());
		doThrow(new PacingExternalException(PacingFailureReason.UPSTREAM_BAD_REQUEST,
				"bad_coef_config", "line item 111: its margin is out of range (coefficient-cost margin must be 0-99.99)"))
				.when(pacingClient).savePlan(any(), any(), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/plan", "nike-ss26")
						.contentType(APPLICATION_JSON).content("{\"lineItems\":[]}"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.message").value("The Pacing service rejected the request: "
						+ "line item 111: its margin is out of range (coefficient-cost margin must be 0-99.99)."));
	}

	@Test
	void shouldSaveDataSettingsTest() throws Exception {
		// Given: the Data panel moving this pacing onto the manual-adjustments view.
		stubCurrentUser();
		PacingDataSettings settings =
				new PacingDataSettings("platform_mart_adjustments_view", null, null, null, null, null, null);
		doReturn(settings).when(mapper).toDataSettings(any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/data-settings", "nike-ss26")
						.contentType(APPLICATION_JSON)
						.content("{\"source\":\"platform_mart_adjustments_view\"}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.saved").value(true));
		verify(pacingClient).saveDataSettings(any(), eq("nike-ss26"), eq(settings));
	}

	@Test
	void shouldForwardPacingsDimensionSourceRejectionAsBadRequestTest() throws Exception {
		// Given: Pacing refuses a malformed dimension source rather than dropping it, naming which one.
		stubCurrentUser();
		doReturn(new PacingDataSettings(null, null, null, null, null, null, List.of())).when(mapper).toDataSettings(any());
		doThrow(new PacingExternalException(PacingFailureReason.UPSTREAM_BAD_REQUEST,
				"bad_dim_sources", "devices: unknown catalog"))
				.when(pacingClient).saveDataSettings(any(), any(), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/data-settings", "nike-ss26")
						.contentType(APPLICATION_JSON).content("{}"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.message")
						.value("The Pacing service rejected the request: devices: unknown catalog."));
	}

	@Test
	void shouldSaveCampaignLinksTest() throws Exception {
		// Given: §16 - the Documents panel replacing the whole link list
		stubCurrentUser();
		List<PacingCampaignLink> links = List.of(
				new PacingCampaignLink("Asana", "https://app.asana.com/0/123/456"));
		doReturn(links).when(mapper).toCampaignLinks(any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then: the validator clears the list first, and exactly that list is forwarded
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/links", "nike-ss26")
						.contentType(APPLICATION_JSON)
						.content("{\"links\":[{\"name\":\"Asana\",\"url\":\"https://app.asana.com/0/123/456\"}]}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.saved").value(true));
		verify(campaignLinksValidator).validate(links);
		verify(pacingClient).saveCampaignLinks(any(), eq("nike-ss26"), eq(links));
	}

	@Test
	void shouldRejectCampaignLinksTheValidatorRefusesWithoutCallingPacingTest() throws Exception {
		// Given: a javascript: URL - refused HERE (US-140/141's validation lives on the Hub because
		// Pacing stores the array verbatim), and Pacing must never see the request
		stubCurrentUser();
		List<PacingCampaignLink> links = List.of(new PacingCampaignLink("IO", "javascript:alert(1)"));
		doReturn(links).when(mapper).toCampaignLinks(any());
		doThrow(new BusinessException(OperationalHubErrorReason.OPH_062, "IO"))
				.when(campaignLinksValidator).validate(links);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/links", "nike-ss26")
						.contentType(APPLICATION_JSON)
						.content("{\"links\":[{\"name\":\"IO\",\"url\":\"javascript:alert(1)\"}]}"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.message")
						.value("Campaign link 'IO': the URL must be a full http:// or https:// address."));
		verify(pacingClient, times(0)).saveCampaignLinks(any(), any(), any());
	}

	@Test
	void shouldSaveNotifySettingsTest() throws Exception {
		// Given: §14 - a full round-trip alert configuration, camelCase on this contract.
		stubCurrentUser();
		PacingNotifySettings settings = new PacingNotifySettings(
				new PacingAlertsConfig(
						true,
						new PacingAlertRuleWindowThreshold(true, true, 2, 5),
						new PacingAlertRuleGapDays(true, true, 1),
						new PacingAlertRuleFactor(true, true, 0.7),
						new PacingAlertRuleFactor(true, true, 0.7),
						new PacingAlertRuleFactor(true, true, 2.0),
						new PacingAlertRuleBase(true, true),
						new PacingAlertRuleBase(true, true),
						new PacingAlertRuleBand(true, true, -5, 5),
						new PacingAlertRuleGapPp(true, true, 3),
						new PacingAlertRuleSpend(true, true, 90, 100),
						new PacingAlertRuleBase(true, true),
						new PacingAlertRuleDays(true, true, 2),
						new PacingAlertRuleThresholdPct(true, true, 10)),
				new PacingNotifyMetrics(false),
				false,
				"reforecast");
		doReturn(settings).when(mapper).toNotifySettings(any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/notify-settings", "nike-ss26")
						.contentType(APPLICATION_JSON).content(FULL_NOTIFY_SETTINGS_JSON))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.saved").value(true));
		verify(pacingClient).saveNotifySettings(any(), eq("nike-ss26"), eq(settings));
	}

	@Test
	void shouldForwardPacingsNotifyRejectionAsBadRequestTest() throws Exception {
		// Given: dash-gate's validator refuses an inverted pacing-off-pace band rather than storing it.
		stubCurrentUser();
		doReturn(mock(PacingNotifySettings.class)).when(mapper).toNotifySettings(any());
		doThrow(new PacingExternalException(PacingFailureReason.UPSTREAM_BAD_REQUEST,
				"bad_notify", "alerts.pacing_off_pace.low must be less than .high"))
				.when(pacingClient).saveNotifySettings(any(), any(), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/notify-settings", "nike-ss26")
						.contentType(APPLICATION_JSON).content(FULL_NOTIFY_SETTINGS_JSON))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.message").value("The Pacing service rejected the request: "
						+ "alerts.pacing_off_pace.low must be less than .high."));
	}

	@Test
	void shouldReturnAddableLineItemsTest() throws Exception {
		// Given: §9 (US-126).
		stubCurrentUser();
		PacingAddableLineItems result = new PacingAddableLineItems(
				true, null, "TM-1", List.of("TM-1"), List.of(), List.of("111"), "Acme", "MediaCo", List.of(), List.of());
		doReturn(result).when(pacingClient).getAddableLineItems(any(), eq("nike-ss26"));
		doReturn(new PacingAddableLineItemsV1().ok(true).io("TM-1").addable(List.of()).alreadyAdded(List.of("111")))
				.when(planMapper).toAddableLineItemsV1(result);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/dashboards/{slug}/addable-line-items", "nike-ss26"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.io").value("TM-1"))
				.andExpect(jsonPath("$.alreadyAdded[0]").value("111"));
	}

	@Test
	void shouldReturnNsDiffReportTest() throws Exception {
		// Given: §13, US-136 - a plain delegate-and-map, same shape as getDashboardData/getRefreshStatus
		stubCurrentUser();
		PacingNsDiffReport report = new PacingNsDiffReport(
				true, "p1", "nike-ss26", List.of("missing_in_pacing", "owner_diff"),
				null, false, List.of("manual-1"), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
		doReturn(report).when(pacingClient).getNsDiff(any(), eq("p1"));
		doReturn(new PacingNsDiffReportV1().pacingId("p1").dashSlug("nike-ss26").inSync(false)
				.counts(new PacingNsDiffCountsV1().missingInNetsuite(0).missingInPacing(1).fieldDiff(0)
						.planDiff(0).foreignCampaign(0).ownerDiff(1)))
				.when(nsDiffMapper).toV1(report);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/pacings/{pacingId}/ns-diff", "p1"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.pacingId").value("p1"))
				.andExpect(jsonPath("$.dashSlug").value("nike-ss26"))
				.andExpect(jsonPath("$.inSync").value(false));
	}

	@Test
	void shouldMapNsDiffUnreachablePacingToServiceUnavailableTest() throws Exception {
		// Given: the generic PacingExternalException mapping applies here too - not admin-gated, but
		// still a plain external-service call that can fail the same way every other one does.
		stubCurrentUser();
		doThrow(new PacingExternalException(PacingFailureReason.UNREACHABLE, "down"))
				.when(pacingClient).getNsDiff(any(), eq("p1"));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/pacings/{pacingId}/ns-diff", "p1"))
				.andExpect(status().isServiceUnavailable())
				.andExpect(jsonPath("$.code").value("OPH_051"));
	}

	@Test
	void shouldReturnRefreshStatusTest() throws Exception {
		// Given:
		stubCurrentUser();
		PacingRefreshStatus status = new PacingRefreshStatus(true, "r1", 10, "2026-08-31");
		doReturn(status).when(pacingClient).getRefreshStatus(any(), eq("nike-ss26"));
		doReturn(new PacingRefreshStatusV1().exists(true).refreshId("r1").rowCount(10))
				.when(mapper).toV1(status);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/dashboards/{slug}/refresh-status", "nike-ss26"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.refreshId").value("r1"));
	}

	@Test
	void shouldReturnStartedTrueWhenRefreshTriggeredTest() throws Exception {
		// Given:
		stubCurrentUser();
		doReturn(PacingRefreshOutcome.triggered()).when(pacingClient).refreshPacing(any(), eq("p1"));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/pacings/{pacingId}/refresh", "p1"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.started").value(true));
	}

	@Test
	void shouldReturn429WithRetryAfterSecondsInsideCooldownTest() throws Exception {
		// Given: US-119 - a cooldown is reported as a 429 with the countdown, never queuing a second run
		stubCurrentUser();
		doReturn(PacingRefreshOutcome.cooldown(42)).when(pacingClient).refreshPacing(any(), eq("p1"));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/pacings/{pacingId}/refresh", "p1"))
				.andExpect(status().isTooManyRequests())
				.andExpect(jsonPath("$.retryAfterSeconds").value(42));
	}

	@Test
	void shouldSaveDisplayTest() throws Exception {
		// Given:
		stubCurrentUser();
		PacingDisplaySaveOutcome outcome = PacingDisplaySaveOutcome.saved(Map.of("widgets", List.of()));
		doReturn(outcome).when(pacingClient).saveDisplay(any(), eq("nike-ss26"), any(), anyInt(), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/settings", "nike-ss26")
						.contentType(APPLICATION_JSON)
						.content("{\"display\":{\"widgets\":[]},\"displayRev\":3}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.display.widgets").isArray());
	}

	@Test
	void shouldReturn409WithCurrentRevOnStaleSettingsConflictTest() throws Exception {
		// Given: US-118 - a concurrent edit is reported, never silently overwritten
		stubCurrentUser();
		PacingDisplaySaveOutcome outcome = PacingDisplaySaveOutcome.staleSettings(7);
		doReturn(outcome).when(pacingClient).saveDisplay(any(), eq("nike-ss26"), any(), anyInt(), any());
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/settings", "nike-ss26")
						.contentType(APPLICATION_JSON)
						.content("{\"display\":{\"widgets\":[]},\"displayRev\":3}"))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.reason").value("stale_settings"))
				.andExpect(jsonPath("$.currentRev").value(7));
	}

	@Test
	void shouldMapUnreachablePacingToServiceUnavailableTest() throws Exception {
		// Given: the generic PacingExternalException mapping applies to every §6 endpoint too
		stubCurrentUser();
		doThrow(new PacingExternalException(PacingFailureReason.UNREACHABLE, "down"))
				.when(pacingClient).getDashboardData(any(), eq("nike-ss26"));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller)
				.setControllerAdvice(new GlobalExceptionHandler(new GlobalExceptionResponseHelperImpl()))
				.build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/dashboards/{slug}", "nike-ss26"))
				.andExpect(status().isServiceUnavailable())
				.andExpect(jsonPath("$.code").value("OPH_051"));
	}

	@Test
	void shouldReturnThirdPartyStatusTest() throws Exception {
		// Given:
		stubCurrentUser();
		PacingThirdPartyStatus status = new PacingThirdPartyStatus(true, "ready", "2026-10-09T12:00:00.000Z", 13884, List.of("Spring Sale"));
		doReturn(status).when(pacingClient).getThirdPartyStatus(any(), eq("nike-ss26"));
		doReturn(new PacingThirdPartyStatusV1().state(PacingThirdPartyStatusV1.StateEnum.READY).rowCount(13884))
				.when(mapper).toV1(status);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/dashboards/{slug}/third-party/status", "nike-ss26"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.state").value("ready"))
				.andExpect(jsonPath("$.rowCount").value(13884));
	}

	@Test
	void shouldReturnThirdPartyDataTest() throws Exception {
		// Given:
		stubCurrentUser();
		PacingThirdPartyData file = new PacingThirdPartyData(
				"2026-10-09T12:00:00.000Z", List.of("Spring Sale"), List.of(), "ready", 0, 2,
				List.of(Map.of("campaign", "Spring Sale")));
		doReturn(file).when(pacingClient).getThirdPartyData(any(), eq("nike-ss26"));
		doReturn(new PacingThirdPartyDataV1().rowCount(2).campaigns(List.of("Spring Sale")))
				.when(mapper).toV1(file);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/dashboards/{slug}/third-party/data", "nike-ss26"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.rowCount").value(2));
	}

	@Test
	void shouldReturnThirdPartyCampaignsTest() throws Exception {
		// Given:
		stubCurrentUser();
		PacingThirdPartyCampaigns campaigns = new PacingThirdPartyCampaigns(
				true, List.of(new PacingThirdPartyCampaign("Spring Sale", "Weekly", "2026-07-01", 10L)), false);
		doReturn(campaigns).when(pacingClient).getThirdPartyCampaigns(any(), eq("nike-ss26"));
		doReturn(new PacingThirdPartyCampaignsV1()
				.campaigns(List.of(new PacingThirdPartyCampaignV1().name("Spring Sale"))).stale(false))
				.when(mapper).toV1(campaigns);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(get("/api/v1/pacing/dashboards/{slug}/third-party/campaigns", "nike-ss26"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.campaigns[0].name").value("Spring Sale"));
	}

	@Test
	void shouldSaveThirdPartyAndAnswerNoContentTest() throws Exception {
		// 204, not the list back: the save triggers a pull, so anything echoed would already be the
		// state before it.
		// Given:
		stubCurrentUser();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/third-party-settings", "nike-ss26")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"thirdParty\":[{\"type\":\"cm360\",\"campaigns\":[\"Spring Sale\"]}]}"))
				.andExpect(status().isNoContent());
		verify(pacingClient).saveThirdParty(any(), eq("nike-ss26"),
				eq(List.of(Map.of("type", "cm360", "campaigns", List.of("Spring Sale")))));
	}

	@Test
	void shouldSaveMappingsAndAnswerNoContentTest() throws Exception {
		// Given:
		stubCurrentUser();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/mappings", "nike-ss26")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"mappings\":[{\"id\":\"mp_1\"}]}"))
				.andExpect(status().isNoContent());
		verify(pacingClient).saveMappings(any(), eq("nike-ss26"), eq(List.of(Map.of("id", "mp_1"))));
	}

	@Test
	void shouldForwardNullMappingsAsNullTest() throws Exception {
		// Clearing the list is a real instruction; an empty list would say something else.
		// Given:
		stubCurrentUser();
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/mappings", "nike-ss26")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"mappings\":null}"))
				.andExpect(status().isNoContent());
		verify(pacingClient).saveMappings(any(), eq("nike-ss26"), isNull());
	}

	@Test
	void shouldAnswerARefetchThatStartedTest() throws Exception {
		// Given:
		stubCurrentUser();
		doReturn(PacingThirdPartyRefetchOutcome.triggered())
				.when(pacingClient).refetchThirdParty(any(), eq("nike-ss26"));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/third-party/refetch", "nike-ss26"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.started").value(true))
				.andExpect(jsonPath("$.notConfigured").value(false));
	}

	@Test
	void shouldAnswerNothingToPullAsOkRatherThanAnErrorTest() throws Exception {
		// "This pacing has no CM360 source" is something the screen says, not an error channel.
		// Given:
		stubCurrentUser();
		doReturn(PacingThirdPartyRefetchOutcome.noSource())
				.when(pacingClient).refetchThirdParty(any(), eq("nike-ss26"));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/third-party/refetch", "nike-ss26"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.started").value(false))
				.andExpect(jsonPath("$.notConfigured").value(true));
	}

	@Test
	void shouldAnswerASpentBudgetAsOkTest() throws Exception {
		// Given:
		stubCurrentUser();
		doReturn(PacingThirdPartyRefetchOutcome.budgetSpent())
				.when(pacingClient).refetchThirdParty(any(), eq("nike-ss26"));
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/third-party/refetch", "nike-ss26"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.rateLimited").value(true));
	}

	@Test
	void shouldAnswerASuggestionWithNothingProposedAsOkTest() throws Exception {
		// No model connected yet: the whole path is real and the answer is a notice, not an error.
		// Given:
		stubCurrentUser();
		PacingMappingSuggestions suggestions =
				new PacingMappingSuggestions(true, List.of(), "we need to add ai connection");
		doReturn(suggestions).when(pacingClient).suggestMappingLibrary(any(), eq("nike-ss26"), eq("mp_1"));
		doReturn(new PacingMappingSuggestionsV1().dimensions(List.of()).notice("we need to add ai connection"))
				.when(mapper).toV1(suggestions);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/mapping/suggest", "nike-ss26")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"mappingId\":\"mp_1\"}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.dimensions").isEmpty())
				.andExpect(jsonPath("$.notice").value("we need to add ai connection"));
	}

	@Test
	void shouldForwardNoMappingIdAsNullTest() throws Exception {
		// "Suggest for this pacing" is a complete request; the id only narrows it to one entity, and
		// its absence has to reach Pacing as absent rather than as some default entity picked here.
		// Given:
		stubCurrentUser();
		PacingMappingSuggestions suggestions = new PacingMappingSuggestions(true, List.of(), null);
		doReturn(suggestions).when(pacingClient).suggestMappingLibrary(any(), eq("nike-ss26"), isNull());
		doReturn(new PacingMappingSuggestionsV1().dimensions(List.of())).when(mapper).toV1(suggestions);
		MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

		// When / Then:
		mockMvc.perform(post("/api/v1/pacing/dashboards/{slug}/mapping/suggest", "nike-ss26")
						.contentType(MediaType.APPLICATION_JSON)
						.content("{}"))
				.andExpect(status().isOk());
		verify(pacingClient).suggestMappingLibrary(any(), eq("nike-ss26"), isNull());
	}
}
