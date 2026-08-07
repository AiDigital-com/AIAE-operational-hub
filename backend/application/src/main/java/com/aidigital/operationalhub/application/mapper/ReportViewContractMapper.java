package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowFilterV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewStatusEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewTypeEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewUpsertV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportViewV1;
import com.aidigital.operationalhub.domain.entity.HubReportView;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * Maps {@link HubReportView} entities to/from the generated report-view contract.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ReportViewContractMapper {

	private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_LOCAL_DATE_TIME;
	private static final TypeReference<List<ReportRowFilterV1>> FILTERS_TYPE = new TypeReference<>() {
	};

	private final ObjectMapper objectMapper;

	/**
	 * Maps a persisted report view to its generated contract representation. {@code edited} is
	 * {@code null} when the view was never modified since creation - {@link HubReportView}'s audit
	 * timestamps are both stamped equal on insert and are never null themselves.
	 *
	 * @param entity the persisted report view
	 * @return the generated contract representation
	 */
	public ReportViewV1 toV1(HubReportView entity) {
		ReportViewV1 v1 = new ReportViewV1();
		v1.setId(entity.getId());
		v1.setCampaignId(entity.getCampaignId());
		v1.setName(entity.getName());
		v1.setType(ReportViewTypeEnumV1.fromValue(entity.getType()));
		v1.setStatus(ReportViewStatusEnumV1.fromValue(entity.getStatus()));
		v1.setNote(entity.getNote());
		v1.setCreated(format(entity.getCreatedAt()));
		v1.setEdited(entity.getUpdatedAt().equals(entity.getCreatedAt()) ? null : format(entity.getUpdatedAt()));
		v1.setDimensions(split(entity.getDimensions()));
		v1.setMetrics(split(entity.getMetrics()));
		v1.setFilters(deserializeFilters(entity.getFilters()));
		return v1;
	}

	/**
	 * Maps a list of report views to their generated contract representations.
	 *
	 * @param entities the persisted report views
	 * @return the generated contract representations
	 */
	public List<ReportViewV1> toV1(List<HubReportView> entities) {
		return entities.stream().map(this::toV1).toList();
	}

	/**
	 * Maps a report-view entity page to its generated contract response.
	 *
	 * @param page the persisted report-view page
	 * @return the generated page response
	 */
	public ReportViewPageResponseV1 toPageResponse(Page<HubReportView> page) {
		ReportViewPageResponseV1 response = new ReportViewPageResponseV1();
		response.setPageNumber(page.getNumber() + 1);
		response.setPageSize(page.getSize());
		response.setTotalElements(page.getTotalElements());
		response.setTotalPages(page.getTotalPages());
		response.setContent(toV1(page.getContent()));
		return response;
	}

	/**
	 * Maps an upsert request to a new/changed entity. The id, campaign id, and audit timestamps are
	 * left unset - they are server-owned and assigned by the entity service.
	 *
	 * @param request the upsert request
	 * @return the mapped entity
	 */
	public HubReportView fromUpsert(ReportViewUpsertV1 request) {
		HubReportView entity = new HubReportView();
		entity.setName(request.getName());
		entity.setType(request.getType().getValue());
		entity.setStatus(request.getStatus().getValue());
		entity.setNote(request.getNote());
		entity.setDimensions(join(request.getDimensions()));
		entity.setMetrics(join(request.getMetrics()));
		entity.setFilters(serializeFilters(request.getFilters()));
		return entity;
	}

	/**
	 * Serializes persisted report-row filters into the database JSON column.
	 *
	 * @param filters the filters from the upsert request
	 * @return a JSON array string, or {@code null} when no filters are saved
	 */
	String serializeFilters(List<ReportRowFilterV1> filters) {
		if (filters == null || filters.isEmpty()) {
			return null;
		}
		try {
			return objectMapper.writeValueAsString(filters);
		} catch (JsonProcessingException e) {
			throw new IllegalStateException("Failed to serialize report-view filters.", e);
		}
	}

	/**
	 * Deserializes the database JSON column into report-row filters. Malformed persisted JSON is treated
	 * as no saved filters so one bad row cannot break campaign reporting.
	 *
	 * @param filtersJson the JSON array column value
	 * @return the saved filters, or an empty list when none are available/readable
	 */
	List<ReportRowFilterV1> deserializeFilters(String filtersJson) {
		if (filtersJson == null || filtersJson.isBlank()) {
			return List.of();
		}
		try {
			return objectMapper.readValue(filtersJson, FILTERS_TYPE);
		} catch (JsonProcessingException e) {
			log.warn(
					"Failed to deserialize report-view filters JSON; ignoring saved filters: {}",
					e.getOriginalMessage());
			return List.of();
		}
	}

	/**
	 * Splits a comma-joined column into ids.
	 *
	 * @param csv the comma-joined column value
	 * @return the split ids; empty when {@code csv} is null or blank
	 */
	List<String> split(String csv) {
		return csv == null || csv.isBlank() ? List.of() : List.of(csv.split(","));
	}

	/**
	 * Joins ids into the comma-joined column value.
	 *
	 * @param ids the ids to join
	 * @return the comma-joined value; empty string when {@code ids} is null or empty
	 */
	String join(List<String> ids) {
		return ids == null ? "" : String.join(",", ids);
	}

	/**
	 * Formats an audit timestamp as ISO-8601.
	 *
	 * @param ts the timestamp to format
	 * @return the formatted timestamp, or {@code null} when {@code ts} is {@code null}
	 */
	String format(LocalDateTime ts) {
		return ts == null ? null : ts.format(ISO);
	}
}
