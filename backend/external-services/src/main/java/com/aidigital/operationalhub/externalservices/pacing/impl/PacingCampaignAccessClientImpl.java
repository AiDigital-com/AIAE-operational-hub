package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.PacingCampaignAccessClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignPacing;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * The campaign-access calls, over HTTP, each under a freshly signed SYSTEM assertion.
 */
@Slf4j
@RequiredArgsConstructor
public class PacingCampaignAccessClientImpl implements PacingCampaignAccessClient {

	private static final String CAMPAIGNS_WITH_PACINGS_PATH = "/api/internal/campaigns-with-pacings";
	private static final String CAMPAIGN_PACINGS_PATH = "/api/internal/campaign-pacings";
	private static final String PACINGS_PATH = "/api/internal/pacings";
	private static final String GET = "GET";
	private static final String POST = "POST";
	private static final String UNKNOWN_USER = "unknown_user";

	private final RestClient restClient;
	private final HubAssertionSigner assertionSigner;
	private final ObjectMapper objectMapper;

	@Override
	public List<String> listCampaignIdsWithPacings() {
		try {
			CampaignsWithPacingsResponse response = restClient.get()
					.uri(CAMPAIGNS_WITH_PACINGS_PATH)
					.header(HubAssertionSigner.HEADER_NAME, assertionSigner.signSystem())
					.retrieve()
					.body(CampaignsWithPacingsResponse.class);
			return response == null || response.campaignIds() == null ? List.of() : response.campaignIds();
		} catch (RestClientResponseException ex) {
			throw failure(GET, CAMPAIGNS_WITH_PACINGS_PATH, ex);
		} catch (RestClientException ex) {
			throw unreachable(GET, CAMPAIGNS_WITH_PACINGS_PATH, ex);
		}
	}

	@Override
	public List<PacingCampaignPacing> listPacingsOnCampaign(String campaignId, String ownerPacingUserId) {
		UriComponentsBuilder uri = UriComponentsBuilder.fromPath(CAMPAIGN_PACINGS_PATH)
				.queryParam("campaign_id", campaignId);
		if (ownerPacingUserId != null) {
			uri.queryParam("owner_id", ownerPacingUserId);
		}
		String path = uri.toUriString();
		try {
			CampaignPacingsResponse response = restClient.get()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, assertionSigner.signSystem())
					.retrieve()
					.body(CampaignPacingsResponse.class);
			return response == null || response.pacings() == null ? List.of() : response.pacings();
		} catch (RestClientResponseException ex) {
			throw failure(GET, path, ex);
		} catch (RestClientException ex) {
			throw unreachable(GET, path, ex);
		}
	}

	@Override
	public PacingCampaignPacing getPacing(String pacingId) {
		String path = PACINGS_PATH + "/" + pacingId;
		try {
			PacingCampaignPacing response = restClient.get()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, assertionSigner.signSystem())
					.retrieve()
					.body(PacingCampaignPacing.class);
			if (response == null) {
				throw new PacingExternalException(
						PacingFailureReason.OTHER, "Pacing request failed: GET " + path + " returned no pacing");
			}
			return response;
		} catch (RestClientResponseException ex) {
			throw failure(GET, path, ex);
		} catch (RestClientException ex) {
			throw unreachable(GET, path, ex);
		}
	}

	@Override
	public void transferOwnerAsSystem(String pacingId, String newOwnerPacingUserId, String actorEmail) {
		String path = PACINGS_PATH + "/" + pacingId + "/owner";
		try {
			restClient.post()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, assertionSigner.signSystem())
					.contentType(MediaType.APPLICATION_JSON)
					.body(new SystemOwnerTransferRequest(newOwnerPacingUserId, actorEmail))
					.retrieve()
					.toBodilessEntity();
		} catch (RestClientResponseException ex) {
			throw failure(POST, path, ex);
		} catch (RestClientException ex) {
			throw unreachable(POST, path, ex);
		}
	}

	/**
	 * Maps a non-2xx answer. 401 is the system assertion not verifying (a shared-secret mismatch), 403
	 * is the one the transfer gives for an actor Pacing's user mirror does not know, 404 names a missing
	 * pacing or recipient, and a 400 carries Pacing's own {@code details} - a Hub-side bug, since the Hub
	 * builds every request here itself.
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
			case 400 -> new PacingExternalException(
					PacingFailureReason.UPSTREAM_BAD_REQUEST, where, textField(body, "details"));
			case 401 -> new PacingExternalException(PacingFailureReason.UPSTREAM_UNAUTHORIZED, where);
			case 403 -> new PacingExternalException(
					error == null || UNKNOWN_USER.equals(error)
							? PacingFailureReason.UPSTREAM_USER_NOT_SYNCED
							: PacingFailureReason.UPSTREAM_FORBIDDEN,
					where);
			case 404 -> new PacingExternalException(PacingFailureReason.UPSTREAM_NOT_FOUND, where);
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
}
