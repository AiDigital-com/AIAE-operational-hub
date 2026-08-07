package com.aidigital.operationalhub.service.agency.bigquery.service;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryOperationContext;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ReportQueryExecutorTest {

	@Test
	void shouldPropagateTheCurrentOperationContextForEachTaskTest() {
		// Given:
		BigQueryOperationContext operationContext = new BigQueryOperationContext();
		operationContext.set("Get Report Rows");

		try (ReportQueryExecutor executor = new ReportQueryExecutor(operationContext)) {
			// When:
			String propagatedOperation = executor.submit(operationContext::current).join();
			operationContext.clear();
			String nextOperation = executor.submit(operationContext::current).join();

			// Then:
			assertThat(propagatedOperation).isEqualTo("get_report_rows");
			assertThat(nextOperation).isEqualTo(BigQueryOperationContext.UNLABELLED);
		}
	}

	@Test
	void shouldPreserveTheSubmittedRuntimeFailureTest() {
		// Given:
		BigQueryOperationContext operationContext = new BigQueryOperationContext();

		try (ReportQueryExecutor executor = new ReportQueryExecutor(operationContext)) {
			// When / Then:
			assertThatThrownBy(() -> executor.await(executor.submit(() -> {
				throw new IllegalStateException("query failed");
			})))
					.isInstanceOf(IllegalStateException.class)
					.hasMessage("query failed");
		}
	}
}
