package com.aidigital.operationalhub.externalservices.pacing.impl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.http.HttpMethod.PUT;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibrarySaveOutcome;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.SocketTimeoutException;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * {@link PacingLibraryVisibilityClientImpl} against a mocked Pacing service: the wire body with its
 * writer marker, the signed header, and how each refusal maps.
 */
class PacingLibraryVisibilityClientImplTest {

	private static final String BASE_URL = "http://localhost:3000";
	private static final String SIGNED_HEADER = "payload.signature";
	private static final String URL = BASE_URL + "/api/library/e1/visibility";

	private final HubAssertion assertion =
			new HubAssertion("me@aidigital.com", HubAssertion.KIND_OWNERS, List.of(), true);

	private RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);

	private MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();

	PacingLibraryVisibilityClientImpl client() {
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		return new PacingLibraryVisibilityClientImpl(builder.build(), signer, new ObjectMapper());
	}

	@Test
	void shouldSendVisibilityWithWriterMarkerTest() {
		// Given: dash-gate answers the whole entry
		PacingLibraryVisibilityClientImpl client = client();
		server.expect(requestTo(URL))
				.andExpect(method(PUT))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andExpect(content().json("{\"visibility\":\"private\","
						+ "\"writer\":{\"contextWidgetSpec\":2,\"contextWidgetUnification\":2}}"))
				.andRespond(withSuccess(
						"{\"ok\":true,\"entry\":{\"id\":\"e1\",\"kind\":\"layout\",\"name\":\"Board\","
								+ "\"owner_name\":\"Azat\",\"updated_at\":\"t1\",\"visibility\":\"private\","
								+ "\"likes\":0,\"liked\":false,\"mine\":true,\"usage\":2}}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingLibrarySaveOutcome result = client.setVisibility(assertion, "e1", "private");

		// Then:
		assertThat(result.ok()).isTrue();
		assertThat(result.entry().visibility()).isEqualTo("private");
		assertThat(result.entry().updatedAt()).isEqualTo("t1");
		server.verify();
	}

	@Test
	void shouldReturnWriterConflictTest() {
		// Given:
		PacingLibraryVisibilityClientImpl client = client();
		server.expect(requestTo(URL))
				.andRespond(withStatus(HttpStatus.CONFLICT)
						.body("{\"ok\":false,\"error\":\"v2_writer_required\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When:
		PacingLibrarySaveOutcome result = client.setVisibility(assertion, "e1", "team");

		// Then:
		assertThat(result.ok()).isFalse();
		assertThat(result.conflictReason()).isEqualTo("v2_writer_required");
	}

	@Test
	void shouldMapSomeoneElsesEntryToForbiddenTest() {
		// Given:
		PacingLibraryVisibilityClientImpl client = client();
		server.expect(requestTo(URL))
				.andRespond(withStatus(HttpStatus.FORBIDDEN)
						.body("{\"ok\":false,\"error\":\"not_yours\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.setVisibility(assertion, "e1", "private"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_FORBIDDEN);
	}

	@Test
	void shouldMapMissingEntryToNotFoundTest() {
		// Given:
		PacingLibraryVisibilityClientImpl client = client();
		server.expect(requestTo(URL))
				.andRespond(withStatus(HttpStatus.NOT_FOUND)
						.body("{\"ok\":false,\"error\":\"not_found\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.setVisibility(assertion, "e1", "private"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_NOT_FOUND);
	}

	@Test
	void shouldMapTooFastToRateLimitedTest() {
		// Given:
		PacingLibraryVisibilityClientImpl client = client();
		server.expect(requestTo(URL))
				.andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS)
						.body("{\"ok\":false,\"error\":\"too_fast\",\"retry_after\":60}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.setVisibility(assertion, "e1", "private"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_RATE_LIMITED);
	}
	@Test
	void shouldCarryPacingsDetailOnBadRequestTest() {
		// Given:
		PacingLibraryVisibilityClientImpl client = client();
		server.expect(requestTo(URL))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"ok\":false,\"error\":\"bad_library\","
								+ "\"detail\":\"library entry: visibility must be private or team\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.setVisibility(assertion, "e1", "everyone"))
				.isInstanceOf(PacingExternalException.class)
				.satisfies(ex -> {
					PacingExternalException pex = (PacingExternalException) ex;
					assertThat(pex.getReason()).isEqualTo(PacingFailureReason.UPSTREAM_BAD_REQUEST);
					assertThat(pex.getDetail()).contains("private or team");
				});
	}

	@Test
	void shouldMapUnknownUserAndUnreadableBodiesTest() {
		// Given: a sync gap with a non-JSON body, then a 401 with no body, then a 500
		PacingLibraryVisibilityClientImpl client = client();
		server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.FORBIDDEN).body("not json"));
		server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.UNAUTHORIZED));
		server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR)
				.body("{\"error\":null}").contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.setVisibility(assertion, "e1", "private"))
				.extracting("reason").isEqualTo(PacingFailureReason.UPSTREAM_USER_NOT_SYNCED);
		assertThatThrownBy(() -> client.setVisibility(assertion, "e1", "private"))
				.extracting("reason").isEqualTo(PacingFailureReason.UPSTREAM_UNAUTHORIZED);
		assertThatThrownBy(() -> client.setVisibility(assertion, "e1", "private"))
				.extracting("reason").isEqualTo(PacingFailureReason.OTHER);
	}

	@Test
	void shouldRefuseAnAnswerWithoutEntryTest() {
		// Given:
		PacingLibraryVisibilityClientImpl client = client();
		server.expect(requestTo(URL)).andRespond(withSuccess("{\"ok\":true}", MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.setVisibility(assertion, "e1", "private"))
				.extracting("reason").isEqualTo(PacingFailureReason.OTHER);
	}

	@Test
	void shouldReportAnUnreachablePacingTest() {
		// Given: Pacing never answers at all
		PacingLibraryVisibilityClientImpl client = client();
		server.expect(requestTo(URL)).andRespond(request -> {
			throw new SocketTimeoutException("Read timed out");
		});

		// When-Then:
		assertThatThrownBy(() -> client.setVisibility(assertion, "e1", "private"))
				.extracting("reason").isEqualTo(PacingFailureReason.UNREACHABLE);
	}
}
