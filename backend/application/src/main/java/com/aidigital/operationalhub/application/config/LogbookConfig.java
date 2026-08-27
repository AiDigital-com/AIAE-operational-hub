package com.aidigital.operationalhub.application.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.zalando.logbook.BodyFilter;
import org.zalando.logbook.HeaderFilter;
import org.zalando.logbook.HttpRequest;
import org.zalando.logbook.Logbook;
import org.zalando.logbook.core.BodyFilters;
import org.zalando.logbook.core.Conditions;
import org.zalando.logbook.core.DefaultHttpLogWriter;
import org.zalando.logbook.core.DefaultSink;
import org.zalando.logbook.core.HeaderFilters;
import org.zalando.logbook.json.JsonBodyFilters;
import org.zalando.logbook.json.JsonHttpLogFormatter;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;

/**
 * Configures structured (JSON) inbound/outbound HTTP logging via Zalando Logbook.
 *
 * <p>Logbook's permissive defaults are not enough: this config enforces the company rules — sensitive
 * headers ({@code Authorization}, cookies, API keys, …) and secret-like JSON fields (password, token,
 * secret, key, credential, service-account, …) are masked, and noisy infrastructure (actuator,
 * swagger, OpenAPI specs, health probes, all OPTIONS) is excluded. Request and response bodies are
 * always logged <em>after</em> filtering. Binds {@code app.logbook.*} (see {@code application.yml}).
 */
@Configuration
@EnableConfigurationProperties(LogbookConfig.LogbookProperties.class)
public class LogbookConfig {

	/**
	 * Builds the {@link Logbook} instance used by the servlet filter, applying header masking, JSON
	 * body-field masking, and infrastructure exclusions from the bound properties.
	 *
	 * @param props the bound masking and exclusion settings
	 * @return the configured Logbook instance
	 */
	@Bean
	Logbook logbook(LogbookProperties props) {
		HeaderFilter headerFilter = HeaderFilters.replaceHeaders(
				name -> props.getHeadersToCensor().stream().anyMatch(header -> header.equalsIgnoreCase(name)),
				props.getCensoredReplacement());

		List<BodyFilter> bodyFilters = new ArrayList<>();
		for (String pattern : props.getJsonFieldsToCensor()) {
			bodyFilters.add(JsonBodyFilters.replaceJsonStringProperty(
					Set.of(pattern), props.getCensoredReplacement()));
		}
		bodyFilters.add(binaryBodyFilter());
		bodyFilters.add(BodyFilters.truncate(props.getMaxLoggedBodyChars()));
		BodyFilter combinedBodyFilter = bodyFilters.stream()
				.reduce(BodyFilter::merge)
				.orElse(BodyFilters.defaultValue());

		// Exclude noisy infrastructure: each entry maps a path pattern to the methods that must not be logged.
		List<Predicate<HttpRequest>> exclusions = props.getExcluded().entrySet().stream()
				.flatMap(entry -> entry.getValue().stream()
						.map(method -> Conditions.requestTo(entry.getKey())
								.and(Conditions.requestWithMethod(method))))
				.toList();

		return Logbook.builder()
				.condition(Conditions.exclude(exclusions))
				.headerFilter(headerFilter)
				.bodyFilter(combinedBodyFilter)
				.sink(new DefaultSink(new JsonHttpLogFormatter(), new DefaultHttpLogWriter()))
				.build();
	}

	/**
	 * Replaces a binary body (an .xlsx export/template download or a re-uploaded bulk-adjustment file)
	 * with a placeholder rather than logging raw binary bytes - a defense-in-depth backstop for any path
	 * not already covered by {@link LogbookProperties#getExcluded()}.
	 *
	 * @return the body filter
	 */
	BodyFilter binaryBodyFilter() {
		return (contentType, body) -> contentType != null && contentType.contains("spreadsheetml")
				? "<binary spreadsheet body omitted>"
				: body;
	}

