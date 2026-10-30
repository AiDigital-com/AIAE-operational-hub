package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.PacingDashboardDataClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDashboardStream;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Streams Pacing's dashboard body through unread - see {@link PacingDashboardDataClient}.
 *
 * <p>Uses {@code RestClient.exchange(..., close = false)} rather than {@code retrieve()}: retrieve
 * reads the whole body into memory to convert it, which is the copy this client exists to avoid.
 * With {@code close = false} the response stays open after the exchange function returns and the
 * body stream below releases it when the caller is done. Every non-200 path closes it here.
 */
@Slf4j
@RequiredArgsConstructor
public class PacingDashboardDataClientImpl implements PacingDashboardDataClient {

	private static final String DASHBOARDS_PATH = "/api/dashboards";
	private static final String UNKNOWN_USER = "unknown_user";

	private final RestClient restClient;
	private final HubAssertionSigner assertionSigner;
	private final ObjectMapper objectMapper;

	@Override
	public PacingDashboardStream open(HubAssertion assertion, String slug, String ifNoneMatch, String acceptEncoding) {
		String path = DASHBOARDS_PATH + "/" + slug + "/data";
		try {
			RestClient.RequestHeadersSpec<?> request = restClient.get()
					.uri(DASHBOARDS_PATH + "/{slug}/data", slug)
					.header(HubAssertionSigner.HEADER_NAME, assertionSigner.sign(assertion));
			// Forwarded as the browser sent them, or not at all: an absent Accept-Encoding is what
			// makes Pacing answer plain bytes, and an absent If-None-Match is what makes it answer 200.
			if (ifNoneMatch != null && !ifNoneMatch.isBlank()) {
				request = request.header(HttpHeaders.IF_NONE_MATCH, ifNoneMatch);
			}
			if (acceptEncoding != null && !acceptEncoding.isBlank()) {
				request = request.header(HttpHeaders.ACCEPT_ENCODING, acceptEncoding);
			}
			return request.exchange((req, response) -> open(path, response), false);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: GET " + path, ex);
		}
	}

	/**
	 * Turns the open upstream response into what the controller copies through, or into the mapped
	 * failure. Only a 200 leaves the response open.
	 *
	 * @param path     the path that was called, for the failure message
	 * @param response the upstream response, still open
	 * @return the stream (200) or the 304 marker
	 * @throws IOException if the upstream body cannot be read on a failure path
	 */
	PacingDashboardStream open(String path, ClientHttpResponse response) throws IOException {
		int status = response.getStatusCode().value();
		HttpHeaders headers = response.getHeaders();
		String etag = headers.getETag();
		String cacheControl = headers.getCacheControl();
		String vary = headers.getVary().isEmpty() ? null : String.join(", ", headers.getVary());
		if (status == 304) {
			response.close();
			return new PacingDashboardStream(304, etag, null, null, null, cacheControl, vary, null);
		}
		if (status == 200) {
			MediaType contentType = headers.getContentType();
			long contentLength = headers.getContentLength();
			return new PacingDashboardStream(
					200,
					etag,
					contentType == null ? null : contentType.toString(),
					headers.getFirst(HttpHeaders.CONTENT_ENCODING),
					contentLength < 0 ? null : contentLength,
					cacheControl,
					vary,
					new ReleasingInputStream(response.getBody(), response));
		}
		try (response) {
			throw failure(path, status, readBody(response.getBody().readAllBytes()));
		}
	}

	/**
	 * Maps a non-2xx answer the way {@code PacingClientImpl#dashboardFailure} did for this call: 400
	 * carries Pacing's own {@code detail}, a 403 other than {@code unknown_user} is a real refusal,
	 * {@code unknown_user} is a sync gap, 404 is not found, anything else is {@code OTHER}.
	 *
	 * @param path   the path that was called
	 * @param status the HTTP status
	 * @param body   the parsed error body
	 * @return the mapped exception, ready to throw
	 */
	PacingExternalException failure(String path, int status, JsonNode body) {
		String error = textField(body, "error");
		String where = "Pacing request failed: GET " + path + " returned HTTP " + status;
		if (status == 400) {
			String detail = textField(body, "detail");
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_BAD_REQUEST, where, detail != null ? detail : "invalid request");
		}
		if (status == 403 && error != null && !UNKNOWN_USER.equals(error)) {
			return new PacingExternalException(PacingFailureReason.UPSTREAM_FORBIDDEN, where + " (" + error + ")");
		}
		PacingFailureReason reason = switch (status) {
			case 401 -> PacingFailureReason.UPSTREAM_UNAUTHORIZED;
			case 403 -> PacingFailureReason.UPSTREAM_USER_NOT_SYNCED;
			case 404 -> PacingFailureReason.UPSTREAM_NOT_FOUND;
			default -> PacingFailureReason.OTHER;
		};
		return new PacingExternalException(reason, where);
	}

	/**
	 * Parses a non-2xx body as JSON, degrading to an empty object rather than throwing a second
	 * exception that would hide the first.
	 *
	 * @param bytes the body bytes
	 * @return the parsed body, or an empty object node
	 */
	JsonNode readBody(byte[] bytes) {
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
	 * The upstream body, whose {@code close()} also releases the upstream response - so whoever drains
	 * the stream (Spring's resource converter, after copying it to the browser) is who returns the
	 * connection, and nothing is left open when they are done.
	 */
	static final class ReleasingInputStream extends FilterInputStream {

		private final ClientHttpResponse response;

		ReleasingInputStream(InputStream body, ClientHttpResponse response) {
			super(body);
			this.response = response;
		}

		@Override
		public void close() throws IOException {
			try {
				super.close();
			} finally {
				response.close();
			}
		}
	}
}
