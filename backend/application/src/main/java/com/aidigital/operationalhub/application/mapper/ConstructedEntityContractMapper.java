package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.ConstructedEntityLevelEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConstructedEntityPageResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConstructedEntityV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConstructedIdOriginEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConstructedIdPreviewV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConstructedIdsPreviewRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConstructedIdsPreviewResponseV1;
import com.aidigital.operationalhub.service.agency.bigquery.model.ConstructedEntityLevel;
import com.aidigital.operationalhub.service.agency.model.ConstructedEntity;
import com.aidigital.operationalhub.service.agency.model.ConstructedIdsPreviewModel;
import com.aidigital.operationalhub.service.agency.model.ResolvedConstructedId;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Component;

/**
 * Maps the Add Line name-resolution/preview service models (PDI_117) to and from the generated
 * {@code ConstructedEntity}/{@code ConstructedIdsPreview} contract.
 */
@Component
public class ConstructedEntityContractMapper {

	/**
	 * Maps the generated level enum onto {@link ConstructedEntityLevel} - the two share constant names
	 * by construction, so this maps by name with no lookup table to keep in sync (same pattern as
	 * {@link ReportRowContractMapper#toFilterField}).
	 *
	 * @param level the generated level enum
	 * @return the mapped service-layer level
	 */
	public ConstructedEntityLevel toLevel(ConstructedEntityLevelEnumV1 level) {
		return ConstructedEntityLevel.valueOf(level.name());
	}

	/**
	 * Maps a page of constructed entities into the generated page response.
	 *
	 * @param page the constructed-entity page
	 * @return the generated page response
	 */
	public ConstructedEntityPageResponseV1 toPageResponse(Page<ConstructedEntity> page) {
		ConstructedEntityPageResponseV1 response = new ConstructedEntityPageResponseV1();
		response.setPageNumber(page.getNumber() + 1);
		response.setPageSize(page.getSize());
		response.setTotalElements(page.getTotalElements());
		response.setTotalPages(page.getTotalPages());
		response.setContent(page.getContent().stream().map(this::toV1).toList());
		return response;
	}

	/**
	 * Maps a single constructed entity into the generated contract.
	 *
	 * @param entity the constructed entity
	 * @return the generated entity V1
	 */
	public ConstructedEntityV1 toV1(ConstructedEntity entity) {
		ConstructedEntityV1 v1 = new ConstructedEntityV1(entity.name(), entity.id());
		v1.setFirstDate(entity.firstDate());
		v1.setLastDate(entity.lastDate());
		v1.setImpressions(entity.impressions());
		return v1;
	}

	/**
	 * Maps the three previewed levels into the generated response.
	 *
	 * @param preview the previewed ids
	 * @return the generated preview response
	 */
	public ConstructedIdsPreviewResponseV1 toResponse(ConstructedIdsPreviewModel preview) {
		ConstructedIdsPreviewResponseV1 response = new ConstructedIdsPreviewResponseV1();
		response.setLevel1(toV1(preview.level1()));
		response.setLevel2(toV1(preview.level2()));
		response.setLevel3(toV1(preview.level3()));
		return response;
	}

	/**
	 * Maps one resolved constructed id into the generated contract.
	 *
	 * @param resolved the resolved id
	 * @return the generated preview V1
	 */
	public ConstructedIdPreviewV1 toV1(ResolvedConstructedId resolved) {
		return new ConstructedIdPreviewV1(
				resolved.value(), ConstructedIdOriginEnumV1.valueOf(resolved.origin().name()));
	}

	/**
	 * Reads the level-1 name off the preview request.
	 *
	 * @param request the generated preview request
	 * @return the level-1 constructed name
	 */
	public String toName(ConstructedIdsPreviewRequestV1 request) {
		return request.getConstructedName();
	}

	/**
	 * Reads the level-2 name off the preview request.
	 *
	 * @param request the generated preview request
	 * @return the level-2 constructed name
	 */
	public String toNameLvl2(ConstructedIdsPreviewRequestV1 request) {
		return request.getConstructedNameLvl2();
	}

	/**
	 * Reads the level-3 name off the preview request.
	 *
	 * @param request the generated preview request
	 * @return the level-3 constructed name
	 */
	public String toNameLvl3(ConstructedIdsPreviewRequestV1 request) {
		return request.getConstructedNameLvl3();
	}
}
