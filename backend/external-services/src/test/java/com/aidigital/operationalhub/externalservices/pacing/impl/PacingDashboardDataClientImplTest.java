package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDashboardStream;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.http.HttpMethod.GET;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.headerDoesNotExist;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * Tests for {@link PacingDashboardDataClientImpl} against a mocked transport: the browser's headers
 * go up as sent, Pacing's status, headers and bytes come back as sent, and every non-200 answer is
 * mapped and closed.
 */
class PacingDashboardDataClientImplTest {

	private static final String BASE_URL = "http://localhost:3000";
	private static final String SIGNED_HEADER = "payload.signature";
	private static final String DATA_URL = BASE_URL + "/api/dashboards/nike-ss26/data";

	private final HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);

	private MockRestServiceServer server;

	private PacingDashboardDataClientImpl client() {
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		server = MockRestServiceServer.bindTo(builder).build();
		return new PacingDashboardDataClientImpl(builder.build(), signer, new ObjectMapper());
	}

	@Test
	void shouldForwardTheBrowsersHeadersAndHandBackPacingsAnswerUnreadTest() throws IOException {
		// Given: a gzip'd 200 with every cache header; the client must not inflate or parse it.
		PacingDashboardDataClientImpl client = client();
		byte[] body = new byte[] {0x1f, (byte) 0x8b, 8, 0, 1, 2, 3};
		HttpHeaders headers = new HttpHeaders();
		headers.setETag("\"abc123\"");
		headers.set(HttpHeaders.CONTENT_ENCODING, "gzip");
		headers.setCacheControl("private, no-cache");
		headers.setVary(List.of("Accept-Encoding"));
		// The mock transport sets no Content-Length of its own; Pacing always does on the gzip branch.
		headers.setContentLength(body.length);
		server.expect(requestTo(DATA_URL))
				.andExpect(method(GET))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andExpect(header(HttpHeaders.IF_NONE_MATCH, "\"stale\""))
				.andExpect(header(HttpHeaders.ACCEPT_ENCODING, "gzip, deflate, br"))
				.andRespond(withSuccess(body, MediaType.APPLICATION_JSON).headers(headers));

		// When:
		try (PacingDashboardStream stream = client.open(assertion, "nike-ss26", "\"stale\"", "gzip, deflate, br")) {
			// Then: what Pacing said, as it said it.
			assertThat(stream.status()).isEqualTo(200);
			assertThat(stream.notModified()).isFalse();
			assertThat(stream.etag()).isEqualTo("\"abc123\"");
			assertThat(stream.contentEncoding()).isEqualTo("gzip");
			assertThat(stream.contentType()).startsWith("application/json");
			assertThat(stream.contentLength()).isEqualTo((long) body.length);
			assertThat(stream.cacheControl()).isEqualTo("private, no-cache");
			assertThat(stream.vary()).isEqualTo("Accept-Encoding");
			assertThat(stream.body().readAllBytes()).isEqualTo(body);
		}
		server.verify();
	}

	@Test
	void shouldSendNoConditionalOrEncodingHeaderWhenTheBrowserSentNoneTest() throws IOException {
		// Given: an absent header means "plain bytes, full body" to Pacing - so none may be invented.
		PacingDashboardDataClientImpl client = client();
		server.expect(requestTo(DATA_URL))
				.andExpect(headerDoesNotExist(HttpHeaders.IF_NONE_MATCH))
				.andExpect(headerDoesNotExist(HttpHeaders.ACCEPT_ENCODING))
				.andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

		// When / Then:
		try (PacingDashboardStream stream = client.open(assertion, "nike-ss26", null, "")) {
			assertThat(stream.contentEncoding()).isNull();
			assertThat(new String(stream.body().readAllBytes(), StandardCharsets.UTF_8)).isEqualTo("{}");
		}
		server.verify();
	}

	@Test
	void shouldHandBackANotModifiedWithoutABodyTest() {
		// Given:
		PacingDashboardDataClientImpl client = client();
		HttpHeaders headers = new HttpHeaders();
		headers.setETag("\"abc123\"");
		headers.setCacheControl("private, no-cache");
		server.expect(requestTo(DATA_URL))
				.andExpect(header(HttpHeaders.IF_NONE_MATCH, "\"abc123\""))
				.andRespond(withStatus(HttpStatus.NOT_MODIFIED).headers(headers));

		// When:
		PacingDashboardStream stream = client.open(assertion, "nike-ss26", "\"abc123\"", "gzip");

		// Then:
		assertThat(stream.notModified()).isTrue();
		assertThat(stream.etag()).isEqualTo("\"abc123\"");
		assertThat(stream.cacheControl()).isEqualTo("private, no-cache");
		assertThat(stream.body()).isNull();
		server.verify();
	}

	@Test
	void shouldMapNotFoundTest() {
		PacingDashboardDataClientImpl client = client();
		server.expect(requestTo(DATA_URL)).andRespond(withStatus(HttpStatus.NOT_FOUND));

		assertThatThrownBy(() -> client.open(assertion, "nike-ss26", null, null))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_NOT_FOUND);
	}

	@Test
	void shouldMapUnknownUserToASyncGapAndAnyOtherForbiddenToARefusalTest() {
		// unknown_user: the §2 sync has not reached this person - a 409 upstream, not a refusal.
		PacingDashboardDataClientImpl client = client();
		server.expect(requestTo(DATA_URL)).andRespond(withStatus(HttpStatus.FORBIDDEN)
				.body("{\"error\":\"unknown_user\"}").contentType(MediaType.APPLICATION_JSON));
		assertThatThrownBy(() -> client.open(assertion, "nike-ss26", null, null))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_USER_NOT_SYNCED);

		// no_access: a real authorization decision about this dashboard.
		PacingDashboardDataClientImpl refused = client();
		server.expect(requestTo(DATA_URL)).andRespond(withStatus(HttpStatus.FORBIDDEN)
				.body("{\"error\":\"no_access\"}").contentType(MediaType.APPLICATION_JSON));
		assertThatThrownBy(() -> refused.open(assertion, "nike-ss26", null, null))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_FORBIDDEN);
	}

	@Test
	void shouldMapUnauthorizedAndBadRequestTest() {
		PacingDashboardDataClientImpl client = client();
		server.expect(requestTo(DATA_URL)).andRespond(withStatus(HttpStatus.UNAUTHORIZED));
		assertThatThrownBy(() -> client.open(assertion, "nike-ss26", null, null))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_UNAUTHORIZED);

		PacingDashboardDataClientImpl badRequest = client();
		server.expect(requestTo(BASE_URL + "/api/dashboards/x/data")).andRespond(withStatus(HttpStatus.BAD_REQUEST)
				.body("{\"error\":\"bad_id\"}").contentType(MediaType.APPLICATION_JSON));
		assertThatThrownBy(() -> badRequest.open(assertion, "x", null, null))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_BAD_REQUEST);
	}

	@Test
	void shouldClassifyAConnectionFailureAsUnreachableTest() {
		PacingDashboardDataClientImpl client = client();
		server.expect(requestTo(DATA_URL)).andRespond(request -> {
			throw new SocketTimeoutException("Read timed out");
		});

		assertThatThrownBy(() -> client.open(assertion, "nike-ss26", null, null))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	@Test
	void shouldStreamAFiftyMegabyteBodyThroughTest() throws IOException {
		// Given: a body the size of a real conversions-heavy pacing. Nothing here parses it, so the
		// only memory it costs this client is the read buffer.
		PacingDashboardDataClientImpl client = client();
		byte[] big = new byte[50 * 1024 * 1024];
		Arrays.fill(big, (byte) 'x');
		server.expect(requestTo(DATA_URL)).andRespond(withSuccess(big, MediaType.APPLICATION_JSON));

		// When:
		long total = 0;
		try (PacingDashboardStream stream = client.open(assertion, "nike-ss26", null, "gzip")) {
			byte[] buffer = new byte[8192];
			int n;
			while ((n = stream.body().read(buffer)) >= 0) {
				total += n;
			}
		}

		// Then:
		assertThat(total).isEqualTo(big.length);
		server.verify();
	}
}