	/**
	 * Binds {@code app.logbook.*} from {@code application.yml}. Defaults mirror the canonical rules so a
	 * fresh deployment is compliant without overrides.
	 */
	@ConfigurationProperties("app.logbook")
	public static class LogbookProperties {

		private String censoredReplacement = "XXX";
		private List<String> headersToCensor = List.of(
				"Authorization", "Cookie", "Set-Cookie",
				"X-API-Key", "AccessKey", "Proxy-Authorization");
		private List<String> jsonFieldsToCensor = List.of(
				"(?i).*password.*", "(?i).*token.*", "(?i).*secret.*", "(?i).*key.*",
				"(?i).*credential.*", "(?i).*authorization.*",
				"(?i)privateKey", "(?i)clientSecret", "(?i)serviceAccount");
		private Map<String, List<String>> excluded = Map.of(
				"/actuator/**", List.of("GET"),
				"/**/swagger-ui/**", List.of("GET"),
				"/**/specs/**", List.of("GET"),
				"/health", List.of("GET"),
				"/**", List.of("OPTIONS"),
				// Report-row listing/export/adjustment paths: multi-MB .xlsx binaries and ~48-column page
				// bodies, neither of which belongs in a log record.
				"/**/report-rows/**", List.of("GET", "POST"));

		private int maxLoggedBodyChars = 10_000;

		/**
		 * Returns the replacement value substituted for masked headers and JSON fields.
		 *
		 * @return the censored replacement value
		 */
		public String getCensoredReplacement() {
			return censoredReplacement;
		}

		/**
		 * Sets the replacement value substituted for masked headers and JSON fields.
		 *
		 * @param censoredReplacement the censored replacement value
		 */
		public void setCensoredReplacement(String censoredReplacement) {
			this.censoredReplacement = censoredReplacement;
		}

		/**
		 * Returns the header names to mask (case-insensitive).
		 *
		 * @return the header names to censor
		 */
		public List<String> getHeadersToCensor() {
			return headersToCensor;
		}

		/**
		 * Sets the header names to mask (case-insensitive).
		 *
		 * @param headersToCensor the header names to censor
		 */
		public void setHeadersToCensor(List<String> headersToCensor) {
			this.headersToCensor = headersToCensor;
		}

		/**
		 * Returns the JSON field-name patterns whose string values are masked.
		 *
		 * @return the JSON field patterns to censor
		 */
		public List<String> getJsonFieldsToCensor() {
			return jsonFieldsToCensor;
		}

		/**
		 * Sets the JSON field-name patterns whose string values are masked.
		 *
		 * @param jsonFieldsToCensor the JSON field patterns to censor
		 */
		public void setJsonFieldsToCensor(List<String> jsonFieldsToCensor) {
			this.jsonFieldsToCensor = jsonFieldsToCensor;
		}

		/**
		 * Returns the excluded requests as a map of path pattern to the HTTP methods not to log.
		 *
		 * @return the exclusions by path pattern
		 */
		public Map<String, List<String>> getExcluded() {
			return excluded;
		}

		/**
		 * Sets the excluded requests as a map of path pattern to the HTTP methods not to log.
		 *
		 * @param excluded the exclusions by path pattern
		 */
		public void setExcluded(Map<String, List<String>> excluded) {
			this.excluded = excluded;
		}

		/**
		 * Returns the maximum number of characters logged of any one request/response body before it is
		 * truncated.
		 *
		 * @return the maximum logged body length, in characters
		 */
		public int getMaxLoggedBodyChars() {
			return maxLoggedBodyChars;
		}

		/**
		 * Sets the maximum number of characters logged of any one request/response body before it is
		 * truncated.
		 *
		 * @param maxLoggedBodyChars the maximum logged body length, in characters
		 */
		public void setMaxLoggedBodyChars(int maxLoggedBodyChars) {
			this.maxLoggedBodyChars = maxLoggedBodyChars;
		}
	}
}
