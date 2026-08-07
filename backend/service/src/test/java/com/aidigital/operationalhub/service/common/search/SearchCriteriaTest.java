package com.aidigital.operationalhub.service.common.search;

import com.aidigital.operationalhub.service.rbac.search.HubUserField;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link SearchCriteria} — accessors and the derived page offset.
 */
class SearchCriteriaTest {

	@Test
	void shouldExposeComponentsAndDeriveZeroBasedOffsetTest() {
		// Given: page 3 of size 20
		SearchCriteria<HubUserField> criteria = new SearchCriteria<>(List.of(), null, 3, 20);

		// Then:
		assertThat(criteria.pageNumber()).isEqualTo(3);
		assertThat(criteria.pageSize()).isEqualTo(20);
		assertThat(criteria.filters()).isEmpty();
		assertThat(criteria.sort()).isNull();
		assertThat(criteria.offset()).isEqualTo(40);
	}
}
