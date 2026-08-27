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
import com.aidigital.operationalhub.service.agency.model.ConstructedIdOrigin;
import com.aidigital.operationalhub.service.agency.model.ConstructedIdsPreviewModel;
import com.aidigital.operationalhub.service.agency.model.ResolvedConstructedId;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ConstructedEntityContractMapper} - PDI_117's Add Line picker/preview contract.
 */
class ConstructedEntityContractMapperTest {

	private final ConstructedEntityContractMapper mapper = new ConstructedEntityContractMapper();

	@Test
	void shouldMapEveryGeneratedLevelByNameTest() {
		// When/Then:
		assertThat(mapper.toLevel(ConstructedEntityLevelEnumV1.LVL1)).isEqualTo(ConstructedEntityLevel.LVL1);
		assertThat(mapper.toLevel(ConstructedEntityLevelEnumV1.LVL2)).isEqualTo(ConstructedEntityLevel.LVL2);
		assertThat(mapper.toLevel(ConstructedEntityLevelEnumV1.LVL3)).isEqualTo(ConstructedEntityLevel.LVL3);
	}

	@Test
	void shouldMapAPageOfConstructedEntitiesTest() {
		// Given:
		ConstructedEntity entity = new ConstructedEntity("Retargeting", "12345", "2026-03-01", "2026-03-10", 500L);
		var page = new PageImpl<>(List.of(entity), PageRequest.of(0, 20), 1);

		// When:
		ConstructedEntityPageResponseV1 response = mapper.toPageResponse(page);

		// Then:
		assertThat(response.getPageNumber()).isEqualTo(1);
		assertThat(response.getPageSize()).isEqualTo(20);
		assertThat(response.getTotalElements()).isEqualTo(1L);
		ConstructedEntityV1 v1 = response.getContent().get(0);
		assertThat(v1.getName()).isEqualTo("Retargeting");
		assertThat(v1.getId()).isEqualTo("12345");
		assertThat(v1.getFirstDate()).isEqualTo("2026-03-01");
		assertThat(v1.getLastDate()).isEqualTo("2026-03-10");
		assertThat(v1.getImpressions()).isEqualTo(500L);
	}

	@Test
	void shouldMapAPreviewResponseWithMixedOriginsTest() {
		// Given:
		ConstructedIdsPreviewModel preview = new ConstructedIdsPreviewModel(
				new ResolvedConstructedId("12345", ConstructedIdOrigin.EXISTING),
				new ResolvedConstructedId("OPH_ioid00000000", ConstructedIdOrigin.GENERATED),
				new ResolvedConstructedId("OPH_creativeid000", ConstructedIdOrigin.GENERATED));

		// When:
		ConstructedIdsPreviewResponseV1 response = mapper.toResponse(preview);

		// Then:
		ConstructedIdPreviewV1 level1 = response.getLevel1();
		assertThat(level1.getId()).isEqualTo("12345");
		assertThat(level1.getOrigin()).isEqualTo(ConstructedIdOriginEnumV1.EXISTING);
		assertThat(response.getLevel2().getOrigin()).isEqualTo(ConstructedIdOriginEnumV1.GENERATED);
		assertThat(response.getLevel3().getId()).isEqualTo("OPH_creativeid000");
	}

	@Test
	void shouldReadEachLevelsNameOffThePreviewRequestTest() {
		// Given:
		ConstructedIdsPreviewRequestV1 request =
				new ConstructedIdsPreviewRequestV1("Line 1", "Insertion Order 1", "Creative 1");

		// When/Then:
		assertThat(mapper.toName(request)).isEqualTo("Line 1");
		assertThat(mapper.toNameLvl2(request)).isEqualTo("Insertion Order 1");
		assertThat(mapper.toNameLvl3(request)).isEqualTo("Creative 1");
	}
}
