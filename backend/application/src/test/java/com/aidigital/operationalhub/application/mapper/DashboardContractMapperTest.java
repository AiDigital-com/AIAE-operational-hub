package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardCreateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardDatasetFilterV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardDatasetRowsPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardDatasetRowsSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardPreviewV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardStatusEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardTypeEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardV1;
import com.aidigital.operationalhub.domain.entity.HubDashboard;
import com.aidigital.operationalhub.service.dashboard.model.DashboardColumnChoice;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetCriteria;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetFilter;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetPage;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetRow;
import com.aidigital.operationalhub.service.dashboard.model.DashboardPreview;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link DashboardContractMapper}.
 */
class DashboardContractMapperTest {

	private DashboardContractMapper mapper() {
		return new DashboardContractMapper(new ObjectMapper());
	}

	@Test
	void shouldMapLiveDashboardToV1Test() {
		// Given:
		DashboardContractMapper mapper = mapper();
		HubDashboard entity = new HubDashboard();
		entity.setId(7L);
		entity.setCampaignId(42L);
		entity.setName("Client dashboard");
		entity.setType("basic");
		entity.setStatus("live");
		entity.setOptionalColumns("creative,cpa");
		entity.setFilters("[{\"field\":\"Channel\",\"values\":[\"Display\"]}]");
		entity.setDateFrom(java.time.LocalDate.of(2026, 8, 1));
		entity.setDateTo(java.time.LocalDate.of(2026, 8, 10));
		entity.setSourceTable("silken-quasar-376417.gs_templates.acme_summer");
		entity.setSourceRowCount(12_345L);
		entity.setSourceCreatedAt(LocalDateTime.of(2026, 8, 11, 9, 30));
		entity.setDisplayCampaignName("Acme - Summer");
		entity.setCreatedAt(LocalDateTime.of(2026, 8, 1, 10, 0));
		entity.setUpdatedAt(LocalDateTime.of(2026, 8, 11, 9, 30));

		// When:
		DashboardV1 v1 = mapper.toV1(entity);

		// Then:
		assertThat(v1.getId()).isEqualTo(7L);
		assertThat(v1.getCampaignId()).isEqualTo(42L);
		assertThat(v1.getName()).isEqualTo("Client dashboard");
		assertThat(v1.getType()).isEqualTo(DashboardTypeEnumV1.BASIC);
		assertThat(v1.getStatus()).isEqualTo(DashboardStatusEnumV1.LIVE);
		assertThat(v1.getOptionalColumns()).containsExactly("creative", "cpa");
		assertThat(v1.getFilters()).hasSize(1);
		assertThat(v1.getFilters().getFirst().getField()).isEqualTo("Channel");
		assertThat(v1.getDateFrom()).isEqualTo(LocalDate.of(2026, 8, 1));
		assertThat(v1.getDateTo()).isEqualTo("2026-08-10");
		assertThat(v1.getSourceTable()).isEqualTo("silken-quasar-376417.gs_templates.acme_summer");
		assertThat(v1.getSourceRowCount()).isEqualTo(12_345L);
		assertThat(v1.getSourceCreated()).isEqualTo("2026-08-11T09:30:00");
		assertThat(v1.getDisplayCampaignName()).isEqualTo("Acme - Summer");
		assertThat(v1.getCreated()).isEqualTo("2026-08-01T10:00:00");
		assertThat(v1.getEdited()).isEqualTo("2026-08-11T09:30:00");
	}

	@Test
	void shouldMapDraftDashboardWithoutSourceTest() {
		// Given: a dashboard nobody has created a data source for, never edited since creation
		DashboardContractMapper mapper = mapper();
		HubDashboard entity = new HubDashboard();
		entity.setId(8L);
		entity.setCampaignId(42L);
		entity.setName("Draft dashboard");
		entity.setType("basic");
		entity.setStatus("draft");
		entity.setOptionalColumns("creative,cpa");
		entity.setCreatedAt(LocalDateTime.of(2026, 8, 1, 10, 0));
		entity.setUpdatedAt(LocalDateTime.of(2026, 8, 1, 10, 0));

		// When:
		DashboardV1 v1 = mapper.toV1(entity);

		// Then:
		assertThat(v1.getStatus()).isEqualTo(DashboardStatusEnumV1.DRAFT);
		assertThat(v1.getSourceTable()).isNull();
		assertThat(v1.getSourceRowCount()).isNull();
		assertThat(v1.getSourceCreated()).isNull();
		assertThat(v1.getEdited()).isNull();
	}

