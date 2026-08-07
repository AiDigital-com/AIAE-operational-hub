package com.aidigital.operationalhub.application.config;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryOperationContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Names each request's endpoint so the BigQuery jobs it runs can be attributed to it.
 *
 * <p>The endpoint is the unit worth measuring. "Opening a report costs four jobs and twelve gigabytes" is the
 * sentence a cost question needs; "the adjustments view was read" is not, because every screen reads it. The
 * handler method's name is that unit, already unique per endpoint and already stable - so
 * {@code getReportRows} becomes {@code get_report_rows}, which travels to BigQuery as a job label and tags the
 * Hub's own meters.
 *
 * <p>Cleared in {@code afterCompletion}, without exception: the thread goes back to the container's pool, and
 * a name left behind would be attributed to whatever request picks it up next.
 */
@Component
@RequiredArgsConstructor
public class BigQueryOperationInterceptor implements HandlerInterceptor {

	private static final String CAMEL_CASE_BOUNDARY = "([a-z0-9])([A-Z])";
	private static final String SNAKE_CASE_REPLACEMENT = "$1_$2";

	private final BigQueryOperationContext operationContext;

	@Override
	public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
		if (handler instanceof HandlerMethod handlerMethod) {
			operationContext.set(toOperationName(handlerMethod.getMethod().getName()));
		}
		return true;
	}

	@Override
	public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler,
			@Nullable Exception ex) {
		operationContext.clear();
	}

	/**
	 * Converts a handler method name into a BigQuery-friendly operation name.
	 *
	 * @param methodName the handler method's name, e.g. {@code getReportRows}
	 * @return the snake-cased name, e.g. {@code get_report_rows}
	 */
	String toOperationName(String methodName) {
		return methodName.replaceAll(CAMEL_CASE_BOUNDARY, SNAKE_CASE_REPLACEMENT).toLowerCase();
	}
}
