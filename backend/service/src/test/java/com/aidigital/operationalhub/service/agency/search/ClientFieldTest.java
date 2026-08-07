package com.aidigital.operationalhub.service.agency.search;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ClientField} column metadata.
 */
class ClientFieldTest {

	@Test
	void shouldExposeColumnExpressionsTest() {
		assertThat(ClientField.ID.expression()).isEqualTo("Advertiser ID");
		assertThat(ClientField.ID.numeric()).isTrue();
		assertThat(ClientField.AGENCY_ID.expression()).isEqualTo("Agency ID");
		assertThat(ClientField.AGENCY_ID.numeric()).isTrue();
		assertThat(ClientField.NAME.expression()).isEqualTo("Advertiser");
		assertThat(ClientField.NAME.numeric()).isFalse();
	}

	@Test
	void shouldResolveEnumByNameTest() {
		assertThat(ClientField.valueOf("STATUS")).isEqualTo(ClientField.STATUS);
		assertThat(ClientField.valueOf("EMAIL")).isEqualTo(ClientField.EMAIL);
	}
}