	@Test
	void shouldMapNoKeptOptionalColumnsAsEmptyListTest() {
		// Given: every optional column switched off, which is stored as an empty value
		DashboardContractMapper mapper = mapper();
		HubDashboard entity = new HubDashboard();
		entity.setId(9L);
		entity.setCampaignId(42L);
		entity.setName("Lean dashboard");
		entity.setType("basic");
		entity.setStatus("draft");
		entity.setOptionalColumns("");
		entity.setCreatedAt(LocalDateTime.of(2026, 8, 1, 10, 0));
		entity.setUpdatedAt(LocalDateTime.of(2026, 8, 1, 10, 0));

		// When:
		DashboardV1 v1 = mapper.toV1(entity);

		// Then:
		assertThat(v1.getOptionalColumns()).isEmpty();
	}

	@Test
	void shouldMapPageToPageResponseTest() {
		// Given:
		DashboardContractMapper mapper = mapper();
		HubDashboard entity = new HubDashboard();
		entity.setId(7L);
		entity.setCampaignId(42L);
		entity.setName("Client dashboard");
		entity.setType("basic");
		entity.setStatus("draft");
		entity.setOptionalColumns("creative");
		entity.setCreatedAt(LocalDateTime.of(2026, 8, 1, 10, 0));
		entity.setUpdatedAt(LocalDateTime.of(2026, 8, 1, 10, 0));
		PageRequest pageRequest = PageRequest.of(1, 25);

		// When:
		DashboardPageResponseV1 response =
				mapper.toPageResponse(new PageImpl<>(List.of(entity), pageRequest, 26));

		// Then: the page number is one-based on the wire, unlike Spring's
		assertThat(response.getPageNumber()).isEqualTo(2);
		assertThat(response.getPageSize()).isEqualTo(25);
		assertThat(response.getTotalElements()).isEqualTo(26);
		assertThat(response.getTotalPages()).isEqualTo(2);
		assertThat(response.getContent()).hasSize(1);
	}

	@Test
	void shouldMapPreviewWithTheColumnsItWasCountedUnderTest() {
		// Given:
		DashboardContractMapper mapper = mapper();
		DashboardPreview preview = new DashboardPreview(
				1234L,
				new DashboardColumnChoice(true, true),
				"silken-quasar-376417.gs_templates.acme_report_basic_dash_client_dashboard");

		// When:
		DashboardPreviewV1 v1 = mapper.toV1(preview);

		// Then: the count and the selection travel together, so the panel cannot show one beside the other
		assertThat(v1.getRowCount()).isEqualTo(1234L);
		assertThat(v1.getOptionalColumns()).containsExactly("creative", "cpa");
		assertThat(v1.getSourceTable())
				.isEqualTo("silken-quasar-376417.gs_templates.acme_report_basic_dash_client_dashboard");
	}

	@Test
	void shouldMapPreviewWithOneKeptColumnTest() {
		// Given:
		DashboardContractMapper mapper = mapper();
		DashboardPreview preview = new DashboardPreview(7L, new DashboardColumnChoice(false, true), "p.d.t");

		// When:
		DashboardPreviewV1 v1 = mapper.toV1(preview);

		// Then:
		assertThat(v1.getOptionalColumns()).containsExactly("cpa");
	}

	@Test
	void shouldMapPreviewWithNoKeptColumnsTest() {
		// Given:
		DashboardContractMapper mapper = mapper();
		DashboardPreview preview = new DashboardPreview(0L, new DashboardColumnChoice(false, false), "p.d.t");

		// When:
		DashboardPreviewV1 v1 = mapper.toV1(preview);

		// Then: an empty list, not an absent field - the dashboard keeps none of them, and that is an answer
		assertThat(v1.getOptionalColumns()).isEmpty();
		assertThat(v1.getRowCount()).isZero();
	}

