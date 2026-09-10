package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSyncStats;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserMirrorEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.util.List;
import java.util.Map;

/**
 * Default {@link PacingClient} backed by Spring's {@link RestClient}.
 *
 * <p>A fresh {@link HubAssertion} is signed on every call ({@link HubAssertionSigner#sign}
 * mints its own short-TTL {@code exp}), never cached or reused across requests.
 */
@Slf4j
@RequiredArgsConstructor
public class PacingClientImpl implements PacingClient {

	private static final String PACINGS_PATH = "/api/pacings";
	private static final String USERS_SYNC_PATH = "/api/internal/users/sync";
	private static final String INTERNAL_USERS_PATH = "/api/internal/users";

	private final RestClient restClient;
	private final HubAssertionSigner assertionSigner;

	@Override
	public List<Map<String, Object>> listPacings(HubAssertion assertion) {
		String header = assertionSigner.sign(assertion);
		try {
			PacingsResponse response = restClient.get()
					.uri(PACINGS_PATH)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.body(PacingsResponse.class);
			return response == null || response.pacings() == null ? List.of() : response.pacings();
		} catch (RestClientResponseException ex) {
			// Pacing answered, just not with 2xx: the status code it sent tells us which honest response
			// the Hub's own caller should get (see PacingFailureReason and GlobalExceptionHandler).
			int statusCode = ex.getStatusCode().value();
			PacingFailureReason reason = switch (statusCode) {
				case 401 -> PacingFailureReason.UPSTREAM_UNAUTHORIZED;
				case 403 -> PacingFailureReason.UPSTREAM_USER_NOT_SYNCED;
				case 404 -> PacingFailureReason.UPSTREAM_NOT_FOUND;
				default -> PacingFailureReason.OTHER;
			};
			throw new PacingExternalException(
					reason,
					"Pacing request failed: GET " + PACINGS_PATH + " returned HTTP " + statusCode,
					ex);
		} catch (RestClientException ex) {
			// No response came back at all (connection refused, or a connect/read timeout) - as opposed
			// to the branch above, where Pacing did answer. The dependency being down is a 503, not the
			// generic 500 an unrecognized-status failure gets.
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: GET " + PACINGS_PATH, ex);
		}
	}

	@Override
	public PacingUserSyncResult syncUsers(List<PacingUserSyncEntry> users) {
		String header = assertionSigner.signSystem();
		UsersSyncRequest request = new UsersSyncRequest(users);
		try {
			return attemptSyncUsers(header, request);
		} catch (PacingExternalException ex) {
			if (ex.getReason() != PacingFailureReason.UNREACHABLE) {
				// Pacing DID answer, just not with 2xx (e.g. a malformed batch): retrying the exact
				// same request would only get the exact same answer.
				throw ex;
			}
			// This is the project's first outbound WRITE - unlike listPacings, a naive retry here would
			// need to be safe against having partially applied the first attempt. It is: Pacing upserts
			// by email behind a unique index (see its migration 0004), so re-sending the same batch after
			// a connect/read timeout can only re-apply the same rows, never create a duplicate. Retried
			// once, not looped, so a genuinely down Pacing still fails fast.
			log.warn("Pacing user sync was unreachable; retrying once before giving up");
			return attemptSyncUsers(header, request);
		}
	}

	private PacingUserSyncResult attemptSyncUsers(String header, UsersSyncRequest request) {
		try {
			PacingUserSyncResult response = restClient.post()
					.uri(USERS_SYNC_PATH)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.body(PacingUserSyncResult.class);
			return response == null
					? new PacingUserSyncResult(Map.of(), new PacingSyncStats(0, 0, 0, 0))
					: response;
		} catch (RestClientResponseException ex) {
			int statusCode = ex.getStatusCode().value();
			// Pacing's internal gate only ever answers 401 (bad/missing system assertion) or 400 (a
			// malformed batch - which, since the Hub builds the batch itself, points at a Hub-side bug)
			// among non-2xx responses; unlike listPacings there is no unknown_user/404 case here.
			PacingFailureReason reason =
					statusCode == 401 ? PacingFailureReason.UPSTREAM_UNAUTHORIZED : PacingFailureReason.OTHER;
			throw new PacingExternalException(
					reason,
					"Pacing request failed: POST " + USERS_SYNC_PATH + " returned HTTP " + statusCode,
					ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: POST " + USERS_SYNC_PATH, ex);
		}
	}

	@Override
	public List<PacingUserMirrorEntry> listUsers() {
		String header = assertionSigner.signSystem();
		try {
			InternalUsersResponse response = restClient.get()
					.uri(INTERNAL_USERS_PATH)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.body(InternalUsersResponse.class);
			return response == null || response.users() == null ? List.of() : response.users();
		} catch (RestClientResponseException ex) {
			int statusCode = ex.getStatusCode().value();
			// Same internal gate as syncUsers: only ever a bad/missing system assertion (401) among
			// non-2xx responses on this path.
			PacingFailureReason reason =
					statusCode == 401 ? PacingFailureReason.UPSTREAM_UNAUTHORIZED : PacingFailureReason.OTHER;
			throw new PacingExternalException(
					reason,
					"Pacing request failed: GET " + INTERNAL_USERS_PATH + " returned HTTP " + statusCode,
					ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: GET " + INTERNAL_USERS_PATH, ex);
		}
	}

	/**
	 * Shape of Pacing's {@code GET /api/pacings} response body.
	 *
	 * @param pacings the visible pacings, each row as returned by Pacing
	 */
	private record PacingsResponse(List<Map<String, Object>> pacings) {
	}

	/**
	 * Shape of the {@code POST /api/internal/users/sync} request body.
	 *
	 * @param users the employees to sync
	 */
	private record UsersSyncRequest(List<PacingUserSyncEntry> users) {
	}

	/**
	 * Shape of Pacing's {@code GET /api/internal/users} response body.
	 *
	 * @param users every row of Pacing's user mirror
	 */
	private record InternalUsersResponse(List<PacingUserMirrorEntry> users) {
	}
}
