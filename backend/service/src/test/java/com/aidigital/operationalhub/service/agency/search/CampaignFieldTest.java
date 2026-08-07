package com.aidigital.operationalhub.service.agency.search;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link CampaignField} column metadata.
 */
class CampaignFieldTest {

	@Test
	void shouldExposeColumnExpressionsTest() {
		assertThat(CampaignField.ID.expression()).isEqualTo("id");
		assertThat(CampaignField.ID.numeric()).isTrue();
		assertThat(CampaignField.NAME.expression()).isEqualTo("name");
		assertThat(CampaignField.NAME.numeric()).isFalse();
		assertThat(CampaignField.CLIENT_ID.expression()).isEqualTo("clientId");
		assertThat(CampaignField.CLIENT_ID.numeric()).isTrue();
		assertThat(CampaignField.AGENCY_ID.expression()).isEqualTo("agencyId");
		assertThat(CampaignField.AGENCY_ID.numeric()).isTrue();
		assertThat(CampaignField.CLIENT_NAME.expression()).isEqualTo("clientName");
		assertThat(CampaignField.CLIENT_NAME.numeric()).isFalse();
		assertThat(CampaignField.STATUS.expression()).isEqualTo("status");
		assertThat(CampaignField.STATUS.numeric()).isFalse();
	}

	@Test
	void shouldResolveEnumByNameTest() {
		assertThat(CampaignField.valueOf("ID")).isEqualTo(CampaignField.ID);
		assertThat(CampaignField.valueOf("STATUS")).isEqualTo(CampaignField.STATUS);
	}
}
