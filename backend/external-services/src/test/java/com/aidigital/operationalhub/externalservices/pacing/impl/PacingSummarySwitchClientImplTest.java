package com.aidigital.operationalhub.externalservices.pacing.impl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.http.HttpMethod.GET;
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
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSlackSummarySwitch;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.SocketTimeoutException;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * {@link PacingSummarySwitchClientImpl} against a mocked Pacing service: both calls, the signed
 * assertion header, and that an answer without a state is refused rather than guessed.
 */
class PacingSummarySwitchClientImplTest {

	private static final String BASE_URL = "http://localhost:3000";
	private static final String SIGNED_HEADER = "payload.signature";
	private static final String URL = BASE_URL + "/api/admin/slack-summaries";

	private final HubAssertion assertion =
			new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), true);

	private RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);

	private MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();

	PacingSummarySwitchClientImpl client() {
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		return new PacingSummarySwitchClientImpl(builder.build(), signer, new ObjectMapper());
	}

	@Test
	void shouldReadTheSwitchTest() {
		// Given: dash-gate's snake_case switch row
		PacingSummarySwitchClientImpl client = client();
		server.expect(requestTo(URL))
				.andExpect(method(GET))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andRespond(withSuccess(
						"{\"enabled\":false,\"updated_at\":\"2026-10-23T10:00:00.000Z\","
								+ "\"updated_by\":\"admin@aidigital.com\"}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingSlackSummarySwitch result = client.getSwitch(assertion);

		// Then:
		assertThat(result).isEqualTo(
				new PacingSlackSummarySwitch(false, "2026-10-23T10:00:00.000Z", "admin@aidigital.com"));
		server.verify();
	}

	@Test
	void shouldSendTheNewStateTest() {
		// Given: switching summaries back on
		PacingSummarySwitchClientImpl client = client();
		server.expect(requestTo(URL))
				.andExpect(method(PUT))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andExpect(content().json("{\"enabled\":true}", true))
				.andRespond(withSuccess(
						"{\"enabled\":true,\"updated_at\":\"2026-10-23T11:00:00.000Z\","
								+ "\"updated_by\":\"me@aidigital.com\"}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingSlackSummarySwitch result = client.updateSwitch(assertion, true);

		// Then:
		assertThat(result.enabled()).isTrue();
		assertThat(result.updatedBy()).isEqualTo("me@aidigital.com");
		server.verify();
	}

	@Test
	void shouldRefuseAnAnswerWithoutAStateTest() {
		// Given: a 200 that does not say on or off - the screen must not guess either way
		PacingSummarySwitchClientImpl client = client();
		server.expect(requestTo(URL))
				.andRespond(withSuccess("{\"updated_at\":null}", MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.getSwitch(assertion))
				.isInstanceOf(PacingExternalException.class);
	}

	@Test
	void shouldMapAdminOnlyToForbiddenTest() {
		// Given: Pacing's own admin gate
		PacingSummarySwitchClientImpl client = client();
		server.expect(requestTo(URL))
				.andRespond(withStatus(HttpStatus.FORBIDDEN)
						.body("{\"error\":\"admin_only\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.updateSwitch(assertion, false))
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason")
				.isEqualTo(PacingFailureReason.UPSTREAM_FORBIDDEN);
	}

	@Test
	void shouldCarryPacingsDetailOnABadRequestTest() {
		// Given: dash-gate refuses a body without a real boolean
		PacingSummarySwitchClientImpl client = client();
		server.expect(requestTo(URL))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"error\":\"invalid_enabled\",\"detail\":\"enabled must be true or false\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.updateSwitch(assertion, false))
				.isInstanceOf(PacingExternalException.class)
				.satisfies(ex -> {
					PacingExternalException pex = (PacingExternalException) ex;
					assertThat(pex.getReason()).isEqualTo(PacingFailureReason.UPSTREAM_BAD_REQUEST);
					assertThat(pex.getDetail()).isEqualTo("enabled must be true or false");
				});
	}

	@Test
	void shouldMapAnUnauthorizedAnswerTest() {
		// Given: the assertion did not verify on the Pacing side
		PacingSummarySwitchClientImpl client = client();
		server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.UNAUTHORIZED));

		// When-Then:
		assertThatThrownBy(() -> client.getSwitch(assertion))
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason")
				.isEqualTo(PacingFailureReason.UPSTREAM_UNAUTHORIZED);
	}

	@Test
	void shouldMapAnUnknownUserToNotSyncedTest() {
		// Given: the admin exists in the Hub but not yet in Pacing's mirror of its people
		PacingSummarySwitchClientImpl client = client();
		server.expect(requestTo(URL))
				.andRespond(withStatus(HttpStatus.FORBIDDEN)
						.body("{\"error\":\"unknown_user\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.getSwitch(assertion))
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason")
				.isEqualTo(PacingFailureReason.UPSTREAM_USER_NOT_SYNCED);
	}

	@Test
	void shouldMapAServerErrorWhoseBodyIsNotJsonTest() {
		// Given: a proxy's HTML error page - the body must not throw a second error over the first
		PacingSummarySwitchClientImpl client = client();
		server.expect(requestTo(URL))
				.andRespond(withStatus(HttpStatus.BAD_GATEWAY).body("<html>bad gateway</html>"));

		// When-Then:
		assertThatThrownBy(() -> client.getSwitch(assertion))
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason")
				.isEqualTo(PacingFailureReason.OTHER);
	}

	@Test
	void shouldMapAServerErrorWithAnEmptyBodyTest() {
		// Given:
		PacingSummarySwitchClientImpl client = client();
		server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR));

		// When-Then:
		assertThatThrownBy(() -> client.updateSwitch(assertion, true))
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason")
				.isEqualTo(PacingFailureReason.OTHER);
	}

	@Test
	void shouldReportAnUnreachableReadTest() {
		// Given: Pacing never answers at all
		PacingSummarySwitchClientImpl client = client();
		server.expect(requestTo(URL)).andRespond(request -> {
			throw new SocketTimeoutException("Read timed out");
		});

		// When-Then:
		assertThatThrownBy(() -> client.getSwitch(assertion))
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason")
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	@Test
	void shouldReportAnUnreachableSaveTest() {
		// Given: Pacing never answers at all
		PacingSummarySwitchClientImpl client = client();
		server.expect(requestTo(URL)).andRespond(request -> {
			throw new SocketTimeoutException("Read timed out");
		});

		// When-Then:
		assertThatThrownBy(() -> client.updateSwitch(assertion, false))
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason")
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}
}
