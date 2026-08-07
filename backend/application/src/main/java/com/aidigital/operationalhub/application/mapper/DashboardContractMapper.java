package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardCreateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardDatasetFilterV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.DashboardDatasetRowV1;
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
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * Maps {@link HubDashboard} entities to/from the generated dashboard contract.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class DashboardContractMapper {

	private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_LOCAL_DATE_TIME;
	private static final TypeReference<List<DashboardDatasetFilter>> FILTERS_TYPE = new TypeReference<>() {
	};

	private final ObjectMapper objectMapper;

	/**
	 * Maps a persisted dashboard to its generated contract representation. {@code edited} is {@code null}
	 * when the dashboard was never modified since creation - {@link HubDashboard}'s audit timestamps are both
	 * stamped equal on insert and are never null themselves.
	 *
	 * @param entity the persisted dashboard
	 * @return the generated contract representation
	 */
	public DashboardV1 toV1(HubDashboard entity) {
		DashboardV1 v1 = new DashboardV1();
		v1.setId(entity.getId());
		v1.setCampaignId(entity.getCampaignId());
		v1.setName(entity.getName());
		v1.setType(DashboardTypeEnumV1.fromValue(entity.getType()));
		v1.setStatus(DashboardStatusEnumV1.fromValue(entity.getStatus()));
		v1.setOptionalColumns(split(entity.getOptionalColumns()));
		v1.setColumnOrder(split(entity.getColumnOrder()));
		v1.setFilters(deserializeFilters(entity.getFilters()));
		v1.setDateFrom(entity.getDateFrom());
		v1.setDateTo(entity.getDateTo());
		v1.setSourceTable(entity.getSourceTable());
		v1.setSourceRowCount(entity.getSourceRowCount());
		v1.setSourceCreated(format(entity.getSourceCreatedAt()));
		v1.setDisplayCampaignName(entity.getDisplayCampaignName());
		v1.setCreated(format(entity.getCreatedAt()));
		v1.setEdited(entity.getUpdatedAt().equals(entity.getCreatedAt()) ? null : format(entity.getUpdatedAt()));
		return v1;
	}

	/**
	 * Maps a list of dashboards to their generated contract representations.
	 *
	 * @param entities the persisted dashboards
	 * @return the generated contract representations
	 */
	public List<DashboardV1> toV1(List<HubDashboard> entities) {
		return entities.stream().map(this::toV1).toList();
	}

	/**
	 * Maps a dashboard entity page to its generated contract response.
	 *
	 * @param page the persisted dashboard page
	 * @return the generated page response
	 */
	public DashboardPageResponseV1 toPageResponse(Page<HubDashboard> page) {
		DashboardPageResponseV1 response = new DashboardPageResponseV1();
		response.setPageNumber(page.getNumber() + 1);
		response.setPageSize(page.getSize());
		response.setTotalElements(page.getTotalElements());
		response.setTotalPages(page.getTotalPages());
		response.setContent(toV1(page.getContent()));
		return response;
	}

	/**
	 * Maps a dataset preview to its generated contract representation.
	 *
	 * <p>The column selection travels with the count rather than being read again by the caller: a figure shown
	 * beside a different selection than it was measured under would be a quietly wrong number.
	 *
	 * @param preview the counted preview
	 * @return the generated contract representation
	 */
	public DashboardPreviewV1 toV1(DashboardPreview preview) {
		DashboardPreviewV1 v1 = new DashboardPreviewV1();
		v1.setRowCount(preview.rowCount());
		v1.setOptionalColumns(keptColumns(preview.optionalColumns()));
		v1.setSourceTable(preview.sourceTable());
		return v1;
	}

	/**
	 * Maps a service dataset page to its generated contract representation.
	 *
	 * @param page the service page
	 * @return the generated page response
	 */
	public DashboardDatasetRowsPageResponseV1 toPageResponse(DashboardDatasetPage page) {
		DashboardDatasetRowsPageResponseV1 response = new DashboardDatasetRowsPageResponseV1();
		response.setPageNumber(page.pageNumber());
		response.setPageSize(page.pageSize());
		response.setTotalElements(page.totalElements());
		response.setTotalPages(page.totalPages());
		response.setContent(page.content().stream().map(this::toV1).toList());
		return response;
	}

	/**
	 * Maps one service dataset row to its generated contract representation.
	 *
	 * @param row the service row
	 * @return the generated row
	 */
	DashboardDatasetRowV1 toV1(DashboardDatasetRow row) {
		return new DashboardDatasetRowV1().values(row.values());
	}

	/**
	 * Maps dashboard dataset search filters to the service model.
	 *
	 * @param request the generated request, or {@code null}
	 * @return service filters; empty when absent
	 */
	public DashboardDatasetCriteria toCriteria(DashboardDatasetRowsSearchRequestV1 request) {
		if (request == null) {
			return DashboardDatasetCriteria.none();
		}
		return new DashboardDatasetCriteria(
				toFilters(request.getFilters()), dateString(request.getDateFrom()), dateString(request.getDateTo()));
	}

	/**
	 * Maps generated filters to service filters.
	 *
	 * @param filters generated filters, or {@code null}
	 * @return service filters; empty when absent
	 */
	List<DashboardDatasetFilter> toFilters(List<DashboardDatasetFilterV1> filters) {
		if (filters == null) {
			return List.of();
		}
		return filters.stream()
				.filter(Objects::nonNull)
				.map(this::toFilter)
				.toList();
	}

	/**
	 * Maps one generated filter to the service model.
	 *
	 * @param filter the generated filter
	 * @return the service filter
	 */
	DashboardDatasetFilter toFilter(DashboardDatasetFilterV1 filter) {
		return new DashboardDatasetFilter(filter.getField(), filter.getValues());
	}

	/**
	 * Lists the optional columns a choice keeps.
	 *
	 * @param choice the column choice
	 * @return the kept column ids
	 */
	List<String> keptColumns(DashboardColumnChoice choice) {
		List<String> kept = new ArrayList<>();
		if (choice.creative()) {
			kept.add(DashboardColumnChoice.CREATIVE);
		}
		if (choice.cpa()) {
			kept.add(DashboardColumnChoice.CPA);
		}
		return kept;
	}

	/**
	 * Maps a create request to a new entity. The id, campaign id, status, source fields, and audit timestamps
	 * are left unset - they are server-owned and assigned by the entity service.
	 *
	 * @param request the create request
	 * @return the mapped entity
	 */
	public HubDashboard fromCreate(DashboardCreateV1 request) {
		HubDashboard entity = new HubDashboard();
		entity.setName(request.getName());
		entity.setType(request.getType().getValue());
		entity.setOptionalColumns(join(request.getOptionalColumns()));
		entity.setFilters(serializeFilters(request.getFilters()));
		entity.setDateFrom(request.getDateFrom());
		entity.setDateTo(request.getDateTo());
		entity.setDisplayCampaignName(request.getDisplayCampaignName());
		return entity;
	}

	/**
	 * Maps an update request to a carrier of the editable fields. The type is absent from the request on
	 * purpose - it is the schema of a table ClicData may already be reading - so it is left unset here too.
	 *
	 * @param request the update request
	 * @return the mapped entity carrying only the editable fields
	 */
	public HubDashboard fromUpdate(DashboardUpdateV1 request) {
		HubDashboard entity = new HubDashboard();
		entity.setName(request.getName());
		entity.setOptionalColumns(join(request.getOptionalColumns()));
		entity.setColumnOrder(join(request.getColumnOrder()));
		entity.setFilters(serializeFilters(request.getFilters()));
		entity.setDateFrom(request.getDateFrom());
		entity.setDateTo(request.getDateTo());
		entity.setDisplayCampaignName(request.getDisplayCampaignName());
		return entity;
	}

	/**
	 * Serializes dashboard dataset filters into the database JSON column.
	 *
	 * @param filters generated filters from the request
	 * @return a JSON array string, or {@code null} when no filters are saved
	 */
	String serializeFilters(List<DashboardDatasetFilterV1> filters) {
		List<DashboardDatasetFilter> serviceFilters = toFilters(filters);
		if (serviceFilters.isEmpty()) {
			return null;
		}
		try {
			return objectMapper.writeValueAsString(serviceFilters);
		} catch (JsonProcessingException e) {
			throw new IllegalStateException("Failed to serialize dashboard filters.", e);
		}
	}

	/**
	 * Deserializes the database JSON column into dashboard dataset filters.
	 *
	 * @param filtersJson the JSON array column value
	 * @return generated filters, or an empty list when none are available/readable
	 */
	List<DashboardDatasetFilterV1> deserializeFilters(String filtersJson) {
		if (filtersJson == null || filtersJson.isBlank()) {
			return List.of();
		}
		try {
			return objectMapper.readValue(filtersJson, FILTERS_TYPE).stream()
					.map(filter -> new DashboardDatasetFilterV1()
							.field(filter.field())
							.values(filter.values()))
					.toList();
		} catch (JsonProcessingException e) {
			log.warn(
					"Failed to deserialize dashboard filters JSON; ignoring saved filters: {}",
					e.getOriginalMessage());
			return List.of();
		}
	}

	/**
	 * Splits the comma-joined optional-column value into ids.
	 *
	 * <p>Blank answers an empty list because that is what it means: exactly none of the optional columns were
	 * kept. There is no "unspecified" reading to fall back to - the contract requires the field, and a
	 * default here would be a second opinion about a schema only the type gets to decide.
	 *
	 * @param csv the comma-joined column value
	 * @return the split ids; empty when {@code csv} is null or blank
	 */
	List<String> split(String csv) {
		return csv == null || csv.isBlank() ? List.of() : List.of(csv.split(","));
	}

	/**
	 * Joins optional-column ids into the comma-joined column value.
	 *
	 * @param ids the ids to join
	 * @return the comma-joined value; empty string when {@code ids} is null or empty
	 */
	String join(List<String> ids) {
		return ids == null ? "" : String.join(",", ids);
	}

	/**
	 * Converts a generated date to the service criteria boundary format.
	 *
	 * @param date the generated date, or {@code null}
	 * @return ISO date string, or {@code null} when absent
	 */
	String dateString(LocalDate date) {
		return date == null ? null : date.toString();
	}

	/**
	 * Formats a timestamp as ISO-8601.
	 *
	 * @param ts the timestamp to format
	 * @return the formatted timestamp, or {@code null} when {@code ts} is {@code null}
	 */
	String format(LocalDateTime ts) {
		return ts == null ? null : ts.format(ISO);
	}
}
