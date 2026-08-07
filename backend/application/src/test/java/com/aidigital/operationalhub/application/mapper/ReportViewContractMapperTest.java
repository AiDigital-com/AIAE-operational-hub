package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowFilterFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowFilterV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewStatusEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewTypeEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewUpsertV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewV1;
import com.aidigital.operationalhub.domain.entity.HubReportView;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ReportViewContractMapper}.
 */
class ReportViewContractMapperTest {

	private ReportViewContractMapper mapper;

	@BeforeEach
	void setUp() {
		mapper = new ReportViewContractMapper(new ObjectMapper());
	}

	private HubReportView entity(String dimensions, String metrics) {
		HubReportView entity = new HubReportView();
		entity.setId(7L);
		entity.setCampaignId(42L);
		entity.setName("Weekly reporting");
		entity.setType("basic");
		entity.setStatus("saved");
		entity.setNote("a note");
		entity.setDimensions(dimensions);
		entity.setMetrics(metrics);
		entity.setFilters(null);
		return entity;
	}

	@Test
	void shouldMapEntityToV1SplittingCsvColumnsTest() {
		// Given:
		HubReportView entity = entity("date,line_item_id", "impressions,clicks");
		entity.setCreatedAt(LocalDateTime.of(2026, 1, 1, 10, 0));
		entity.setUpdatedAt(LocalDateTime.of(2026, 1, 2, 11, 30));

		// When:
		ReportViewV1 v1 = mapper.toV1(entity);

		// Then:
		assertThat(v1.getId()).isEqualTo(7L);
		assertThat(v1.getCampaignId()).isEqualTo(42L);
		assertThat(v1.getName()).isEqualTo("Weekly reporting");
		assertThat(v1.getType()).isEqualTo(ReportViewTypeEnumV1.BASIC);
		assertThat(v1.getStatus()).isEqualTo(ReportViewStatusEnumV1.SAVED);
		assertThat(v1.getNote()).isEqualTo("a note");
		assertThat(v1.getDimensions()).containsExactly("date", "line_item_id");
		assertThat(v1.getMetrics()).containsExactly("impressions", "clicks");
	}

	@Test
	void shouldReturnNullEditedWhenNeverModifiedTest() {
		// Given: created_at and updated_at are stamped equal on insert
		HubReportView entity = entity("date", "spend");
		LocalDateTime stamp = LocalDateTime.of(2026, 1, 1, 10, 0);
		entity.setCreatedAt(stamp);
		entity.setUpdatedAt(stamp);

		// When:
		ReportViewV1 v1 = mapper.toV1(entity);

		// Then:
		assertThat(v1.getCreated()).isEqualTo("2026-01-01T10:00:00");
		assertThat(v1.getEdited()).isNull();
	}

	@Test
	void shouldReturnEditedWhenModifiedTest() {
		// Given: updated_at moved past created_at after an edit
		HubReportView entity = entity("date", "spend");
		entity.setCreatedAt(LocalDateTime.of(2026, 1, 1, 10, 0));
		entity.setUpdatedAt(LocalDateTime.of(2026, 1, 3, 9, 15));

		// When:
		ReportViewV1 v1 = mapper.toV1(entity);

		// Then:
		assertThat(v1.getEdited()).isEqualTo("2026-01-03T09:15:00");
	}

	@Test
	void shouldMapEntityPageToPageResponseTest() {
		// Given:
		HubReportView entity = entity("date", "spend");
		LocalDateTime stamp = LocalDateTime.of(2026, 1, 1, 10, 0);
		entity.setCreatedAt(stamp);
		entity.setUpdatedAt(stamp);
		var page = new PageImpl<>(List.of(entity), PageRequest.of(1, 25), 40);

		// When:
		ReportViewPageResponseV1 response = mapper.toPageResponse(page);

		// Then:
		assertThat(response.getPageNumber()).isEqualTo(2);
		assertThat(response.getPageSize()).isEqualTo(25);
		assertThat(response.getTotalElements()).isEqualTo(26);
		assertThat(response.getTotalPages()).isEqualTo(2);
		assertThat(response.getContent()).hasSize(1);
		assertThat(response.getContent().getFirst().getName()).isEqualTo("Weekly reporting");
		assertThat(response.getContent().getFirst().getDimensions()).containsExactly("date");
		assertThat(response.getContent().getFirst().getMetrics()).containsExactly("spend");
	}

