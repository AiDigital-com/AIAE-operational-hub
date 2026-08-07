package com.aidigital.operationalhub.externalservices.bigquery.impl;

import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link BigQueryWriteStubClient}.
 */
class BigQueryWriteStubClientTest {

	@Test
	void shouldReturnZeroWithoutContactingBigQueryTest() {
		// Given:
		BigQueryProperties properties = new BigQueryProperties();
		BigQueryWriteStubClient client = new BigQueryWriteStubClient(properties);

		// When:
		long affected = client.execute("INSERT INTO t VALUES (1)");

		// Then:
		assertThat(affected).isZero();
	}
}
