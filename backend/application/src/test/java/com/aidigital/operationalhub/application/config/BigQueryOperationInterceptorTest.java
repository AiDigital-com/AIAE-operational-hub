package com.aidigital.operationalhub.application.config;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryOperationContext;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.method.HandlerMethod;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link BigQueryOperationInterceptor}.
 */
class BigQueryOperationInterceptorTest {

	@Test
	void shouldNameTheOperationAfterTheHandlerMethodTest() throws Exception {
		// Given: a request about to be served by a controller method
		BigQueryOperationContext context = new BigQueryOperationContext();
		BigQueryOperationInterceptor interceptor = new BigQueryOperationInterceptor(context);
		HandlerMethod handler = new HandlerMethod(
				this, getClass().getDeclaredMethod("getReportRows"));

		// When:
		boolean proceed = interceptor.preHandle(
				new MockHttpServletRequest(), new MockHttpServletResponse(), handler);

		// Then: the endpoint is the unit a cost question asks about
		assertThat(proceed).isTrue();
		assertThat(context.current()).isEqualTo("get_report_rows");
	}

	@Test
	void shouldLeaveTheNameUnsetForANonControllerHandlerTest() throws Exception {
		// Given: a handler that is not a controller method, such as a static-resource handler
		BigQueryOperationContext context = new BigQueryOperationContext();
		BigQueryOperationInterceptor interceptor = new BigQueryOperationInterceptor(context);

		// When:
		boolean proceed = interceptor.preHandle(
				new MockHttpServletRequest(), new MockHttpServletResponse(), new Object());

		// Then:
		assertThat(proceed).isTrue();
		assertThat(context.current()).isEqualTo("unlabelled");
	}

	@Test
	void shouldForgetTheNameOnceTheRequestIsDoneTest() throws Exception {
		// Given: a served request whose thread is about to return to the container's pool
		BigQueryOperationContext context = new BigQueryOperationContext();
		BigQueryOperationInterceptor interceptor = new BigQueryOperationInterceptor(context);
		HandlerMethod handler = new HandlerMethod(
				this, getClass().getDeclaredMethod("getReportRows"));
		interceptor.preHandle(new MockHttpServletRequest(), new MockHttpServletResponse(), handler);

		// When:
		interceptor.afterCompletion(
				new MockHttpServletRequest(), new MockHttpServletResponse(), handler, null);

		// Then: the next request on this thread must not be attributed to this one
		assertThat(context.current()).isEqualTo("unlabelled");
	}

	@Test
	void shouldSnakeCaseAHandlerMethodNameTest() {
		// Given:
		BigQueryOperationInterceptor interceptor =
				new BigQueryOperationInterceptor(new BigQueryOperationContext());

		// When-Then:
		assertThat(interceptor.toOperationName("getReportRows")).isEqualTo("get_report_rows");
		assertThat(interceptor.toOperationName("createDashboardDataSourceV1"))
				.isEqualTo("create_dashboard_data_source_v1");
		assertThat(interceptor.toOperationName("sync")).isEqualTo("sync");
	}

	/**
	 * Stands in for a controller method, so the interceptor has a real {@link HandlerMethod} to read.
	 */
	public void getReportRows() {
		// A name is all this test needs from it.
	}
}
