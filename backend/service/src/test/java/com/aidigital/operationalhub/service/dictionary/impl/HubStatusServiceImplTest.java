package com.aidigital.operationalhub.service.dictionary.impl;

import com.aidigital.operationalhub.domain.enums.HubStatus;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link HubStatusServiceImpl}.
 */
class HubStatusServiceImplTest {

	@Test
	void shouldListAllHubStatusesTest() {
		// Given:
		HubStatusServiceImpl service = new HubStatusServiceImpl();

		// When:
		List<HubStatus> statuses = service.listStatuses();

		// Then:
		assertThat(statuses).containsExactly(HubStatus.values());
	}
}
