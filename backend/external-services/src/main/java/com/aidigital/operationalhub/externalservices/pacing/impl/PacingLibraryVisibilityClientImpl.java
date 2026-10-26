package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.PacingLibraryVisibilityClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibrarySaveOutcome;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/**
 * Only me / Team for a library entry, over HTTP. A fresh {@link HubAssertion} is signed on every call,
 * never cached across requests - the same rule the main client follows.
 */
@Slf4j
@RequiredArgsConstructor
public class PacingLibraryVisibilityClientImpl implements PacingLibraryVisibilityClient {

	private static final String LIBRARY_PATH = "/api/library";
	private static final String UNKNOWN_USER = "unknown_user";

	/** The v2 writer marker every library write carries - the same constant {@code PacingClientImpl} sends. */
	private static final Map<String, Object> V2_WRITER =
			Map.of("contextWidgetSpec", 2, "contextWidgetUnification", 2);

	private final RestClient restClient;
	private final HubAssertionSigner assertionSigner;
	private final ObjectMapper objectMapper;

	@Override
	public PacingLibrarySaveOutcome setVisibility(HubAssertion assertion, String id, String visibility) {
		String path = LIBRARY_PATH + "/" + id + "/visibility";
		try {
			LibraryEntryResponse response = restClient.put()
					.uri(LIBRARY_PATH + "/{id}/visibility", id)
					.header(HubAssertionSigner.HEADER_NAME, assertionSigner.sign(assertion))
					.contentType(MediaType.APPLICATION_JSON)
					.body(new LibraryVisibilityRequest(visibility, V2_WRITER))
					.retrieve()
					.body(LibraryEntryResponse.class);
			if (response == null || response.entry() == null) {
				throw new PacingExternalException(
						PacingFailureReason.OTHER, "Pacing request failed: PUT " + path + " returned no entry");
			}
			return PacingLibrarySaveOutcome.saved(response.entry());
		} catch (RestClientResponseException ex) {
			JsonNode body = readBody(ex);
			if (ex.getStatusCode().value() == 409 && "v2_writer_required".equals(textField(body, "error"))) {
				return PacingLibrarySaveOutcome.writerRequired();
			}
			throw failure(path, ex.getStatusCode().value(), body);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: PUT " + path, ex);
		}
	}

	/**
	 * Maps a non-2xx answer the way the main client's library calls do: 403 {@code not_yours} is a
	 * real refusal ({@code unknown_user} a sync gap), 400 carries Pacing's own {@code detail}, 429 is a
	 * typed cooldown.
	 *
	 * @param path   the path that was called
	 * @param status the HTTP status
	 * @param body   the parsed error body
	 * @return the mapped exception, ready to throw
	 */
	PacingExternalException failure(String path, int status, JsonNode body) {
		String error = textField(body, "error");
		String where = "Pacing request failed: PUT " + path + " returned HTTP " + status;
		return switch (status) {
			case 400 -> new PacingExternalException(
					PacingFailureReason.UPSTREAM_BAD_REQUEST, where, textField(body, "detail"));
			case 401 -> new PacingExternalException(PacingFailureReason.UPSTREAM_UNAUTHORIZED, where);
			case 403 -> new PacingExternalException(
					error == null || UNKNOWN_USER.equals(error)
							? PacingFailureReason.UPSTREAM_USER_NOT_SYNCED
							: PacingFailureReason.UPSTREAM_FORBIDDEN,
					where + " (" + error + ")");
			case 404 -> new PacingExternalException(PacingFailureReason.UPSTREAM_NOT_FOUND, where);
			case 429 -> new PacingExternalException(PacingFailureReason.UPSTREAM_RATE_LIMITED, where);
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
