package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserMirrorEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncResult;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.net.SocketTimeoutException;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.http.HttpMethod.GET;
import static org.springframework.http.HttpMethod.POST;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * Tests for {@link PacingClientImpl} against a mocked HTTP transport ({@link MockRestServiceServer}),
 * asserting the signed assertion is attached as {@code X-Hub-Assertion} and non-2xx responses are
 * translated to {@link PacingExternalException}.
 */
class PacingClientImplTest {

	private static final String BASE_URL = "http://localhost:3000";
	private static final String SIGNED_HEADER = "payload.signature";

	@Test
	void shouldReturnPacingsAndAttachSignedAssertionHeaderTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer);
		server.expect(requestTo(BASE_URL + "/api/pacings"))
				.andExpect(method(GET))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andRespond(withSuccess(
						"{\"pacings\":[{\"pacing_id\":\"nike-ss26\",\"status\":\"Live\"}]}",
						MediaType.APPLICATION_JSON));

		// When:
		List<Map<String, Object>> result = client.listPacings(assertion);

		// Then:
		assertThat(result).hasSize(1);
		assertThat(result.get(0)).containsEntry("pacing_id", "nike-ss26").containsEntry("status", "Live");
		server.verify();
	}

	@Test
	void shouldReturnEmptyListWhenPacingsFieldIsMissingTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_OWNERS, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer);
		server.expect(requestTo(BASE_URL + "/api/pacings"))
				.andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

		// When:
		List<Map<String, Object>> result = client.listPacings(assertion);

		// Then:
		assertThat(result).isEmpty();
	}

	@Test
	void shouldWrapNon2xxResponseInPacingExternalExceptionTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer);
		server.expect(requestTo(BASE_URL + "/api/pacings")).andRespond(withServerError());

		// When-Then:
		assertThatThrownBy(() -> client.listPacings(assertion))
				.isInstanceOf(PacingExternalException.class)
				.hasMessageContaining("500")
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.OTHER);
	}

	/**
	 * Empirically pins how each of Pacing's real non-2xx responses is classified, one row per case in
	 * the Hub->Pacing failure-mapping table:
	 *
	 * <ul>
	 *     <li>401 (shared-secret mismatch) -&gt; {@link PacingFailureReason#UPSTREAM_UNAUTHORIZED},
	 *     mapped by {@code GlobalExceptionHandler} to 500, deliberately not 401 - see that class for why
	 *     (a 401 from the Hub logs the caller out).</li>
	 *     <li>403 ({@code unknown_user}) -&gt; {@link PacingFailureReason#UPSTREAM_USER_NOT_SYNCED},
	 *     mapped to 409, not 403.</li>
	 *     <li>404 -&gt; {@link PacingFailureReason#UPSTREAM_NOT_FOUND}, mapped to 404.</li>
	 *     <li>an unrecognized non-2xx (422 here) -&gt; {@link PacingFailureReason#OTHER}, mapped to 500.</li>
	 * </ul>
	 *
	 * @param pacingStatus   the HTTP status Pacing answered with
	 * @param expectedReason the {@link PacingFailureReason} that status must classify to
	 */
	@ParameterizedTest
	@CsvSource({
			"401, UPSTREAM_UNAUTHORIZED",
			"403, UPSTREAM_USER_NOT_SYNCED",
			"404, UPSTREAM_NOT_FOUND",
			"422, OTHER"
	})
	void shouldClassifyEachPacingNon2xxStatusTest(int pacingStatus, PacingFailureReason expectedReason) {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer);
		server.expect(requestTo(BASE_URL + "/api/pacings"))
				.andRespond(withStatus(HttpStatus.valueOf(pacingStatus)));

		// When-Then:
		assertThatThrownBy(() -> client.listPacings(assertion))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(expectedReason);
		server.verify();
	}

	@Test
	void shouldClassifyAConnectionFailureAsUnreachableRatherThanAnUpstreamStatusTest() {
		// Given: Pacing never answers at all - the same shape a connect/read timeout takes, as opposed
		// to the tests above where Pacing does answer, just not with 2xx.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer);
		server.expect(requestTo(BASE_URL + "/api/pacings"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.listPacings(assertion))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	@Test
	void shouldSyncUsersSigningASystemAssertionRatherThanAUserOneTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		when(signer.signSystem()).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer);
		List<PacingUserSyncEntry> users = List.of(new PacingUserSyncEntry("a@x.com", "A", true, null));
		server.expect(requestTo(BASE_URL + "/api/internal/users/sync"))
				.andExpect(method(POST))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andRespond(withSuccess(
						"{\"users\":{\"a@x.com\":\"11111111-1111-1111-1111-111111111111\"},"
								+ "\"stats\":{\"created\":1,\"activated\":0,\"deactivated\":0,\"unchanged\":0}}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingUserSyncResult result = client.syncUsers(users);

		// Then: the sign() (user-assertion) path was never touched for this call
		assertThat(result.users()).containsEntry("a@x.com", "11111111-1111-1111-1111-111111111111");
		assertThat(result.stats().created()).isEqualTo(1);
		server.verify();
	}

	@Test
	void shouldRetryOnceWhenUnreachableThenSucceedTest() {
		// Given: Pacing is unreachable on the first attempt, then answers on the retry - proving the
		// batch (idempotent by email) is safely resent rather than given up on after one timeout.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		when(signer.signSystem()).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer);
		List<PacingUserSyncEntry> users = List.of(new PacingUserSyncEntry("a@x.com", "A", true, null));
		server.expect(requestTo(BASE_URL + "/api/internal/users/sync"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});
		server.expect(requestTo(BASE_URL + "/api/internal/users/sync"))
				.andRespond(withSuccess(
						"{\"users\":{\"a@x.com\":\"11111111-1111-1111-1111-111111111111\"},"
								+ "\"stats\":{\"created\":1,\"activated\":0,\"deactivated\":0,\"unchanged\":0}}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingUserSyncResult result = client.syncUsers(users);

		// Then:
		assertThat(result.users()).containsEntry("a@x.com", "11111111-1111-1111-1111-111111111111");
		server.verify();
		verify(signer, times(1)).signSystem();
	}

	@Test
	void shouldNotRetryOnANon2xxResponseFromSyncUsersTest() {
		// Given: Pacing DID answer, just with a non-2xx - retrying the identical request would only get
		// the identical answer, so this must fail on the first attempt without a second call.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		when(signer.signSystem()).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer);
		List<PacingUserSyncEntry> users = List.of(new PacingUserSyncEntry("a@x.com", "A", true, null));
		server.expect(requestTo(BASE_URL + "/api/internal/users/sync")).andRespond(withStatus(HttpStatus.BAD_REQUEST));

		// When-Then:
		assertThatThrownBy(() -> client.syncUsers(users))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.OTHER);
		server.verify();
	}

	@Test
	void shouldClassifySyncUsers401AsUpstreamUnauthorizedTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		when(signer.signSystem()).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer);
		List<PacingUserSyncEntry> users = List.of(new PacingUserSyncEntry("a@x.com", "A", true, null));
		server.expect(requestTo(BASE_URL + "/api/internal/users/sync")).andRespond(withStatus(HttpStatus.UNAUTHORIZED));

		// When-Then:
		assertThatThrownBy(() -> client.syncUsers(users))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_UNAUTHORIZED);
	}

	@Test
	void shouldFailAfterTwoConsecutiveUnreachableAttemptsForSyncUsersTest() {
		// Given: unreachable on both the original attempt and the single retry - a genuinely down
		// Pacing must still fail, not retry forever.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		when(signer.signSystem()).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer);
		List<PacingUserSyncEntry> users = List.of(new PacingUserSyncEntry("a@x.com", "A", true, null));
		server.expect(requestTo(BASE_URL + "/api/internal/users/sync"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});
		server.expect(requestTo(BASE_URL + "/api/internal/users/sync"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.syncUsers(users))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
		server.verify();
	}

	@Test
	void shouldListUsersSigningASystemAssertionAndReturnEveryRowTest() {
		// Given: US-106 drift report reads the whole mirror via a SYSTEM assertion, same as syncUsers.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		when(signer.signSystem()).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer);
		server.expect(requestTo(BASE_URL + "/api/internal/users"))
				.andExpect(method(GET))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andRespond(withSuccess(
						"{\"users\":[{\"email\":\"alice@aidigital.com\",\"name\":\"Alice\",\"active\":true}]}",
						MediaType.APPLICATION_JSON));

		// When:
		List<PacingUserMirrorEntry> result = client.listUsers();

		// Then:
		assertThat(result).containsExactly(new PacingUserMirrorEntry("alice@aidigital.com", "Alice", true));
		server.verify();
	}

	@Test
	void shouldReturnEmptyListWhenListUsersFieldIsMissingTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		when(signer.signSystem()).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer);
		server.expect(requestTo(BASE_URL + "/api/internal/users"))
				.andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

		// When:
		List<PacingUserMirrorEntry> result = client.listUsers();

		// Then:
		assertThat(result).isEmpty();
	}

	@Test
	void shouldClassifyListUsers401AsUpstreamUnauthorizedTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		when(signer.signSystem()).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer);
		server.expect(requestTo(BASE_URL + "/api/internal/users")).andRespond(withStatus(HttpStatus.UNAUTHORIZED));

		// When-Then:
		assertThatThrownBy(client::listUsers)
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_UNAUTHORIZED);
	}

	@Test
	void shouldClassifyListUsersConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		when(signer.signSystem()).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer);
		server.expect(requestTo(BASE_URL + "/api/internal/users"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(client::listUsers)
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}
}
