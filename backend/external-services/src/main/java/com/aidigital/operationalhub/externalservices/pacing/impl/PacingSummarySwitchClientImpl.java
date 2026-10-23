package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.PacingSummarySwitchClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSlackSummarySwitch;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/**
 * The daily Slack summaries switch, over HTTP. A fresh {@link HubAssertion} is signed on every call,
 * never cached across requests - the same rule the main client follows.
 */
@Slf4j
@RequiredArgsConstructor
public class PacingSummarySwitchClientImpl implements PacingSummarySwitchClient {

	private static final String PATH = "/api/admin/slack-summaries";
	private static final String GET = "GET";
	private static final String PUT = "PUT";
	private static final String UNKNOWN_USER = "unknown_user";

	private final RestClient restClient;
	private final HubAssertionSigner assertionSigner;
	private final ObjectMapper objectMapper;

	@Override
	public PacingSlackSummarySwitch getSwitch(HubAssertion assertion) {
		try {
			SlackSummarySwitchResponse response = restClient.get()
					.uri(PATH)
					.header(HubAssertionSigner.HEADER_NAME, assertionSigner.sign(assertion))
					.retrieve()
					.body(SlackSummarySwitchResponse.class);
			return toSwitch(GET, response);
		} catch (RestClientResponseException ex) {
			throw failure(GET, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: GET " + PATH, ex);
		}
	}

	@Override
	public PacingSlackSummarySwitch updateSwitch(HubAssertion assertion, boolean enabled) {
		try {
			SlackSummarySwitchResponse response = restClient.put()
					.uri(PATH)
					.header(HubAssertionSigner.HEADER_NAME, assertionSigner.sign(assertion))
					.contentType(MediaType.APPLICATION_JSON)
					.body(new SlackSummarySwitchRequest(enabled))
					.retrieve()
					.body(SlackSummarySwitchResponse.class);
			return toSwitch(PUT, response);
		} catch (RestClientResponseException ex) {
			throw failure(PUT, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: PUT " + PATH, ex);
		}
	}

	/**
	 * Reads the response into the external-services model. An empty body or a missing {@code enabled}
	 * is an error, never a guess: the screen must not show "on" or "off" for a state Pacing did not
	 * actually report.
	 *
	 * @param method   the HTTP method that was called, for the error message
	 * @param response the wire body, possibly null
	 * @return the mapped switch
	 */
	PacingSlackSummarySwitch toSwitch(String method, SlackSummarySwitchResponse response) {
		if (response == null || response.enabled() == null) {
			throw new PacingExternalException(
					PacingFailureReason.OTHER,
					"Pacing request failed: " + method + " " + PATH + " returned no switch state");
		}
		return new PacingSlackSummarySwitch(response.enabled(), response.updated_at(), response.updated_by());
	}

	/**
	 * Maps a non-2xx answer. 403 follows the uniform rule ({@code unknown_user} is a sync gap between
	 * the Hub's employees and Pacing's mirror of them, anything else - here {@code admin_only} - is a
	 * real authorization decision); a 400 carries Pacing's own {@code detail}.
	 *
	 * @param method the HTTP method that was called
	 * @param ex     the response exception
	 * @return the mapped exception, ready to throw
	 */
	PacingExternalException failure(String method, RestClientResponseException ex) {
		int status = ex.getStatusCode().value();
		JsonNode body = readBody(ex);
		String error = textField(body, "error");
		String where = "Pacing request failed: " + method + " " + PATH + " returned HTTP " + status;
		return switch (status) {
			case 400 -> new PacingExternalException(
					PacingFailureReason.UPSTREAM_BAD_REQUEST, where, textField(body, "detail"));
			case 401 -> new PacingExternalException(PacingFailureReason.UPSTREAM_UNAUTHORIZED, where);
			case 403 -> new PacingExternalException(
					error == null || UNKNOWN_USER.equals(error)
							? PacingFailureReason.UPSTREAM_USER_NOT_SYNCED
							: PacingFailureReason.UPSTREAM_FORBIDDEN,
					where);
			default -> new PacingExternalException(PacingFailureReason.OTHER, where);
		};
	}

	/**
	 * Parses a non-2xx body as JSON, degrading to an empty object rather than throwing a second
	 * exception that would hide the first.
	 *
	 * @param ex the response exception whose body to parse
	 * @return the parsed body, or an empty object node
	 */
	JsonNode readBody(RestClientResponseException ex) {
		byte[] bytes = ex.getResponseBodyAsByteArray();
		if (bytes == null || bytes.length == 0) {
			return objectMapper.createObjectNode();
		}
		try {
			return objectMapper.readTree(new String(bytes, StandardCharsets.UTF_8));
		} catch (Exception parseFailure) {
			log.warn("Could not parse Pacing's error body as JSON: {}", parseFailure.getMessage());
			return objectMapper.createObjectNode();
		}
	}

	/**
	 * One string field of a parsed body.
	 *
	 * @param node  the parsed body
	 * @param field the field name
	 * @return its text, or null when absent or JSON null
	 */
	String textField(JsonNode node, String field) {
		JsonNode value = node.get(field);
		return value == null || value.isNull() ? null : value.asText();
	}
}
