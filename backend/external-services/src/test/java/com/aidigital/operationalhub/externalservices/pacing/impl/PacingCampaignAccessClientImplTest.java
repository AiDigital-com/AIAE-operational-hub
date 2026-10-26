package com.aidigital.operationalhub.externalservices.pacing.impl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.http.HttpMethod.GET;
import static org.springframework.http.HttpMethod.POST;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignPacing;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.SocketTimeoutException;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * {@link PacingCampaignAccessClientImpl} against a mocked Pacing service: the four calls under the
 * system assertion, and the answers that are refusals.
 */
class PacingCampaignAccessClientImplTest {

	private static final String BASE_URL = "http://localhost:3000";
	private static final String SYSTEM_HEADER = "system.signature";
	private static final String PACING_ID = "11111111-1111-4111-8111-111111111111";
	private static final String OWNER_ID = "22222222-2222-4222-8222-222222222222";

	private RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);

	private MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();

	PacingCampaignAccessClientImpl client() {
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		when(signer.signSystem()).thenReturn(SYSTEM_HEADER);
		return new PacingCampaignAccessClientImpl(builder.build(), signer, new ObjectMapper());
	}

	@Test
	void shouldListCampaignIdsWithPacingsTest() {
		// Given:
		PacingCampaignAccessClientImpl client = client();
		server.expect(requestTo(BASE_URL + "/api/internal/campaigns-with-pacings"))
				.andExpect(method(GET))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SYSTEM_HEADER))
				.andRespond(withSuccess("{\"campaign_ids\":[\"100\",\"200\"]}", MediaType.APPLICATION_JSON));

		// When:
		List<String> result = client.listCampaignIdsWithPacings();

		// Then:
		assertThat(result).containsExactly("100", "200");
		server.verify();
	}

	@Test
	void shouldListAnOwnersPacingsOnACampaignTest() {
		// Given: dash-gate's snake_case rows
		PacingCampaignAccessClientImpl client = client();
		server.expect(requestTo(BASE_URL + "/api/internal/campaign-pacings?campaign_id=100&owner_id=" + OWNER_ID))
				.andExpect(method(GET))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SYSTEM_HEADER))
				.andRespond(withSuccess(
						"{\"pacings\":[{\"pacing_id\":\"" + PACING_ID + "\",\"dash_slug\":\"fox-2026\","
								+ "\"pacing_name\":\"Fox 2026\",\"status\":\"Live\",\"owner_id\":\"" + OWNER_ID + "\","
								+ "\"campaigns\":[{\"id\":\"100\",\"name\":\"Fox Spring\"},{\"id\":\"200\",\"name\":null}]}]}",
						MediaType.APPLICATION_JSON));

		// When:
		List<PacingCampaignPacing> result = client.listPacingsOnCampaign("100", OWNER_ID);

		// Then:
		assertThat(result).hasSize(1);
		assertThat(result.getFirst().pacingName()).isEqualTo("Fox 2026");
		assertThat(result.getFirst().campaigns()).extracting(c -> c.id()).containsExactly("100", "200");
		server.verify();
	}

	@Test
	void shouldReadOnePacingAndMapAMissingOneToNotFoundTest() {
		// Given:
		PacingCampaignAccessClientImpl client = client();
		server.expect(requestTo(BASE_URL + "/api/internal/pacings/" + PACING_ID))
				.andExpect(method(GET))
				.andRespond(withSuccess(
						"{\"pacing_id\":\"" + PACING_ID + "\",\"dash_slug\":\"fox-2026\",\"pacing_name\":\"Fox 2026\","
								+ "\"status\":\"Live\",\"owner_id\":null,\"campaigns\":[{\"id\":\"100\",\"name\":\"Fox\"}]}",
						MediaType.APPLICATION_JSON));
		server.expect(requestTo(BASE_URL + "/api/internal/pacings/" + OWNER_ID))
				.andRespond(withStatus(HttpStatus.NOT_FOUND)
						.body("{\"error\":\"pacing_not_found\"}").contentType(MediaType.APPLICATION_JSON));

		// When:
		PacingCampaignPacing pacing = client.getPacing(PACING_ID);

		// Then:
		assertThat(pacing.ownerId()).isNull();
		assertThat(pacing.campaigns()).hasSize(1);
		assertThatThrownBy(() -> client.getPacing(OWNER_ID))
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason")
				.isEqualTo(PacingFailureReason.UPSTREAM_NOT_FOUND);
	}

	@Test
	void shouldPostASystemTransferWithTheActorTest() {
		// Given:
		PacingCampaignAccessClientImpl client = client();
		server.expect(requestTo(BASE_URL + "/api/internal/pacings/" + PACING_ID + "/owner"))
				.andExpect(method(POST))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SYSTEM_HEADER))
				.andExpect(content().json(
						"{\"new_owner_id\":\"" + OWNER_ID + "\",\"actor_email\":\"tl@aidigital.com\"}", true))
				.andRespond(withSuccess("{\"ok\":true}", MediaType.APPLICATION_JSON));

		// When:
		client.transferOwnerAsSystem(PACING_ID, OWNER_ID, "tl@aidigital.com");

		// Then:
		server.verify();
	}

	@Test
	void shouldMapAnUnknownActorToNotSyncedTest() {
		// Given: the Hub user ordering the transfer is not in Pacing's mirror yet
		PacingCampaignAccessClientImpl client = client();
		server.expect(requestTo(BASE_URL + "/api/internal/pacings/" + PACING_ID + "/owner"))
				.andRespond(withStatus(HttpStatus.FORBIDDEN)
						.body("{\"error\":\"unknown_user\"}").contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.transferOwnerAsSystem(PACING_ID, OWNER_ID, "ghost@aidigital.com"))
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason")
				.isEqualTo(PacingFailureReason.UPSTREAM_USER_NOT_SYNCED);
	}

	@Test
	void shouldCarryPacingsDetailsOnABadRequestTest() {
		// Given:
		PacingCampaignAccessClientImpl client = client();
		server.expect(requestTo(BASE_URL + "/api/internal/pacings/" + PACING_ID + "/owner"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"error\":\"invalid_body\",\"details\":\"new_owner_id must be a UUID string\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When-Then:
		assertThatThrownBy(() -> client.transferOwnerAsSystem(PACING_ID, "nope", "tl@aidigital.com"))
				.isInstanceOf(PacingExternalException.class)
				.satisfies(ex -> {
					PacingExternalException pex = (PacingExternalException) ex;
					assertThat(pex.getReason()).isEqualTo(PacingFailureReason.UPSTREAM_BAD_REQUEST);
					assertThat(pex.getDetail()).isEqualTo("new_owner_id must be a UUID string");
				});
	}

	@Test
	void shouldReportAnUnreachablePacingTest() {
		// Given:
		PacingCampaignAccessClientImpl client = client();
		server.expect(requestTo(BASE_URL + "/api/internal/campaigns-with-pacings")).andRespond(request -> {
			throw new SocketTimeoutException("Read timed out");
		});

		// When-Then:
		assertThatThrownBy(client::listCampaignIdsWithPacings)
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason")
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}

	@Test
	void shouldListEveryPacingOnACampaignAndReadAMissingListAsEmptyTest() {
		// Given: no owner filter, and Pacing answering without a list
		PacingCampaignAccessClientImpl client = client();
		server.expect(requestTo(BASE_URL + "/api/internal/campaign-pacings?campaign_id=100"))
				.andExpect(method(GET))
				.andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));
		server.expect(requestTo(BASE_URL + "/api/internal/campaigns-with-pacings"))
				.andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

		// When:
		List<PacingCampaignPacing> pacings = client.listPacingsOnCampaign("100", null);
		List<String> campaignIds = client.listCampaignIdsWithPacings();

		// Then:
		assertThat(pacings).isEmpty();
		assertThat(campaignIds).isEmpty();
		server.verify();
	}

	@Test
	void shouldMapEachRefusalStatusTest() {
		// Given: a 401 with no body, a 403 other than an unknown user, a 500 with a body that is not JSON
		PacingCampaignAccessClientImpl client = client();
		server.expect(requestTo(BASE_URL + "/api/internal/campaigns-with-pacings"))
				.andRespond(withStatus(HttpStatus.UNAUTHORIZED));
		server.expect(requestTo(BASE_URL + "/api/internal/campaign-pacings?campaign_id=100"))
				.andRespond(withStatus(HttpStatus.FORBIDDEN)
						.body("{\"error\":\"forbidden\"}").contentType(MediaType.APPLICATION_JSON));
		server.expect(requestTo(BASE_URL + "/api/internal/pacings/" + PACING_ID))
				.andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR).body("<html>oops</html>"));

		// When-Then:
		assertThatThrownBy(client::listCampaignIdsWithPacings)
				.extracting("reason")
				.isEqualTo(PacingFailureReason.UPSTREAM_UNAUTHORIZED);
		assertThatThrownBy(() -> client.listPacingsOnCampaign("100", null))
				.extracting("reason")
				.isEqualTo(PacingFailureReason.UPSTREAM_FORBIDDEN);
		assertThatThrownBy(() -> client.getPacing(PACING_ID))
				.extracting("reason")
				.isEqualTo(PacingFailureReason.OTHER);
	}

	@Test
	void shouldRefuseAPacingAnsweredWithNoBodyTest() {
		// Given:
		PacingCampaignAccessClientImpl client = client();
		server.expect(requestTo(BASE_URL + "/api/internal/pacings/" + PACING_ID))
				.andRespond(withSuccess());

		// When-Then:
		assertThatThrownBy(() -> client.getPacing(PACING_ID))
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason")
				.isEqualTo(PacingFailureReason.OTHER);
	}

	@Test
	void shouldReportAnUnreachablePacingOnEveryCallTest() {
		// Given:
		PacingCampaignAccessClientImpl client = client();
		server.expect(requestTo(BASE_URL + "/api/internal/campaign-pacings?campaign_id=100")).andRespond(request -> {
			throw new SocketTimeoutException("Read timed out");
		});
		server.expect(requestTo(BASE_URL + "/api/internal/pacings/" + PACING_ID)).andRespond(request -> {
			throw new SocketTimeoutException("Read timed out");
		});
		server.expect(requestTo(BASE_URL + "/api/internal/pacings/" + PACING_ID + "/owner")).andRespond(request -> {
			throw new SocketTimeoutException("Read timed out");
		});

		// When-Then:
		assertThatThrownBy(() -> client.listPacingsOnCampaign("100", null))
				.extracting("reason")
				.isEqualTo(PacingFailureReason.UNREACHABLE);
		assertThatThrownBy(() -> client.getPacing(PACING_ID))
				.extracting("reason")
				.isEqualTo(PacingFailureReason.UNREACHABLE);
		assertThatThrownBy(() -> client.transferOwnerAsSystem(PACING_ID, OWNER_ID, "tl@aidigital.com"))
				.extracting("reason")
				.isEqualTo(PacingFailureReason.UNREACHABLE);
	}
}
