package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.PacingSheetSourceClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceRead;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceValues;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceSuggestions;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceUnboundName;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSheetProbe;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/**
 * The sheet-source half of the Pacing API, over HTTP.
 *
 * <p>A fresh {@link HubAssertion} is signed on every call, never cached across requests - the same
 * rule the main client follows.
 */
@Slf4j
@RequiredArgsConstructor
public class PacingSheetSourceClientImpl implements PacingSheetSourceClient {

	private static final String DASHBOARDS_PATH = "/api/dashboards";

	private final RestClient restClient;
	private final HubAssertionSigner assertionSigner;
	private final ObjectMapper objectMapper;

	@Override
	public PacingSheetProbe probeSheet(HubAssertion assertion, String slug, String url) {
		String path = DASHBOARDS_PATH + "/" + slug + "/sheet-probe";
		try {
			PacingSheetProbe response = restClient.post()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, assertionSigner.sign(assertion))
					.contentType(MediaType.APPLICATION_JSON)
					.body(new SheetProbeRequest(url))
					.retrieve()
					.body(PacingSheetProbe.class);
			// A quiet upstream reads as "could not open it", never as a readable file with no tabs:
			// the second would invite someone to save a source that reads nothing.
			return response == null
					? new PacingSheetProbe(false, "", null, null, "empty_response", List.of())
					: response;
		} catch (RestClientResponseException ex) {
			throw failure("POST", path, ex);
		} catch (RestClientException ex) {
			throw unreachable("POST", path, ex);
		}
	}

	@Override
	public PacingDimSourceValues readValues(
			HubAssertion assertion,
			String slug,
			String spreadsheetId,
			int sheetId,
			List<String> columns,
			Integer headerRow) {
		String path = DASHBOARDS_PATH + "/" + slug + "/dim-source-values";
		try {
			PacingDimSourceValues response = restClient.post()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, assertionSigner.sign(assertion))
					.contentType(MediaType.APPLICATION_JSON)
					.body(new DimSourceValuesRequest(spreadsheetId, sheetId, columns, headerRow))
					.retrieve()
					.body(PacingDimSourceValues.class);
			// The columns are echoed back from the REQUEST on an empty answer: a caller lines its
			// labels up against this list, and an empty one would silently unlabel every value.
			return response == null
					? new PacingDimSourceValues(columns, List.of(), false, 0)
					: response;
		} catch (RestClientResponseException ex) {
			throw failure("POST", path, ex);
		} catch (RestClientException ex) {
			throw unreachable("POST", path, ex);
		}
	}

	@Override
	public PacingDimSourceRead readSource(HubAssertion assertion, String slug, String sourceId) {
		String path = DASHBOARDS_PATH + "/" + slug + "/dim-source/" + sourceId + "/read";
		try {
			PacingDimSourceRead response = restClient.post()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, assertionSigner.sign(assertion))
					.contentType(MediaType.APPLICATION_JSON)
					.body(Map.of())
					.retrieve()
					.body(PacingDimSourceRead.class);
			// Nothing read is a real outcome - an empty tab - so it is reported as zeroes rather than
			// as a failure, but never without the source id to show them beside.
			return response == null
					? new PacingDimSourceRead(sourceId, 0, 0, 0, 0L, null)
					: response;
		} catch (RestClientResponseException ex) {
			throw failure("POST", path, ex);
		} catch (RestClientException ex) {
			throw unreachable("POST", path, ex);
		}
	}

	@Override
	public PacingDimSourceSuggestions suggest(
			HubAssertion assertion,
			String slug,
			String sourceId,
			String kind,
			String dim,
			String label,
			List<PacingDimSourceUnboundName> unbound,
			List<String> candidates) {
		String path = DASHBOARDS_PATH + "/" + slug + "/dim-source/" + sourceId + "/suggest";
		try {
			PacingDimSourceSuggestions response = restClient.post()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, assertionSigner.sign(assertion))
					.contentType(MediaType.APPLICATION_JSON)
					.body(new DimSourceSuggestRequest(kind, dim, label, unbound, candidates))
					.retrieve()
					.body(PacingDimSourceSuggestions.class);
			return response == null ? PacingDimSourceSuggestions.noModel() : withLists(response);
		} catch (RestClientResponseException ex) {
			int status = ex.getStatusCode().value();
			// The two answers that are not failures. 503 is Pacing saying no model is configured -
			// it is a statement about this deployment, not about this request, and a red box there
			// would read as "the feature is broken" when the feature has simply never been switched
			// on. 409 is "nothing has been read from this sheet yet", which the person fixes with
			// the Re-read button a few pixels away.
			if (status == 503) {
				return PacingDimSourceSuggestions.noModel();
			}
			if (status == 409) {
				return PacingDimSourceSuggestions.noData();
			}
			throw failure("POST", path, ex);
		} catch (RestClientException ex) {
			throw unreachable("POST", path, ex);
		}
	}

	/**
	 * The same proposal with every list present.
	 *
	 * <p>Only one of the three is ever populated - they answer three different questions - and Pacing
	 * omits the other two entirely. A caller reading the list its own question produced should not
	 * have to null-check the two it did not ask.
	 *
	 * @param raw the proposal as Pacing answered it
	 * @return the same values, with absent lists read as empty
	 */
	PacingDimSourceSuggestions withLists(PacingDimSourceSuggestions raw) {
		return new PacingDimSourceSuggestions(
				true,
				raw.notice(),
				raw.bindings() == null ? List.of() : raw.bindings(),
				raw.members() == null ? List.of() : raw.members(),
				raw.groups() == null ? List.of() : raw.groups(),
				raw.considered());
	}

	/**
	 * Maps a non-2xx answer to the Hub's own failure vocabulary.
	 *
	 * <p>Deliberately NARROWER than the dashboard mapper on the main client, and not a copy of it.
	 * These three calls answer with the four codes below and nothing else - there is no revision
	 * conflict to forward, no retry-after to count down, no precondition to re-read - so reproducing
	 * that mapper's branches here would be inventing handling for answers that cannot arrive, and
	 * two copies of it would be one more place to drift.
	 *
	 * <p>A 400 carries Pacing's own {@code detail} when there is one: for these calls it names the
	 * part of the request that was wrong (the link, the column list, the header row), which is the
	 * difference between a usable message and "bad request".
	 *
	 * @param method the HTTP method that was called
	 * @param path   the path that was called
	 * @param ex     the response exception
	 * @return the mapped exception, ready to throw
	 */
	PacingExternalException failure(String method, String path, RestClientResponseException ex) {
		int status = ex.getStatusCode().value();
		JsonNode body = readBody(ex);
		String error = textField(body, "error");
		String where = "Pacing request failed: " + method + " " + path + " returned HTTP " + status;
		return switch (status) {
			case 400 -> {
				String detail = textField(body, "detail");
				yield new PacingExternalException(
						PacingFailureReason.UPSTREAM_BAD_REQUEST, where, detail != null ? detail : describe(error));
			}
			// The uniform 403 rule: `unknown_user` is a sync gap between the Hub's employees and
			// Pacing's mirror of them, anything else is a real authorization decision.
			case 403 -> new PacingExternalException(
					error == null || "unknown_user".equals(error)
							? PacingFailureReason.UPSTREAM_USER_NOT_SYNCED
							: PacingFailureReason.UPSTREAM_FORBIDDEN,
					where);
			case 404 -> new PacingExternalException(PacingFailureReason.UPSTREAM_NOT_FOUND, where);
			case 429 -> new PacingExternalException(PacingFailureReason.UPSTREAM_RATE_LIMITED, where);
			default -> new PacingExternalException(PacingFailureReason.OTHER, where);
		};
	}

	/**
	 * The failure for a call that never got an answer at all.
	 *
	 * @param method the HTTP method that was called
	 * @param path   the path that was called
	 * @param ex     the transport failure
	 * @return the mapped exception, ready to throw
	 */
	PacingExternalException unreachable(String method, String path, RestClientException ex) {
		return new PacingExternalException(
				PacingFailureReason.UNREACHABLE, "Pacing request failed: " + method + " " + path, ex);
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

	/**
	 * Turns one of Pacing's short machine codes into a sentence fragment a person can act on, for the
	 * 400s that carry no {@code detail}. Falls back to the raw code so a code added on the Pacing side
	 * still surfaces as something rather than as a blank.
	 *
	 * @param errorCode Pacing's short machine error code, or null
	 * @return a human-readable fragment
	 */
	String describe(String errorCode) {
		if (errorCode == null) {
			return "invalid request";
		}
		return switch (errorCode) {
			case "bad_url" -> "that does not look like a Google Sheets link";
			case "bad_columns" -> "between one and three columns must be named";
			case "bad_header_row" -> "the header row must be one of the first fifteen rows";
			case "bad_id" -> "the sheet or source id is not in a usable shape";
			case "no_source" -> "this pacing has no sheet source with that id";
			default -> errorCode;
		};
	}
}
