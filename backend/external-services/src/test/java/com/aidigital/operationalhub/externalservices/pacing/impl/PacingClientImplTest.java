package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAddableLineItems;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateLineItem;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLineItemPlanUpdate;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDashboardData;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDisplaySaveOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibraryEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibrarySaveOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLikeResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffReport;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshStatus;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRevalidateResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRow;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserMirrorEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingValidateResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import org.springframework.mock.http.client.MockClientHttpRequest;

import java.net.SocketTimeoutException;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.http.HttpMethod.DELETE;
import static org.springframework.http.HttpMethod.GET;
import static org.springframework.http.HttpMethod.POST;
import static org.springframework.http.HttpMethod.PUT;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
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
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings"))
				.andExpect(method(GET))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andRespond(withSuccess(
						"{\"pacings\":[{\"pacing_id\":\"nike-ss26\",\"status\":\"Live\"}]}",
						MediaType.APPLICATION_JSON));

		// When:
		List<PacingRow> result = client.listPacings(assertion);

		// Then:
		assertThat(result).hasSize(1);
		assertThat(result.get(0).pacingId()).isEqualTo("nike-ss26");
		assertThat(result.get(0).status()).isEqualTo("Live");
		server.verify();
	}

	@Test
	void shouldReturnPacingsForCampaignWithCampaignIdQueryParamTest() {
		// Given: §5 - the same GET /api/pacings path as listPacings, narrowed by campaign_id
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings?campaign_id=40539"))
				.andExpect(method(GET))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andRespond(withSuccess(
						"{\"pacings\":[{\"pacing_id\":\"p1\",\"status\":\"Live\"}]}",
						MediaType.APPLICATION_JSON));

		// When:
		List<PacingRow> result = client.listPacingsForCampaign(assertion, "40539");

		// Then:
		assertThat(result).hasSize(1);
		assertThat(result.get(0).pacingId()).isEqualTo("p1");
		server.verify();
	}

	@Test
	void shouldMapNotFoundToPacingExternalExceptionForCampaignFilterTest() {
		// Given: the shared failure mapping (fetchPacings) also applies on this path
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings?campaign_id=40539"))
				.andRespond(withStatus(HttpStatus.NOT_FOUND));

		// When/Then:
		assertThatThrownBy(() -> client.listPacingsForCampaign(assertion, "40539"))
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason").isEqualTo(PacingFailureReason.UPSTREAM_NOT_FOUND);
	}

	@Test
	void shouldDeserializeCampaignsAndHealthWithAlertsTest() {
		// Given: a row shaped like Pacing's real GET /api/pacings response (§4 of the migration plan) -
		// snake_case top-level/health fields, already-camelCase campaigns/alerts, plus fields PacingRow
		// deliberately does not read (owner_id, client, agency) that must not break deserialization.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings"))
				.andRespond(withSuccess(
						"""
						{"pacings":[{
							"pacing_id":"p1","pacing_name":"Nike SS26 Display","status":"Live",
							"flight_start":"2026-08-01","flight_end":"2026-09-30",
							"owner_id":"ignored-uuid","owner_name":"Azat Nabiev",
							"line_item_count":3,"client":"Nike","agency":"Demo Agency",
							"campaigns":[{"id":"CAMP-NIKE","name":"Nike SS26"},{"id":"CAMP-OTHER","name":"Other"}],
							"health":{"status":"over","pacing_pp":12.3,"spend_pct":40.0,
								"margin_actual":18.5,"margin_target":25.0,"budget_total":50000.0,
								"days_remaining":10,
								"alerts":[{"type":"pacing_off_pace","severity":"critical","scope":"line_item","li_id":"100","text":"Pacing +48.4pp"}]}
						}]}
						""",
						MediaType.APPLICATION_JSON));

		// When:
		List<PacingRow> result = client.listPacings(assertion);

		// Then:
		assertThat(result).hasSize(1);
		PacingRow row = result.get(0);
		assertThat(row.pacingId()).isEqualTo("p1");
		assertThat(row.pacingName()).isEqualTo("Nike SS26 Display");
		assertThat(row.flightStart()).isEqualTo("2026-08-01");
		assertThat(row.ownerName()).isEqualTo("Azat Nabiev");
		assertThat(row.lineItemCount()).isEqualTo(3);
		assertThat(row.campaigns()).extracting("id", "name")
				.containsExactly(org.assertj.core.groups.Tuple.tuple("CAMP-NIKE", "Nike SS26"),
						org.assertj.core.groups.Tuple.tuple("CAMP-OTHER", "Other"));
		assertThat(row.health().status()).isEqualTo("over");
		assertThat(row.health().pacingPp()).isEqualTo(12.3);
		assertThat(row.health().marginActual()).isEqualTo(18.5);
		assertThat(row.health().marginTarget()).isEqualTo(25.0);
		assertThat(row.health().budgetTotal()).isEqualTo(50000.0);
		assertThat(row.health().alerts()).hasSize(1);
		assertThat(row.health().alerts().get(0).type()).isEqualTo("pacing_off_pace");
		assertThat(row.health().alerts().get(0).severity()).isEqualTo("critical");
		assertThat(row.health().alerts().get(0).text()).isEqualTo("Pacing +48.4pp");
	}

	@Test
	void shouldReturnEmptyListWhenPacingsFieldIsMissingTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_OWNERS, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings"))
				.andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

		// When:
		List<PacingRow> result = client.listPacings(assertion);

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
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
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
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
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
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
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
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
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
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
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
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
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
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
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
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
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
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
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
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
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
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
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
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
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

	// ── §6: dashboard data / refresh-status / refresh / display save ──

	@Test
	void shouldReturnDashboardDataTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/nike-ss26/data"))
				.andExpect(method(GET))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andRespond(withSuccess(
						"{\"campaign\":{\"id\":\"nike-ss26\",\"pacingId\":\"p1\",\"name\":\"Nike SS26\"},"
								+ "\"planByLineItem\":{\"111\":{\"lineItemId\":\"111\",\"plannedImpressions\":1000}},"
								+ "\"factsDaily\":[{\"date\":\"2026-08-01\"}],\"display\":{\"widgets\":[]},"
								+ "\"journal\":[],\"types\":[{\"ignored\":true}]}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingDashboardData result = client.getDashboardData(assertion, "nike-ss26");

		// Then: extra fields Pacing sends (e.g. "types") are ignored, not a deserialization failure
		assertThat(result.campaign().name()).isEqualTo("Nike SS26");
		assertThat(result.planByLineItem().get("111").plannedImpressions()).isEqualTo(1000.0);
		assertThat(result.factsDaily()).hasSize(1);
		server.verify();
	}

	@Test
	void shouldMapDashboardDataNotFoundTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/missing/data")).andRespond(withStatus(HttpStatus.NOT_FOUND));

		// When-Then:
		assertThatThrownBy(() -> client.getDashboardData(assertion, "missing"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_NOT_FOUND);
	}

	@Test
	void shouldReturnRefreshStatusTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/nike-ss26/refresh-status"))
				.andExpect(method(GET))
				.andRespond(withSuccess(
						"{\"ok\":true,\"exists\":true,\"refresh_id\":\"r1\",\"row_count\":42,\"latest_date\":\"2026-08-31\"}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingRefreshStatus result = client.getRefreshStatus(assertion, "nike-ss26");

		// Then:
		assertThat(result.exists()).isTrue();
		assertThat(result.refreshId()).isEqualTo("r1");
		assertThat(result.rowCount()).isEqualTo(42);
		assertThat(result.latestDate()).isEqualTo("2026-08-31");
		server.verify();
	}

	@Test
	void shouldTriggerRefreshTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1/refresh"))
				.andExpect(method(POST))
				.andRespond(withSuccess("{\"ok\":true}", MediaType.APPLICATION_JSON));

		// When:
		PacingRefreshOutcome result = client.refreshPacing(assertion, "p1");

		// Then:
		assertThat(result.started()).isTrue();
		assertThat(result.retryAfterSeconds()).isNull();
		server.verify();
	}

	@Test
	void shouldReturnCooldownOutcomeWithoutThrowingOn429Test() {
		// Given: US-119 - a 429 inside the cooldown is a normal outcome, never an exception
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1/refresh"))
				.andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS)
						.body("{\"error\":\"refresh_in_progress\",\"retry_after_sec\":42}")
						.contentType(MediaType.APPLICATION_JSON));

		// When:
		PacingRefreshOutcome result = client.refreshPacing(assertion, "p1");

		// Then:
		assertThat(result.started()).isFalse();
		assertThat(result.retryAfterSeconds()).isEqualTo(42);
	}

	@Test
	void shouldMapRefreshOfNonLivePacingToBadRequestWithForwardedDetailTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1/refresh"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"error\":\"pacing_not_live\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.refreshPacing(assertion, "p1"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_BAD_REQUEST);
	}

	@Test
	void shouldSaveDisplayTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/nike-ss26/settings"))
				.andExpect(method(POST))
				.andExpect(content().json("{\"display\":{\"widgets\":[]},\"display_rev\":3}"))
				.andRespond(withSuccess("{\"ok\":true,\"display\":{\"widgets\":[],\"rev\":4}}", MediaType.APPLICATION_JSON));

		// When:
		PacingDisplaySaveOutcome result = client.saveDisplay(assertion, "nike-ss26", Map.of("widgets", List.of()), 3,
				Map.of("contextWidgetSpec", 2));

		// Then:
		assertThat(result.ok()).isTrue();
		assertThat(result.display()).containsEntry("rev", 4);
		server.verify();
	}

	@Test
	void shouldReturnStaleSettingsConflictWithoutThrowingOn409Test() {
		// Given: US-118 - a concurrent edit is reported, not silently overwritten and not an exception
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/nike-ss26/settings"))
				.andRespond(withStatus(HttpStatus.CONFLICT)
						.body("{\"error\":\"stale_settings\",\"rev\":7}")
						.contentType(MediaType.APPLICATION_JSON));

		// When:
		PacingDisplaySaveOutcome result = client.saveDisplay(assertion, "nike-ss26", Map.of("widgets", List.of()), 3,
				Map.of("contextWidgetSpec", 2));

		// Then:
		assertThat(result.ok()).isFalse();
		assertThat(result.conflictReason()).isEqualTo("stale_settings");
		assertThat(result.currentRev()).isEqualTo(7);
	}

	// ── §6: widget library ──

	@Test
	void shouldListLibraryWithQueryParamsTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library?q=budget&sort=likes&shelf=mine&kind=widget"))
				.andExpect(method(GET))
				.andRespond(withSuccess(
						"{\"ok\":true,\"entries\":[{\"id\":\"e1\",\"kind\":\"widget\",\"name\":\"Budget card\","
								+ "\"owner_name\":\"Azat\",\"created_at\":\"t1\",\"updated_at\":\"t2\",\"likes\":3,"
								+ "\"liked\":true,\"mine\":true,\"usage\":5}]}",
						MediaType.APPLICATION_JSON));

		// When:
		List<PacingLibraryEntry> result = client.listLibrary(assertion, "budget", "likes", "mine", "widget");

		// Then:
		assertThat(result).hasSize(1);
		assertThat(result.get(0).ownerName()).isEqualTo("Azat");
		assertThat(result.get(0).usage()).isEqualTo(5);
		server.verify();
	}

	@Test
	void shouldCreateLibraryEntryTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library"))
				.andExpect(method(POST))
				.andRespond(withStatus(HttpStatus.CREATED)
						.body("{\"ok\":true,\"entry\":{\"id\":\"e2\",\"kind\":\"widget\",\"name\":\"My widget\","
								+ "\"likes\":0,\"liked\":false,\"mine\":true,\"usage\":0}}")
						.contentType(MediaType.APPLICATION_JSON));

		// When:
		PacingLibrarySaveOutcome result =
				client.createLibraryEntry(assertion, "widget", "My widget", null, Map.of("id", "w_1"));

		// Then:
		assertThat(result.ok()).isTrue();
		assertThat(result.entry().id()).isEqualTo("e2");
		server.verify();
	}

	@Test
	void shouldReturnLibraryFullConflictWithoutThrowingOn409Test() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library"))
				.andRespond(withStatus(HttpStatus.CONFLICT)
						.body("{\"ok\":false,\"error\":\"library_full\",\"limit\":200}")
						.contentType(MediaType.APPLICATION_JSON));

		// When:
		PacingLibrarySaveOutcome result =
				client.createLibraryEntry(assertion, "widget", "My widget", null, Map.of("id", "w_1"));

		// Then:
		assertThat(result.ok()).isFalse();
		assertThat(result.conflictReason()).isEqualTo("library_full");
	}

	@Test
	void shouldUpdateLibraryEntryTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library/e1"))
				.andExpect(method(PUT))
				.andRespond(withSuccess(
						"{\"ok\":true,\"entry\":{\"id\":\"e1\",\"kind\":\"widget\",\"name\":\"Renamed\","
								+ "\"likes\":0,\"liked\":false,\"mine\":true,\"usage\":1}}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingLibrarySaveOutcome result =
				client.updateLibraryEntry(assertion, "e1", "Renamed", null, Map.of("id", "w_1"), "t2");

		// Then:
		assertThat(result.ok()).isTrue();
		assertThat(result.entry().name()).isEqualTo("Renamed");
		server.verify();
	}

	@Test
	void shouldReturnStaleEntryConflictWithoutThrowingOn409Test() {
		// Given: US-118 - a concurrent edit is reported with the current stamp, never silently overwritten
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library/e1"))
				.andRespond(withStatus(HttpStatus.CONFLICT)
						.body("{\"ok\":false,\"error\":\"stale_entry\",\"updated_at\":\"t3\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When:
		PacingLibrarySaveOutcome result =
				client.updateLibraryEntry(assertion, "e1", "Renamed", null, Map.of("id", "w_1"), "t2");

		// Then:
		assertThat(result.ok()).isFalse();
		assertThat(result.conflictReason()).isEqualTo("stale_entry");
		assertThat(result.currentUpdatedAt()).isEqualTo("t3");
	}

	@Test
	void shouldMapNotYoursTo403ForbiddenTest() {
		// Given: a real authorization decision Pacing made about this specific entry, distinct from the
		// unknown_user sync-gap case
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library/e1"))
				.andRespond(withStatus(HttpStatus.FORBIDDEN)
						.body("{\"ok\":false,\"error\":\"not_yours\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.updateLibraryEntry(assertion, "e1", "Renamed", null, Map.of("id", "w_1"), "t2"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_FORBIDDEN);
	}

	@Test
	void shouldDeleteLibraryEntryTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library/e1"))
				.andExpect(method(DELETE))
				.andRespond(withSuccess("{\"ok\":true,\"id\":\"e1\"}", MediaType.APPLICATION_JSON));

		// When:
		PacingLibrarySaveOutcome result = client.deleteLibraryEntry(assertion, "e1", "t2");

		// Then:
		assertThat(result.ok()).isTrue();
		assertThat(result.deletedId()).isEqualTo("e1");
		server.verify();
	}

	@Test
	void shouldLikeLibraryEntryTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library/e1/like"))
				.andExpect(method(POST))
				.andRespond(withSuccess("{\"ok\":true,\"liked\":true,\"likes\":4}", MediaType.APPLICATION_JSON));

		// When:
		PacingLikeResult result = client.likeLibraryEntry(assertion, "e1", true);

		// Then:
		assertThat(result.liked()).isTrue();
		assertThat(result.likes()).isEqualTo(4);
		server.verify();
	}

	@Test
	void shouldUnlikeLibraryEntryTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library/e1/like"))
				.andExpect(method(DELETE))
				.andRespond(withSuccess("{\"ok\":true,\"liked\":false,\"likes\":3}", MediaType.APPLICATION_JSON));

		// When:
		PacingLikeResult result = client.likeLibraryEntry(assertion, "e1", false);

		// Then:
		assertThat(result.liked()).isFalse();
		assertThat(result.likes()).isEqualTo(3);
		server.verify();
	}

	@Test
	void shouldClassifyDashboardDataConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/p1/data"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.getDashboardData(assertion, "p1"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	@Test
	void shouldClassifyRefreshStatusFailureAndConnectionFailureTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/p1/refresh-status")).andRespond(withServerError());

		// When-Then:
		assertThatThrownBy(() -> client.getRefreshStatus(assertion, "p1"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.OTHER);
	}

	@Test
	void shouldClassifySaveDisplayConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/p1/settings"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.saveDisplay(assertion, "p1", Map.of(), 1, Map.of("contextWidgetSpec", 2)))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	@Test
	void shouldReturnWriterRequiredConflictOnDisplaySaveTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/p1/settings"))
				.andRespond(withStatus(HttpStatus.CONFLICT)
						.body("{\"error\":\"v2_writer_required\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When:
		PacingDisplaySaveOutcome result = client.saveDisplay(assertion, "p1", Map.of(), 1, Map.of("contextWidgetSpec", 2));

		// Then:
		assertThat(result.ok()).isFalse();
		assertThat(result.conflictReason()).isEqualTo("v2_writer_required");
	}

	@Test
	void shouldListLibraryWithNoFiltersTest() {
		// Given: every query param omitted (null) - the empty-catalog default view
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library"))
				.andRespond(withSuccess("{\"ok\":true,\"entries\":[]}", MediaType.APPLICATION_JSON));

		// When:
		List<PacingLibraryEntry> result = client.listLibrary(assertion, null, null, null, null);

		// Then:
		assertThat(result).isEmpty();
		server.verify();
	}

	@Test
	void shouldClassifyListLibraryConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.listLibrary(assertion, null, null, null, null))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	@Test
	void shouldClassifyCreateLibraryEntryConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.createLibraryEntry(assertion, "widget", "n", null, Map.of()))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	@Test
	void shouldMapCreateLibraryEntryValidationFailureWithDetailTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"error\":\"bad_library\",\"detail\":\"name is required\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.createLibraryEntry(assertion, "widget", "", null, Map.of()))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getDetail())
				.isEqualTo("name is required");
	}

	@Test
	void shouldMapCreateLibraryEntryPortabilityFailureWithoutDetailTest() {
		// Given: no "detail" field on this one - falls back to describeErrorCode's mapping
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"error\":\"mapping_not_portable\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.createLibraryEntry(assertion, "widget", "n", null, Map.of()))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getDetail())
				.isEqualTo("this widget's mapping is pinned to a specific pacing and cannot be shared");
	}

	@Test
	void shouldReturnWriterRequiredConflictOnLibraryCreateTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library"))
				.andRespond(withStatus(HttpStatus.CONFLICT)
						.body("{\"error\":\"v2_writer_required\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When:
		PacingLibrarySaveOutcome result = client.createLibraryEntry(assertion, "widget", "n", null, Map.of());

		// Then:
		assertThat(result.ok()).isFalse();
		assertThat(result.conflictReason()).isEqualTo("v2_writer_required");
	}

	@Test
	void shouldMapLibraryTooFastRateLimitOnCreateTest() {
		// Given: too_fast is not a structured conflict the caller reacts to distinctly - it's still a
		// thrown failure, just with the retry-after seconds folded into the message
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library"))
				.andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS)
						.body("{\"error\":\"too_fast\",\"retry_after\":60}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.createLibraryEntry(assertion, "widget", "n", null, Map.of()))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.OTHER);
	}

	@Test
	void shouldDegradeGracefullyWhenErrorBodyIsNotJsonTest() {
		// Given: a malformed/non-JSON error body must not itself crash the failure mapping
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1/refresh"))
				.andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS).body("not json").contentType(MediaType.TEXT_PLAIN));

		// When:
		PacingRefreshOutcome result = client.refreshPacing(assertion, "p1");

		// Then: falls back to the default cooldown rather than throwing
		assertThat(result.started()).isFalse();
		assertThat(result.retryAfterSeconds()).isEqualTo(120);
	}

	@Test
	void shouldClassifyUpdateLibraryEntryConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library/e1"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.updateLibraryEntry(assertion, "e1", "n", null, Map.of(), "t1"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	@Test
	void shouldMapDeleteLibraryEntryNotFoundTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library/e1"))
				.andRespond(withStatus(HttpStatus.NOT_FOUND)
						.body("{\"error\":\"not_found\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.deleteLibraryEntry(assertion, "e1", "t1"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_NOT_FOUND);
	}

	@Test
	void shouldClassifyDeleteLibraryEntryConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library/e1"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.deleteLibraryEntry(assertion, "e1", "t1"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	@Test
	void shouldClassifyLikeLibraryEntryConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library/e1/like"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.likeLibraryEntry(assertion, "e1", true))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	@Test
	void shouldMapLikeLibraryEntryUnknownUserTo409Test() {
		// Given: the auth boundary's unknown_user case applies to every Pacing call, like included
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/library/e1/like"))
				.andRespond(withStatus(HttpStatus.FORBIDDEN)
						.body("{\"error\":\"unknown_user\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.likeLibraryEntry(assertion, "e1", true))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_USER_NOT_SYNCED);
	}

	@Test
	void shouldClassifyRefreshConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1/refresh"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.refreshPacing(assertion, "p1"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	// ── §8 (Create Pacing): validateCampaign / createPacing ──

	@Test
	void shouldValidateCampaignSendingTheCampaignIdSelectorTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), true);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/validate"))
				.andExpect(method(POST))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andExpect(content().json("{\"campaign_id\":\"40539\"}"))
				.andRespond(withSuccess(
						"{\"ok\":true,\"lineItems\":[{\"line_item_id\":\"599852\",\"channel\":\"DOOH\","
								+ "\"planned_units\":1432875,\"mrg_source\":{\"value\":null},"
								+ "\"kpi_source\":{\"ctr\":null,\"vcr\":null}}],"
								+ "\"insertionOrders\":[{\"order_id\":\"48000\",\"order_number\":\"TM-1\","
								+ "\"order_name\":null,\"order_budget\":250000,\"order_start_date\":\"2026-01-01\","
								+ "\"order_end_date\":\"2026-03-31\",\"order_status\":\"Active\"}],"
								+ "\"client\":\"Acme\",\"agency\":\"MediaCo\",\"campaign\":\"2026_Campaign\","
								+ "\"orderNumber\":\"TM-1\",\"order_numbers\":[\"TM-1\"],"
								+ "\"inUse\":{\"599852\":{\"pacingId\":\"p1\",\"pacingName\":\"Other\","
								+ "\"dashSlug\":\"other\",\"status\":\"Live\"}}}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingValidateResult result = client.validateCampaign(assertion, "40539");

		// Then:
		assertThat(result.ok()).isTrue();
		assertThat(result.lineItems()).hasSize(1);
		assertThat(result.lineItems().get(0).lineItemId()).isEqualTo("599852");
		assertThat(result.lineItems().get(0).plannedUnits()).isEqualTo(1432875.0);
		assertThat(result.client()).isEqualTo("Acme");
		assertThat(result.orderNumbers()).containsExactly("TM-1");
		assertThat(result.inUse()).containsKey("599852");
		assertThat(result.inUse().get("599852").pacingName()).isEqualTo("Other");
		// §8 (US-122): the campaign's own insertion order(s), verbatim off the wire.
		assertThat(result.insertionOrders()).hasSize(1);
		assertThat(result.insertionOrders().get(0).orderId()).isEqualTo("48000");
		assertThat(result.insertionOrders().get(0).orderNumber()).isEqualTo("TM-1");
		assertThat(result.insertionOrders().get(0).orderName()).isNull();
		assertThat(result.insertionOrders().get(0).orderBudget()).isEqualTo(250000.0);
		assertThat(result.insertionOrders().get(0).orderStatus()).isEqualTo("Active");
		server.verify();
	}

	@Test
	void shouldReturnOkFalseValidateResultWithoutThrowingTest() {
		// Given: Pacing answers 200 even when it rejects pacing the campaign as-is (mixed currencies) -
		// this is a normal outcome, not an HTTP error.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), true);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/validate"))
				.andRespond(withSuccess(
						"{\"ok\":false,\"error\":\"Mixed currencies across line items (CAD, EUR).\","
								+ "\"lineItems\":[],\"client\":\"Acme\",\"agency\":\"MediaCo\",\"campaign\":\"C\"}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingValidateResult result = client.validateCampaign(assertion, "40539");

		// Then:
		assertThat(result.ok()).isFalse();
		assertThat(result.error()).contains("Mixed currencies");
	}

	@Test
	void shouldMapValidateNoCreatePermissionTo403ForbiddenTest() {
		// Given: no_create_permission is a REAL authorization decision (canCreate is false on the
		// assertion) - distinct from unknown_user, which is a sync gap.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/validate"))
				.andRespond(withStatus(HttpStatus.FORBIDDEN)
						.body("{\"error\":\"no_create_permission\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.validateCampaign(assertion, "40539"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_FORBIDDEN);
	}

	@Test
	void shouldForwardValidateBadRequestDetailWhenPresentTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), true);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/validate"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"ok\":false,\"error\":\"invalid_line_item_id\","
								+ "\"detail\":\"Line item ids are digits only; got \\\"abc\\\".\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.validateCampaign(assertion, "abc"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getDetail())
				.isEqualTo("Line item ids are digits only; got \"abc\".");
	}

	@Test
	void shouldFallBackToASentenceLikeErrorAsDetailWhenNoDetailFieldTest() {
		// Given: dash-gate's own plain-text validation failures carry only "error", already a full
		// sentence rather than a short machine code - forwarded as-is.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), true);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"error\":\"pacing_name and line_items required\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.createPacing(assertion, "", List.of()))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getDetail())
				.isEqualTo("pacing_name and line_items required");
	}

	@Test
	void shouldDescribeMixedCurrencyShortCodeAsDetailTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), true);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"error\":\"mixed_currency\",\"details\":\"CAD, EUR\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.createPacing(assertion, "Pacing", List.of()))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getDetail())
				.isEqualTo("the selected line items span more than one non-USD currency; a pacing can only have one");
	}

	@Test
	void shouldCreatePacingSendingTheSelectedLineItemsAndReturnIdentifiersTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), true);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		PacingCreateLineItem lineItem = new PacingCreateLineItem(
				"599852", "DOOH", "2026-03-01", "2026-03-31", "CPM", "desc", 20633.4, "USD", 1.0,
				"40539", "2026_Campaign", "TM-271064", "Daria Feofanova", 1432875.0, 15.5, 0.85, null);
		server.expect(requestTo(BASE_URL + "/api/pacings"))
				.andExpect(method(POST))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andExpect(content().json(
						"{\"pacing_name\":\"2026_Campaign\",\"line_items\":[{\"line_item_id\":\"599852\","
								+ "\"channel\":\"DOOH\",\"flight_start\":\"2026-03-01\","
								+ "\"flight_end\":\"2026-03-31\",\"rate_type\":\"CPM\","
								+ "\"native_budget\":20633.4,\"description\":\"desc\",\"currency\":\"USD\","
								+ "\"exchange_rate\":1.0,\"campaign_id\":\"40539\","
								+ "\"campaign_name\":\"2026_Campaign\",\"order_number\":\"TM-271064\","
								// §11, US-132: NetSuite's own team lead rides along on create, so the new
								// pacing can show the owner-vs-NetSuite comparison without waiting for a
								// revalidate. Pinned here because it is a wire field, not a Hub-side value.
								+ "\"mpo_team_lead\":\"Daria Feofanova\","
								+ "\"target_impressions\":1432875.0,\"margin_percent\":15.5,"
								+ "\"target_ctr\":0.85}]}"))
				.andRespond(withStatus(HttpStatus.CREATED)
						.body("{\"ok\":true,\"pacing_id\":\"p9\",\"dash_slug\":\"acme-2026-campaign\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When:
		PacingCreateResult result = client.createPacing(assertion, "2026_Campaign", List.of(lineItem));

		// Then:
		assertThat(result.pacingId()).isEqualTo("p9");
		assertThat(result.dashSlug()).isEqualTo("acme-2026-campaign");
		server.verify();
	}

	@Test
	void shouldMapCreateUnknownUserTo409ConflictTest() {
		// Given: create's own user-row lookup miss - a sync gap, distinct from no_create_permission.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), true);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings"))
				.andRespond(withStatus(HttpStatus.FORBIDDEN)
						.body("{\"error\":\"unknown_user\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.createPacing(assertion, "Pacing", List.of()))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_USER_NOT_SYNCED);
	}

	@Test
	void shouldClassifyCreatePacingConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), true);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.createPacing(assertion, "Pacing", List.of()))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	// ── §9: plan save (US-125/126/127) ──

	@Test
	void shouldSavePlanSendingOnlyLineItemsTest() {
		// Given: no `display` key on this endpoint's body, ever - a plan save must never carry the
		// widget/layout fragment §6's display save owns.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		PacingLineItemPlanUpdate li = new PacingLineItemPlanUpdate(
				"599852", null, null, null, null, null, "CPM", 1000.0, 500000.0, 20.0, null, null,
				"2026-01-01", "2026-01-31", List.of(Map.of("id", "c1", "target_impressions", 100000)));
		server.expect(requestTo(BASE_URL + "/api/dashboards/nike-ss26/settings"))
				.andExpect(method(POST))
				.andExpect(content().json(
						"{\"line_items\":[{\"line_item_id\":\"599852\",\"rate_type\":\"CPM\","
								+ "\"native_budget\":1000.0,\"target_impressions\":500000.0,"
								+ "\"margin_percent\":20.0,\"flight_start\":\"2026-01-01\","
								+ "\"flight_end\":\"2026-01-31\"}]}"))
				.andRespond(withSuccess("{\"ok\":true}", MediaType.APPLICATION_JSON));

		// When-Then: no exception - void on success.
		client.savePlan(assertion, "nike-ss26", List.of(li));
		server.verify();
	}

	@Test
	void shouldOmitPreserveByIdFieldsFromTheWireRequestWhenNotEditingThemTest() {
		// Given: US-125/126/127 - editing an EXISTING line item's plan never touches
		// channel/description/campaignId/campaignName, so the wire request must OMIT those keys
		// entirely (not send them as null), or dash-gate's own `'channel' in newLi`-style preserve
		// check would read "present" and overwrite the stored value with null.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		PacingLineItemPlanUpdate li = new PacingLineItemPlanUpdate(
				"599852", null, null, null, null, null, "CPM", 1000.0, 500000.0, 20.0, null, null,
				"2026-01-01", "2026-01-31", List.of());
		server.expect(requestTo(BASE_URL + "/api/dashboards/nike-ss26/settings"))
				.andExpect(request -> {
					String body = ((MockClientHttpRequest) request).getBodyAsString();
					assertThat(body).doesNotContain("\"channel\"");
					assertThat(body).doesNotContain("\"description\"");
					assertThat(body).doesNotContain("\"campaign_id\"");
					assertThat(body).doesNotContain("\"campaign_name\"");
					assertThat(body).contains("\"line_item_id\":\"599852\"");
				})
				.andRespond(withSuccess("{\"ok\":true}", MediaType.APPLICATION_JSON));

		// When:
		client.savePlan(assertion, "nike-ss26", List.of(li));
		server.verify();
	}

	@Test
	void shouldIncludePreserveByIdFieldsForANewlyAddedLineItemTest() {
		// Given: a line item not yet on the pacing (US-126) has nothing stored to preserve, so channel/
		// description/campaignId/campaignName ride along explicitly.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		PacingLineItemPlanUpdate li = new PacingLineItemPlanUpdate(
				"7", "Display", "New line item", "40539", "2026_Campaign", "TM-1", "CPM", 1000.0,
				500000.0, 20.0, null, null, "2026-01-01", "2026-01-31", List.of());
		server.expect(requestTo(BASE_URL + "/api/dashboards/nike-ss26/settings"))
				.andExpect(content().json(
						"{\"line_items\":[{\"line_item_id\":\"7\",\"channel\":\"Display\","
								+ "\"description\":\"New line item\",\"campaign_id\":\"40539\","
								+ "\"campaign_name\":\"2026_Campaign\",\"order_number\":\"TM-1\"}]}"))
				.andRespond(withSuccess("{\"ok\":true}", MediaType.APPLICATION_JSON));

		// When:
		client.savePlan(assertion, "nike-ss26", List.of(li));
		server.verify();
	}

	@Test
	void shouldDescribeCoefMarginRangeErrorNamingLineItemAndFieldTest() {
		// Given: US-125's "invalid combination is rejected with a message naming the field".
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/nike-ss26/settings"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"ok\":false,\"error\":\"bad_coef_config\",\"details\":["
								+ "{\"line_item_id\":\"599852\",\"source\":\"payload\",\"errors\":["
								+ "{\"code\":\"coef_margin_range\",\"where\":\"container:March 2026\","
								+ "\"value\":150}]}]}")
						.contentType(MediaType.APPLICATION_JSON));
		PacingLineItemPlanUpdate li = new PacingLineItemPlanUpdate(
				"599852", null, null, null, null, null, null, null, null, null, null, null, null, null, null);

		// When-Then:
		assertThatThrownBy(() -> client.savePlan(assertion, "nike-ss26", List.of(li)))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getDetail())
				.isEqualTo("line item 599852: container:March 2026 is out of range "
						+ "(coefficient-cost margin must be 0-99.99)");
	}

	@Test
	void shouldDescribeCoefMarginOverlapErrorTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/nike-ss26/settings"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"ok\":false,\"error\":\"bad_coef_config\",\"details\":["
								+ "{\"line_item_id\":\"1\",\"errors\":[{\"code\":\"coef_margin_overlap\","
								+ "\"a\":\"container:Jan\",\"b\":\"container:Feb\"}]}]}")
						.contentType(MediaType.APPLICATION_JSON));
		PacingLineItemPlanUpdate li = new PacingLineItemPlanUpdate(
				"1", null, null, null, null, null, null, null, null, null, null, null, null, null, null);

		// When-Then:
		assertThatThrownBy(() -> client.savePlan(assertion, "nike-ss26", List.of(li)))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getDetail())
				.isEqualTo("line item 1: overlapping coefficient-cost margins on container:Jan and container:Feb");
	}

	@Test
	void shouldFallBackToGenericCoefMessageWhenDetailsShapeIsUnexpectedTest() {
		// Given: a details array present but empty degrades to the generic sentence rather than throwing
		// a mapper-internal NPE.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/nike-ss26/settings"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"ok\":false,\"error\":\"bad_coef_config\",\"details\":[]}")
						.contentType(MediaType.APPLICATION_JSON));
		PacingLineItemPlanUpdate li = new PacingLineItemPlanUpdate(
				"1", null, null, null, null, null, null, null, null, null, null, null, null, null, null);

		// When-Then:
		assertThatThrownBy(() -> client.savePlan(assertion, "nike-ss26", List.of(li)))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getDetail())
				.isEqualTo("one or more line items have an invalid coefficient-cost margin");
	}

	@Test
	void shouldMapPlanSaveGenericBadRequestUsingErrorCodeFallbackTest() {
		// Given: a 400 that is not bad_coef_config and carries no `detail` - falls back through
		// describeErrorCode, same as the display save's own 400 handling.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/nike-ss26/settings"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"ok\":false,\"error\":\"bad_dim_sources\"}")
						.contentType(MediaType.APPLICATION_JSON));
		PacingLineItemPlanUpdate li = new PacingLineItemPlanUpdate(
				"1", null, null, null, null, null, null, null, null, null, null, null, null, null, null);

		// When-Then:
		assertThatThrownBy(() -> client.savePlan(assertion, "nike-ss26", List.of(li)))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_BAD_REQUEST);
	}

	@Test
	void shouldMapPlanSaveNotFoundTest() {
		// Given: the non-400 branch of planSaveFailure falls through to the shared dashboardFailure.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/gone/settings"))
				.andRespond(withStatus(HttpStatus.NOT_FOUND)
						.body("{\"error\":\"pacing_not_found\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.savePlan(assertion, "gone", List.of()))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_NOT_FOUND);
	}

	@Test
	void shouldClassifySavePlanConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/nike-ss26/settings"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.savePlan(assertion, "nike-ss26", List.of()))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	// ── §9: addable line items (US-126) ──

	@Test
	void shouldReturnAddableLineItemsTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/nike-ss26/addable-line-items"))
				.andExpect(method(GET))
				.andRespond(withSuccess(
						"{\"ok\":true,\"io\":\"TM-1\",\"addable\":[{\"line_item_id\":\"7\","
								+ "\"channel\":\"Display\"}],\"already_added\":[\"599852\"],"
								+ "\"client\":\"Acme\"}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingAddableLineItems result = client.getAddableLineItems(assertion, "nike-ss26");

		// Then:
		assertThat(result.ok()).isTrue();
		assertThat(result.io()).isEqualTo("TM-1");
		assertThat(result.addable()).hasSize(1);
		assertThat(result.addable().get(0).lineItemId()).isEqualTo("7");
		assertThat(result.alreadyAdded()).containsExactly("599852");
		assertThat(result.client()).isEqualTo("Acme");
		server.verify();
	}

	@Test
	void shouldMapAddableLineItemsNotFoundTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/gone/addable-line-items"))
				.andRespond(withStatus(HttpStatus.NOT_FOUND)
						.body("{\"ok\":false,\"error\":\"pacing_not_found\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.getAddableLineItems(assertion, "gone"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_NOT_FOUND);
	}

	@Test
	void shouldClassifyAddableLineItemsConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/nike-ss26/addable-line-items"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.getAddableLineItems(assertion, "nike-ss26"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	// ── §9: add-by-id validate (US-126) ──

	@Test
	void shouldValidateLineItemsSendingTheLineItemIdsSelectorTest() {
		// Given: the sibling of validateCampaign's campaign_id selector.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), true);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/validate"))
				.andExpect(method(POST))
				.andExpect(content().json("{\"line_item_ids\":[\"12345\"]}"))
				.andRespond(withSuccess(
						"{\"ok\":true,\"lineItems\":[{\"line_item_id\":\"12345\","
								+ "\"campaign_id\":\"999\",\"campaign_name\":\"Another Campaign\"}]}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingValidateResult result = client.validateLineItems(assertion, List.of("12345"));

		// Then: a line item from another campaign is returned with its OWN campaign id/name, never
		// substituted - the caller (§9, US-126) decides how to mark it.
		assertThat(result.ok()).isTrue();
		assertThat(result.lineItems()).hasSize(1);
		assertThat(result.lineItems().get(0).campaignId()).isEqualTo("999");
		assertThat(result.lineItems().get(0).campaignName()).isEqualTo("Another Campaign");
		server.verify();
	}

	@Test
	void shouldMapValidateLineItemsNoCreatePermissionTo403ForbiddenTest() {
		// Given: add-by-id shares validateCampaign's canCreate requirement (§9's own crooked-but-real
		// constraint: Pacing draws no distinction between "creating" and "adding to an existing pacing"
		// on this shared endpoint).
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/validate"))
				.andRespond(withStatus(HttpStatus.FORBIDDEN)
						.body("{\"error\":\"no_create_permission\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.validateLineItems(assertion, List.of("12345")))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_FORBIDDEN);
	}

	@Test
	void shouldClassifyValidateLineItemsConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), true);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/validate"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.validateLineItems(assertion, List.of("12345")))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	// ── §11: ownership transfer (US-131) ──

	@Test
	void shouldTransferOwnerTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		// snake_case on the wire: Pacing reads body.new_owner_id, not newOwnerId.
		server.expect(requestTo(BASE_URL + "/api/pacings/p1/owner"))
				.andExpect(content().json("{\"new_owner_id\":\"11111111-1111-1111-1111-111111111111\"}"))
				.andRespond(withSuccess("{\"ok\":true}", MediaType.APPLICATION_JSON));

		// When-Then: no exception - void on success.
		client.transferOwner(assertion, "p1", "11111111-1111-1111-1111-111111111111");
		server.verify();
	}

	@Test
	void shouldSurfacePacingsRefusalWhenRecipientIsOutOfScopeTest() {
		// Given: Pacing is the one that decides whether a transfer is allowed - both the pacing and the
		// recipient must sit inside the asserted scope. Its refusal must reach the caller, not be
		// swallowed into a silent no-op that looks like the reassignment worked.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_OWNERS, List.of("u1"), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1/owner"))
				.andRespond(withStatus(HttpStatus.FORBIDDEN)
						.body("{\"error\":\"new owner is outside your scope\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.transferOwner(assertion, "p1", "22222222-2222-2222-2222-222222222222"))
				.isInstanceOf(PacingExternalException.class);
	}

	// ── §9: status change (US-128) ──

	@Test
	void shouldUpdateStatusTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1/status"))
				.andExpect(content().json("{\"status\":\"Archive\"}"))
				.andRespond(withSuccess("{\"ok\":true}", MediaType.APPLICATION_JSON));

		// When-Then: no exception - void on success.
		client.updateStatus(assertion, "p1", "Archive");
		server.verify();
	}

	@Test
	void shouldMapUpdateStatusBadRequestTest() {
		// Given: dash-gate's own plain-text sentence, forwarded verbatim (no `detail` key, `error` IS
		// the sentence) - same fallback path shouldFallBackToASentenceLikeErrorAsDetailWhenNoDetailFieldTest
		// exercises for create.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1/status"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"error\":\"Status must be Live, Paused, Complete, or Archive\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.updateStatus(assertion, "p1", "Bogus"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getDetail())
				.isEqualTo("Status must be Live, Paused, Complete, or Archive");
	}

	@Test
	void shouldClassifyUpdateStatusConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1/status"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.updateStatus(assertion, "p1", "Bogus"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	// ── Pacing administration screen (not in the migration plan - see PacingAdminController) ──

	@Test
	void shouldDeletePacingTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1"))
				.andExpect(method(DELETE))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andRespond(withSuccess("{\"ok\":true}", MediaType.APPLICATION_JSON));

		// When-Then: no exception - void on success.
		client.deletePacing(assertion, "p1");
		server.verify();
	}

	@Test
	void shouldMapDeletePacingNotFoundTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1"))
				.andRespond(withStatus(HttpStatus.NOT_FOUND)
						.body("{\"error\":\"pacing_not_found\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.deletePacing(assertion, "p1"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_NOT_FOUND);
	}

	@Test
	void shouldMapDeletePacingAdminOnlyForbiddenAsUpstreamForbiddenTest() {
		// Given: unlike most 403s from Pacing, admin_only is a real authorization decision, not a sync
		// gap - it must map to UPSTREAM_FORBIDDEN, not UPSTREAM_USER_NOT_SYNCED. The Hub's own
		// requireAdmin gate should stop a non-admin before this is ever sent, so this only guards the
		// mapping itself.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1"))
				.andRespond(withStatus(HttpStatus.FORBIDDEN)
						.body("{\"error\":\"admin_only\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.deletePacing(assertion, "p1"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_FORBIDDEN);
	}

	@Test
	void shouldClassifyDeletePacingConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.deletePacing(assertion, "p1"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	@Test
	void shouldTriggerRefreshAllDashboardsTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/admin/refresh-all-dashboards"))
				.andExpect(method(POST))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andRespond(withStatus(HttpStatus.ACCEPTED)
						.body("{\"ok\":true,\"triggered\":true}")
						.contentType(MediaType.APPLICATION_JSON));

		// When:
		PacingRefreshOutcome result = client.refreshAllDashboards(assertion);

		// Then:
		assertThat(result.started()).isTrue();
		assertThat(result.retryAfterSeconds()).isNull();
		server.verify();
	}

	@Test
	void shouldReturnRefreshAllDashboardsCooldownOutcomeWithoutThrowingOn429Test() {
		// Given: same normal-outcome shape as the single-pacing refresh cooldown
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/admin/refresh-all-dashboards"))
				.andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS)
						.body("{\"error\":\"refresh_in_progress\",\"retry_after_sec\":180}")
						.contentType(MediaType.APPLICATION_JSON));

		// When:
		PacingRefreshOutcome result = client.refreshAllDashboards(assertion);

		// Then:
		assertThat(result.started()).isFalse();
		assertThat(result.retryAfterSeconds()).isEqualTo(180);
	}

	@Test
	void shouldMapRefreshAllDashboardsAdminOnlyForbiddenAsUpstreamForbiddenTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/admin/refresh-all-dashboards"))
				.andRespond(withStatus(HttpStatus.FORBIDDEN)
						.body("{\"error\":\"admin_only\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.refreshAllDashboards(assertion))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_FORBIDDEN);
	}

	@Test
	void shouldClassifyRefreshAllDashboardsConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/admin/refresh-all-dashboards"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.refreshAllDashboards(assertion))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	@Test
	void shouldRevalidatePacingAndReadWhatChangedTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1/revalidate"))
				.andExpect(method(POST))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andRespond(withSuccess(
						"{\"ok\":true,\"changed\":true,\"changes\":[\"client\",\"12345\"],\"warnings\":[]}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingRevalidateResult result = client.revalidatePacing(assertion, "p1");

		// Then: `ok` is ignored, the rest is read through - including WHICH fields moved
		assertThat(result.changed()).isTrue();
		assertThat(result.changes()).containsExactly("client", "12345");
		assertThat(result.warnings()).isEmpty();
		server.verify();
	}

	@Test
	void shouldReadRevalidateFoundNothingToChangeTest() {
		// Given: a pacing already in step with the NetSuite master
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1/revalidate"))
				.andRespond(withSuccess(
						"{\"ok\":true,\"changed\":false,\"changes\":[],\"warnings\":[]}",
						MediaType.APPLICATION_JSON));

		// When-Then: not an error, just nothing to do
		assertThat(client.revalidatePacing(assertion, "p1").changed()).isFalse();
	}

	@Test
	void shouldMapRevalidateNsMasterErrorAsUnreachableTest() {
		// Given: Pacing answered, but the NetSuite master behind it did not - the caller should be told
		// to try again later (503), not that their request was wrong.
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1/revalidate"))
				.andRespond(withStatus(HttpStatus.BAD_GATEWAY)
						.body("{\"error\":\"ns_master_error\",\"details\":\"timeout\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.revalidatePacing(assertion, "p1"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	@Test
	void shouldMapRevalidateNotFoundTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/missing/revalidate"))
				.andRespond(withStatus(HttpStatus.NOT_FOUND)
						.body("{\"error\":\"pacing_not_found\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.revalidatePacing(assertion, "missing"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_NOT_FOUND);
	}

	// ── §13: NetSuite diff (US-136) ──

	@Test
	void shouldReturnNsDiffReportTest() {
		// Given: a report shaped like Pacing's real GET /api/pacings/:id/ns-diff response
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1/ns-diff"))
				.andExpect(method(GET))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andRespond(withSuccess(
						"""
						{"ok":true,"pacing_id":"p1","dash_slug":"nike-ss26",
						 "classes":["missing_in_netsuite","missing_in_pacing","field_diff","plan_diff","foreign_campaign","owner_diff"],
						 "counts":{"missing_in_netsuite":0,"missing_in_pacing":1,"field_diff":2,"plan_diff":0,"foreign_campaign":0,"owner_diff":1},
						 "in_sync":false,"not_checked_line_items":["manual-1"],
						 "missing_in_netsuite":[],
						 "missing_in_pacing":[{"line_item_id":"456","campaign_id":"C1","campaign_name":"Spring Push",
						   "order_number":"3854","channel":"Display","rate_type":"CPM","native_budget":7000,
						   "planned_units":1000000,"flight_start":"2026-05-01","flight_end":"2026-05-31","description":"NS desc"}],
						 "field_diff":[{"line_item_id":"123","fields":[
						   {"field":"channel","pacing":"Display","netsuite":"Video"},
						   {"field":"flight_start","pacing":"2026-05-01","netsuite":"2026-05-03","source":"override"}]}],
						 "plan_diff":[{"line_item_id":"123","fields":[
						   {"field":"target_spend","pacing":7000,"netsuite":7500,"pacing_native":7000,"netsuite_native":7500}]}],
						 "foreign_campaign":[{"line_item_id":"123","pacing_campaign_id":"C1","netsuite_campaign_id":"C2",
						   "netsuite_campaign_name":"Other Campaign","in_pacing_campaign_set":false}],
						 "owner_diff":[{"campaign_id":"C1","campaign_name":"Spring Push","owner_name":"Ana Ruiz","mpo_team_lead":"Someone Else"}]}
						""",
						MediaType.APPLICATION_JSON));

		// When:
		PacingNsDiffReport result = client.getNsDiff(assertion, "p1");

		// Then:
		assertThat(result.ok()).isTrue();
		assertThat(result.pacingId()).isEqualTo("p1");
		assertThat(result.dashSlug()).isEqualTo("nike-ss26");
		assertThat(result.inSync()).isFalse();
		assertThat(result.notCheckedLineItems()).containsExactly("manual-1");
		assertThat(result.counts().missingInPacing()).isEqualTo(1);
		assertThat(result.counts().fieldDiff()).isEqualTo(2);
		assertThat(result.missingInPacing()).hasSize(1);
		assertThat(result.missingInPacing().get(0).campaignName()).isEqualTo("Spring Push");
		assertThat(result.fieldDiff()).hasSize(1);
		assertThat(result.fieldDiff().get(0).fields()).hasSize(2);
		// The polymorphic pacing/netsuite values pass through untouched, string or number alike.
		assertThat(result.fieldDiff().get(0).fields().get(0).pacing()).isEqualTo("Display");
		assertThat(result.fieldDiff().get(0).fields().get(1).source()).isEqualTo("override");
		assertThat(result.planDiff().get(0).fields().get(0).pacingNative()).isEqualTo(7000);
		assertThat(result.planDiff().get(0).fields().get(0).netsuiteNative()).isEqualTo(7500);
		assertThat(result.foreignCampaign()).hasSize(1);
		assertThat(result.foreignCampaign().get(0).netsuiteCampaignName()).isEqualTo("Other Campaign");
		assertThat(result.ownerDiff()).hasSize(1);
		assertThat(result.ownerDiff().get(0).mpoTeamLead()).isEqualTo("Someone Else");
		server.verify();
	}

	@Test
	void shouldMapNsDiffNotFoundTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/missing/ns-diff")).andRespond(withStatus(HttpStatus.NOT_FOUND));

		// When-Then:
		assertThatThrownBy(() -> client.getNsDiff(assertion, "missing"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UPSTREAM_NOT_FOUND);
	}

	@Test
	void shouldClassifyNsDiffConnectionFailureAsUnreachableTest() {
		// Given:
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		HubAssertion assertion = new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingClientImpl client = new PacingClientImpl(builder.build(), signer, new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/pacings/p1/ns-diff"))
				.andRespond(request -> {
					throw new SocketTimeoutException("Read timed out");
				});

		// When-Then:
		assertThatThrownBy(() -> client.getNsDiff(assertion, "p1"))
				.isInstanceOf(PacingExternalException.class)
				.extracting(ex -> ((PacingExternalException) ex).getReason())
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}
}