	@Test
	void shouldMapDashboardDatasetRowsPageTest() {
		// Given:
		DashboardContractMapper mapper = mapper();
		DashboardDatasetPage page = new DashboardDatasetPage(
				2,
				25,
				26L,
				2,
				List.of(new DashboardDatasetRow(Map.of("Date", "2026-08-01", "Channel", "Display"))));

		// When:
		DashboardDatasetRowsPageResponseV1 response = mapper.toPageResponse(page);

		// Then:
		assertThat(response.getPageNumber()).isEqualTo(2);
		assertThat(response.getPageSize()).isEqualTo(25);
		assertThat(response.getTotalElements()).isEqualTo(26L);
		assertThat(response.getTotalPages()).isEqualTo(2);
		assertThat(response.getContent()).hasSize(1);
		assertThat(response.getContent().getFirst().getValues())
				.containsEntry("Date", "2026-08-01")
				.containsEntry("Channel", "Display");
	}

	@Test
	void shouldMapDashboardDatasetFiltersTest() {
		// Given:
		DashboardContractMapper mapper = mapper();
		DashboardDatasetRowsSearchRequestV1 request = new DashboardDatasetRowsSearchRequestV1()
				.filters(List.of(new DashboardDatasetFilterV1()
						.field("Channel")
						.values(List.of("Display", "Video"))));

		// When:
		DashboardDatasetCriteria criteria = mapper.toCriteria(request);

		// Then:
		assertThat(criteria.filters()).containsExactly(new DashboardDatasetFilter("Channel", List.of("Display", "Video")));
		assertThat(mapper.toCriteria(null).filters()).isEmpty();
	}

	@Test
	void shouldMapCreateRequestToEntityWithoutServerOwnedFieldsTest() {
		// Given:
		DashboardContractMapper mapper = mapper();
		DashboardCreateV1 request = new DashboardCreateV1()
				.name("Client dashboard")
				.type(DashboardTypeEnumV1.BASIC)
				.optionalColumns(List.of("creative", "cpa"))
				.filters(List.of(new DashboardDatasetFilterV1()
						.field("Channel")
						.values(List.of("Display"))))
				.dateFrom(LocalDate.of(2026, 8, 1))
				.dateTo(LocalDate.of(2026, 8, 10))
				.displayCampaignName("Acme - Summer");

		// When:
		HubDashboard entity = mapper.fromCreate(request);

		// Then: the status and source are left to the service, which is the only thing that may set them
		assertThat(entity.getName()).isEqualTo("Client dashboard");
		assertThat(entity.getType()).isEqualTo("basic");
		assertThat(entity.getOptionalColumns()).isEqualTo("creative,cpa");
		assertThat(entity.getFilters()).contains("\"field\":\"Channel\"");
		assertThat(entity.getDateFrom()).hasToString("2026-08-01");
		assertThat(entity.getDateTo()).hasToString("2026-08-10");
		assertThat(entity.getDisplayCampaignName()).isEqualTo("Acme - Summer");
		assertThat(entity.getStatus()).isNull();
		assertThat(entity.getSourceTable()).isNull();
	}

	@Test
	void shouldMapEmptyOptionalColumnsToEmptyValueTest() {
		// Given: the checkboxes for every optional column cleared - a choice, not an omission
		DashboardContractMapper mapper = mapper();
		DashboardCreateV1 request = new DashboardCreateV1()
				.name("Lean dashboard")
				.type(DashboardTypeEnumV1.BASIC)
				.optionalColumns(List.of());

		// When:
		HubDashboard entity = mapper.fromCreate(request);

		// Then:
		assertThat(entity.getOptionalColumns()).isEmpty();
	}

	@Test
	void shouldMapUpdateRequestWithoutTypeTest() {
		// Given:
		DashboardContractMapper mapper = mapper();
		DashboardUpdateV1 request = new DashboardUpdateV1()
				.name("Renamed dashboard")
				.optionalColumns(List.of("cpa"))
				.displayCampaignName("Acme - Autumn");

		// When:
		HubDashboard entity = mapper.fromUpdate(request);

		// Then: no type travels on an update, so none is carried into the entity either
		assertThat(entity.getName()).isEqualTo("Renamed dashboard");
		assertThat(entity.getOptionalColumns()).isEqualTo("cpa");
		assertThat(entity.getDisplayCampaignName()).isEqualTo("Acme - Autumn");
		assertThat(entity.getType()).isNull();
	}
}
