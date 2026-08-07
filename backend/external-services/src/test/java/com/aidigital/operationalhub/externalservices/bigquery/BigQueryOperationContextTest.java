package com.aidigital.operationalhub.externalservices.bigquery;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link BigQueryOperationContext}.
 */
class BigQueryOperationContextTest {

	@Test
	void shouldReadAsUnlabelledUntilSomethingNamesTheOperationTest() {
		// Given:
		BigQueryOperationContext context = new BigQueryOperationContext();

		// When-Then: a missing label must not stop a query
		assertThat(context.current()).isEqualTo("unlabelled");
	}

	@Test
	void shouldNormaliseANameToWhatBigQueryAcceptsAsALabelTest() {
		// Given:
		BigQueryOperationContext context = new BigQueryOperationContext();

		// When:
		context.set("Dashboard Data-Source: Publish!");

		// Then: BigQuery takes lowercase letters, digits, dashes and underscores, and nothing else
		assertThat(context.current()).isEqualTo("dashboard_data-source__publish_");
	}

	@Test
	void shouldTruncateANameToBigQuerysLabelLimitTest() {
		// Given: a name longer than the 63 characters BigQuery allows
		BigQueryOperationContext context = new BigQueryOperationContext();

		// When:
		context.set("a".repeat(80));

		// Then:
		assertThat(context.current()).hasSize(63);
	}

	@Test
	void shouldTreatABlankNameAsNoNameTest() {
		// Given:
		BigQueryOperationContext context = new BigQueryOperationContext();
		context.set("get_report_rows");

		// When:
		context.set("   ");

		// Then:
		assertThat(context.current()).isEqualTo("unlabelled");
	}

	@Test
	void shouldForgetTheNameWhenTheWorkFinishesTest() {
		// Given: a thread that has just served a named request
		BigQueryOperationContext context = new BigQueryOperationContext();
		context.set("get_report_rows");

		// When:
		context.clear();

		// Then: the next request on this pooled thread must not inherit the last one's name
		assertThat(context.current()).isEqualTo("unlabelled");
	}
}
