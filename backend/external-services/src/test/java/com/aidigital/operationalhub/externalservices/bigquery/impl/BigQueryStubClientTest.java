package com.aidigital.operationalhub.externalservices.bigquery.impl;

import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link BigQueryStubClient}.
 */
class BigQueryStubClientTest {

	@Test
	void shouldReturnEmptyResultSetTest() {
		// Given:
		BigQueryProperties properties = new BigQueryProperties();
		BigQueryStubClient client = new BigQueryStubClient(properties);

		// When:
		var rows = client.query("SELECT 1");

		// Then:
		assertThat(rows).isEmpty();
	}
}