	@Test
	void shouldMapUpsertToEntityJoiningCsvColumnsTest() {
		// Given:
		ReportViewUpsertV1 request = new ReportViewUpsertV1();
		request.setName("New report");
		request.setType(ReportViewTypeEnumV1.BASIC);
		request.setStatus(ReportViewStatusEnumV1.DRAFT);
		request.setNote("note");
		request.setDimensions(List.of("date", "line_item_id"));
		request.setMetrics(List.of("impressions"));
		request.setFilters(List.of(new ReportRowFilterV1(ReportRowFilterFieldEnumV1.DATE, List.of("2026-03-10"))));

		// When:
		HubReportView entity = mapper.fromUpsert(request);

		// Then: id/campaignId/timestamps are left server-owned (never set here)
		assertThat(entity.getId()).isNull();
		assertThat(entity.getCampaignId()).isNull();
		assertThat(entity.getName()).isEqualTo("New report");
		assertThat(entity.getType()).isEqualTo("basic");
		assertThat(entity.getStatus()).isEqualTo("draft");
		assertThat(entity.getNote()).isEqualTo("note");
		assertThat(entity.getDimensions()).isEqualTo("date,line_item_id");
		assertThat(entity.getMetrics()).isEqualTo("impressions");
		assertThat(entity.getFilters()).contains("\"field\":\"DATE\"");
		assertThat(entity.getFilters()).contains("\"values\":[\"2026-03-10\"]");
	}

	@Test
	void shouldSplitEmptyColumnToEmptyListTest() {
		// Given:
		HubReportView entity = entity("", "");
		LocalDateTime stamp = LocalDateTime.of(2026, 1, 1, 10, 0);
		entity.setCreatedAt(stamp);
		entity.setUpdatedAt(stamp);

		// When:
		ReportViewV1 v1 = mapper.toV1(entity);

		// Then:
		assertThat(v1.getDimensions()).isEmpty();
		assertThat(v1.getMetrics()).isEmpty();
	}

	@Test
	void shouldJoinEmptyDimensionsAndMetricsToEmptyStringTest() {
		// Given:
		ReportViewUpsertV1 request = new ReportViewUpsertV1();
		request.setName("New report");
		request.setType(ReportViewTypeEnumV1.BASIC);
		request.setStatus(ReportViewStatusEnumV1.DRAFT);
		request.setDimensions(List.of());
		request.setMetrics(List.of());

		// When:
		HubReportView entity = mapper.fromUpsert(request);

		// Then:
		assertThat(entity.getDimensions()).isEmpty();
		assertThat(entity.getMetrics()).isEmpty();
	}

	@Test
	void shouldRoundTripFiltersBetweenUpsertEntityAndV1Test() {
		// Given:
		ReportRowFilterV1 filter = new ReportRowFilterV1(ReportRowFilterFieldEnumV1.LINE_ITEM_ID, List.of("LI-1", "LI-2"));
		ReportViewUpsertV1 request = new ReportViewUpsertV1();
		request.setName("Filtered report");
		request.setType(ReportViewTypeEnumV1.BASIC);
		request.setStatus(ReportViewStatusEnumV1.SAVED);
		request.setDimensions(List.of("date", "line_item_id"));
		request.setMetrics(List.of("impressions"));
		request.setFilters(List.of(filter));

		// When:
		HubReportView entity = mapper.fromUpsert(request);
		entity.setId(7L);
		entity.setCampaignId(42L);
		entity.setCreatedAt(LocalDateTime.of(2026, 1, 1, 10, 0));
		entity.setUpdatedAt(LocalDateTime.of(2026, 1, 1, 10, 0));
		ReportViewV1 v1 = mapper.toV1(entity);

		// Then:
		assertThat(v1.getFilters()).hasSize(1);
		assertThat(v1.getFilters().getFirst().getField()).isEqualTo(ReportRowFilterFieldEnumV1.LINE_ITEM_ID);
		assertThat(v1.getFilters().getFirst().getValues()).containsExactly("LI-1", "LI-2");
	}

	@Test
	void shouldDeserializeBlankFiltersColumnAsEmptyListTest() {
		// Given:
		HubReportView entity = entity("date", "impressions");
		entity.setFilters(" ");
		entity.setCreatedAt(LocalDateTime.of(2026, 1, 1, 10, 0));
		entity.setUpdatedAt(LocalDateTime.of(2026, 1, 1, 10, 0));

		// When:
		ReportViewV1 v1 = mapper.toV1(entity);

		// Then:
		assertThat(v1.getFilters()).isEmpty();
	}

	@Test
	void shouldDeserializeMalformedFiltersColumnAsEmptyListTest() {
		// Given:
		HubReportView entity = entity("date", "impressions");
		entity.setFilters("{not-json");
		entity.setCreatedAt(LocalDateTime.of(2026, 1, 1, 10, 0));
		entity.setUpdatedAt(LocalDateTime.of(2026, 1, 1, 10, 0));

		// When:
		ReportViewV1 v1 = mapper.toV1(entity);

		// Then:
		assertThat(v1.getFilters()).isEmpty();
	}
}
