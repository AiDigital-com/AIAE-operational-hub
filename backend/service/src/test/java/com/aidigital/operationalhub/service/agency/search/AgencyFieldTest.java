package com.aidigital.operationalhub.service.agency.search;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link AgencyField} column metadata.
 */
class AgencyFieldTest {

	@Test
	void shouldExposeColumnExpressionsTest() {
		assertThat(AgencyField.ID.expression()).isEqualTo("Agency ID");
		assertThat(AgencyField.ID.numeric()).isTrue();
		assertThat(AgencyField.NAME.expression()).isEqualTo("Agency");
		assertThat(AgencyField.NAME.numeric()).isFalse();
	}

	@Test
	void shouldResolveEnumByNameTest() {
		assertThat(AgencyField.valueOf("STATUS")).isEqualTo(AgencyField.STATUS);
		assertThat(AgencyField.valueOf("EMAIL")).isEqualTo(AgencyField.EMAIL);
	}
}
