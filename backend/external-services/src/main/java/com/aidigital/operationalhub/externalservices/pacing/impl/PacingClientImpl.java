package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAccount;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAddableLineItems;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateLineItem;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLineItemPlanUpdate;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDashboardData;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDataSettings;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDelegation;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDelegationGrant;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDisplaySaveOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingJournalEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibraryEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibrarySaveOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLikeResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNotifySettings;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingNsDiffReport;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRefreshStatus;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRevalidateResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRow;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSyncStats;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserMirrorEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingUserSyncResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingValidateResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriBuilder;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

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
	private static final String VALIDATE_PATH = "/api/pacings/validate";
	private static final String USERS_SYNC_PATH = "/api/internal/users/sync";
	private static final String INTERNAL_USERS_PATH = "/api/internal/users";
	private static final String DASHBOARDS_PATH = "/api/dashboards";
	private static final String DELEGATIONS_PATH = "/api/delegations";
	private static final String LIBRARY_PATH = "/api/library";
	private static final String ADMIN_REFRESH_ALL_PATH = "/api/admin/refresh-all-dashboards";
	private static final String ME_PATH = "/api/me";

	private final RestClient restClient;
	private final HubAssertionSigner assertionSigner;
	private final ObjectMapper objectMapper;

	@Override
	public List<PacingRow> listPacings(HubAssertion assertion) {
		String header = assertionSigner.sign(assertion);
		return fetchPacings(header, uriBuilder -> uriBuilder.path(PACINGS_PATH).build());
	}

	@Override
	public List<PacingRow> listPacingsForCampaign(HubAssertion assertion, String campaignId) {
		String header = assertionSigner.sign(assertion);
		return fetchPacings(header, uriBuilder -> uriBuilder
				.path(PACINGS_PATH)
				.queryParam("campaign_id", campaignId)
				.build());
	}

	/**
	 * Shared {@code GET /api/pacings} call for {@link #listPacings} and
	 * {@link #listPacingsForCampaign}: same response shape, same failure mapping, differing only in
	 * whether a {@code campaign_id} query param narrows Pacing's own array-containment filter.
	 *
	 * @param header      the signed {@code X-Hub-Assertion} header value
	 * @param uriResolver builds the request URI (plain or with {@code campaign_id}) off the base path
	 * @return the visible pacings, never {@code null}
	 */
	private List<PacingRow> fetchPacings(String header, Function<UriBuilder, URI> uriResolver) {
		try {
			PacingsResponse response = restClient.get()
					.uri(uriResolver)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.body(PacingsResponse.class);
			return response == null || response.pacings() == null ? List.of() : response.pacings();
		} catch (RestClientResponseException ex) {
			// Pacing answered, just not with 2xx: the status code it sent tells us which honest response
			// the Hub's own caller should get (see PacingFailureReason and GlobalExceptionHandler).
			int statusCode = ex.getStatusCode().value();
			JsonNode body = readBody(ex);
			String error = textField(body, "error");
			if (statusCode == 403 && error != null && !"unknown_user".equals(error)) {
				// server.mjs's unknown_user gate runs ahead of routing, so it can land on any endpoint - a
				// 403 with a genuine other reason here is a real authorization refusal, not a sync gap. An
				// absent/unreadable error (like unknown_user itself) defaults to the sync-gap reading below.
				throw new PacingExternalException(
						PacingFailureReason.UPSTREAM_FORBIDDEN,
						"Pacing request failed: GET " + PACINGS_PATH + " returned HTTP 403 (" + error + ")");
			}
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

	@Override
	public PacingDashboardData getDashboardData(HubAssertion assertion, String slug) {
		String header = assertionSigner.sign(assertion);
		String path = DASHBOARDS_PATH + "/" + slug + "/data";
		try {
			PacingDashboardData response = restClient.get()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.body(PacingDashboardData.class);
			if (response == null) {
				throw new PacingExternalException(
						PacingFailureReason.OTHER, "Pacing request failed: GET " + path + " returned an empty body");
			}
			return response;
		} catch (RestClientResponseException ex) {
			throw dashboardFailure("GET", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: GET " + path, ex);
		}
	}

	@Override
	public PacingRefreshStatus getRefreshStatus(HubAssertion assertion, String slug) {
		String header = assertionSigner.sign(assertion);
		String path = DASHBOARDS_PATH + "/" + slug + "/refresh-status";
		try {
			PacingRefreshStatus response = restClient.get()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.body(PacingRefreshStatus.class);
			return response == null ? new PacingRefreshStatus(false, null, 0, null) : response;
		} catch (RestClientResponseException ex) {
			throw dashboardFailure("GET", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: GET " + path, ex);
		}
	}

	@Override
	public PacingRefreshOutcome refreshPacing(HubAssertion assertion, String pacingId) {
		String header = assertionSigner.sign(assertion);
		String path = PACINGS_PATH + "/" + pacingId + "/refresh";
		try {
			restClient.post()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.toBodilessEntity();
			return PacingRefreshOutcome.triggered();
		} catch (RestClientResponseException ex) {
			int statusCode = ex.getStatusCode().value();
			JsonNode body = readBody(ex);
			if (statusCode == 429) {
				// The cooldown/double-launch guard is not a failure the caller should see as an error -
				// it carries the exact countdown US-119 asks the UI to show instead of a bare 429.
				int retryAfterSeconds = intField(body, "retry_after_sec", 120);
				return PacingRefreshOutcome.cooldown(retryAfterSeconds);
			}
			throw dashboardFailure("POST", path, ex, body);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: POST " + path, ex);
		}
	}

	@Override
	public PacingNsDiffReport getNsDiff(HubAssertion assertion, String pacingId) {
		String header = assertionSigner.sign(assertion);
		String path = PACINGS_PATH + "/" + pacingId + "/ns-diff";
		try {
			PacingNsDiffReport response = restClient.get()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.body(PacingNsDiffReport.class);
			if (response == null) {
				throw new PacingExternalException(
						PacingFailureReason.OTHER, "Pacing request failed: GET " + path + " returned an empty body");
			}
			return response;
		} catch (RestClientResponseException ex) {
			throw dashboardFailure("GET", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: GET " + path, ex);
		}
	}

	@Override
	public PacingDisplaySaveOutcome saveDisplay(
			HubAssertion assertion, String slug, Map<String, Object> display, int displayRev,
			Map<String, Object> writer) {
		String header = assertionSigner.sign(assertion);
		String path = DASHBOARDS_PATH + "/" + slug + "/settings";
		DisplaySettingsRequest request = new DisplaySettingsRequest(display, displayRev, writer);
		try {
			DisplaySettingsResponse response = restClient.post()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.body(DisplaySettingsResponse.class);
			return PacingDisplaySaveOutcome.saved(response == null ? Map.of() : response.display());
		} catch (RestClientResponseException ex) {
			int statusCode = ex.getStatusCode().value();
			JsonNode body = readBody(ex);
			String error = textField(body, "error");
			if (statusCode == 409 && "stale_settings".equals(error)) {
				return PacingDisplaySaveOutcome.staleSettings(intFieldOrNull(body, "rev"));
			}
			if (statusCode == 409 && "v2_writer_required".equals(error)) {
				return PacingDisplaySaveOutcome.writerRequired();
			}
			throw dashboardFailure("POST", path, ex, body);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: POST " + path, ex);
		}
	}

	@Override
	public List<PacingLibraryEntry> listLibrary(
			HubAssertion assertion, String q, String sort, String shelf, String kind) {
		String header = assertionSigner.sign(assertion);
		try {
			LibraryListResponse response = restClient.get()
					.uri(uriBuilder -> {
						uriBuilder.path(LIBRARY_PATH);
						if (q != null && !q.isBlank()) {
							uriBuilder.queryParam("q", q);
						}
						if (sort != null && !sort.isBlank()) {
							uriBuilder.queryParam("sort", sort);
						}
						if (shelf != null && !shelf.isBlank()) {
							uriBuilder.queryParam("shelf", shelf);
						}
						if (kind != null && !kind.isBlank()) {
							uriBuilder.queryParam("kind", kind);
						}
						return uriBuilder.build();
					})
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.body(LibraryListResponse.class);
			return response == null || response.entries() == null ? List.of() : response.entries();
		} catch (RestClientResponseException ex) {
			throw libraryFailure("GET", LIBRARY_PATH, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: GET " + LIBRARY_PATH, ex);
		}
	}

	@Override
	public PacingLibrarySaveOutcome createLibraryEntry(
			HubAssertion assertion, String kind, String name, String description, Map<String, Object> definition) {
		String header = assertionSigner.sign(assertion);
		LibraryCreateRequest request = new LibraryCreateRequest(kind, name, description, definition, V2_WRITER);
		try {
			LibraryEntryResponse response = restClient.post()
					.uri(LIBRARY_PATH)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.body(LibraryEntryResponse.class);
			return PacingLibrarySaveOutcome.saved(response == null ? null : response.entry());
		} catch (RestClientResponseException ex) {
			PacingLibrarySaveOutcome conflict = libraryConflict(ex);
			if (conflict != null) {
				return conflict;
			}
			throw libraryFailure("POST", LIBRARY_PATH, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: POST " + LIBRARY_PATH, ex);
		}
	}

	@Override
	public PacingLibrarySaveOutcome updateLibraryEntry(
			HubAssertion assertion, String id, String name, String description, Map<String, Object> definition,
			String expectedUpdatedAt) {
		String header = assertionSigner.sign(assertion);
		String path = LIBRARY_PATH + "/" + id;
		LibraryUpdateRequest request = new LibraryUpdateRequest(name, description, definition, expectedUpdatedAt);
		try {
			LibraryEntryResponse response = restClient.put()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.body(LibraryEntryResponse.class);
			return PacingLibrarySaveOutcome.saved(response == null ? null : response.entry());
		} catch (RestClientResponseException ex) {
			PacingLibrarySaveOutcome conflict = libraryConflict(ex);
			if (conflict != null) {
				return conflict;
			}
			throw libraryFailure("PUT", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: PUT " + path, ex);
		}
	}

	@Override
	public PacingLibrarySaveOutcome deleteLibraryEntry(HubAssertion assertion, String id, String expectedUpdatedAt) {
		String header = assertionSigner.sign(assertion);
		String path = LIBRARY_PATH + "/" + id;
		LibraryDeleteRequest request = new LibraryDeleteRequest(expectedUpdatedAt);
		try {
			LibraryDeleteResponse response = restClient.method(HttpMethod.DELETE)
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.body(LibraryDeleteResponse.class);
			return PacingLibrarySaveOutcome.deleted(response == null ? id : response.id());
		} catch (RestClientResponseException ex) {
			PacingLibrarySaveOutcome conflict = libraryConflict(ex);
			if (conflict != null) {
				return conflict;
			}
			throw libraryFailure("DELETE", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: DELETE " + path, ex);
		}
	}

	@Override
	public PacingLikeResult likeLibraryEntry(HubAssertion assertion, String id, boolean liked) {
		String header = assertionSigner.sign(assertion);
		String path = LIBRARY_PATH + "/" + id + "/like";
		HttpMethod method = liked ? HttpMethod.POST : HttpMethod.DELETE;
		try {
			PacingLikeResult response = restClient.method(method)
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.body(PacingLikeResult.class);
			return response == null ? new PacingLikeResult(liked, 0) : response;
		} catch (RestClientResponseException ex) {
			throw libraryFailure(method.name(), path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: " + method + " " + path, ex);
		}
	}

	@Override
	public PacingValidateResult validateCampaign(HubAssertion assertion, String campaignId) {
		String header = assertionSigner.sign(assertion);
		ValidateRequest request = new ValidateRequest(campaignId);
		try {
			PacingValidateResult response = restClient.post()
					.uri(VALIDATE_PATH)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.body(PacingValidateResult.class);
			if (response == null) {
				throw new PacingExternalException(
						PacingFailureReason.OTHER,
						"Pacing request failed: POST " + VALIDATE_PATH + " returned an empty body");
			}
			return response;
		} catch (RestClientResponseException ex) {
			throw pacingActionFailure("POST", VALIDATE_PATH, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: POST " + VALIDATE_PATH, ex);
		}
	}

	@Override
	public PacingCreateResult createPacing(
			HubAssertion assertion, String pacingName, List<PacingCreateLineItem> lineItems) {
		String header = assertionSigner.sign(assertion);
		List<LineItemCreateRequest> wireLineItems = lineItems.stream().map(this::toWireLineItem).toList();
		CreateRequest request = new CreateRequest(pacingName, wireLineItems);
		try {
			CreateResponse response = restClient.post()
					.uri(PACINGS_PATH)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.body(CreateResponse.class);
			if (response == null) {
				throw new PacingExternalException(
						PacingFailureReason.OTHER,
						"Pacing request failed: POST " + PACINGS_PATH + " returned an empty body");
			}
			return new PacingCreateResult(response.pacingId(), response.dashSlug());
		} catch (RestClientResponseException ex) {
			throw pacingActionFailure("POST", PACINGS_PATH, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: POST " + PACINGS_PATH, ex);
		}
	}

	@Override
	public void savePlan(HubAssertion assertion, String slug, List<PacingLineItemPlanUpdate> lineItems) {
		String header = assertionSigner.sign(assertion);
		String path = DASHBOARDS_PATH + "/" + slug + "/settings";
		List<LineItemPlanUpdateRequest> wireLineItems = lineItems.stream().map(this::toWirePlanLineItem).toList();
		PlanSettingsRequest request = new PlanSettingsRequest(wireLineItems);
		try {
			restClient.post()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.toBodilessEntity();
		} catch (RestClientResponseException ex) {
			throw planSaveFailure(path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: POST " + path, ex);
		}
	}

	private LineItemPlanUpdateRequest toWirePlanLineItem(PacingLineItemPlanUpdate li) {
		return new LineItemPlanUpdateRequest(
				li.lineItemId(), li.channel(), li.description(), li.campaignId(), li.campaignName(),
				li.orderNumber(), li.rateType(), li.nativeBudget(), li.targetImpressions(), li.marginPercent(),
				li.targetCtr(), li.targetVcr(), li.flightStart(), li.flightEnd(), li.containers());
	}

	@Override
	public void saveDataSettings(HubAssertion assertion, String slug, PacingDataSettings settings) {
		String header = assertionSigner.sign(assertion);
		String path = DASHBOARDS_PATH + "/" + slug + "/settings";
		DataSettingsRequest request = new DataSettingsRequest(toWireDataNamespace(settings));
		try {
			restClient.post()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.toBodilessEntity();
		} catch (RestClientResponseException ex) {
			throw dashboardFailure("POST", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: POST " + path, ex);
		}
	}

	/**
	 * Renames the settings to the snake_case keys Pacing's {@code config.data} namespace stores.
	 *
	 * @param settings the settings to write; null fields stay null and are dropped on serialization
	 * @return the wire shape of the {@code data} object
	 */
	private DataNamespaceRequest toWireDataNamespace(PacingDataSettings settings) {
		return new DataNamespaceRequest(
				settings.source(), settings.fetchCreatives(), settings.fetchConversions(),
				settings.dimSources());
	}

	@Override
	public void saveNotifySettings(HubAssertion assertion, String slug, PacingNotifySettings settings) {
		String header = assertionSigner.sign(assertion);
		String path = DASHBOARDS_PATH + "/" + slug + "/settings";
		NotifySettingsRequest request = new NotifySettingsRequest(settings);
		try {
			restClient.post()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.toBodilessEntity();
		} catch (RestClientResponseException ex) {
			throw dashboardFailure("POST", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: POST " + path, ex);
		}
	}

	@Override
	public List<PacingJournalEntry> addJournalEntry(HubAssertion assertion, String slug, String message, String date) {
		String header = assertionSigner.sign(assertion);
		String path = DASHBOARDS_PATH + "/" + slug + "/journal";
		JournalWriteRequest request = new JournalWriteRequest(message, date);
		try {
			JournalResponse response = restClient.post()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.body(JournalResponse.class);
			return response == null || response.journal() == null ? List.of() : response.journal();
		} catch (RestClientResponseException ex) {
			throw journalFailure("POST", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: POST " + path, ex);
		}
	}

	@Override
	public List<PacingJournalEntry> updateJournalEntry(
			HubAssertion assertion, String slug, String entryId, String message, String date) {
		String header = assertionSigner.sign(assertion);
		String path = DASHBOARDS_PATH + "/" + slug + "/journal/" + entryId;
		JournalWriteRequest request = new JournalWriteRequest(message, date);
		try {
			JournalResponse response = restClient.patch()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.body(JournalResponse.class);
			return response == null || response.journal() == null ? List.of() : response.journal();
		} catch (RestClientResponseException ex) {
			throw journalFailure("PATCH", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: PATCH " + path, ex);
		}
	}

	@Override
	public List<PacingJournalEntry> deleteJournalEntry(HubAssertion assertion, String slug, String entryId) {
		String header = assertionSigner.sign(assertion);
		String path = DASHBOARDS_PATH + "/" + slug + "/journal/" + entryId;
		try {
			JournalResponse response = restClient.delete()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.body(JournalResponse.class);
			return response == null || response.journal() == null ? List.of() : response.journal();
		} catch (RestClientResponseException ex) {
			throw journalFailure("DELETE", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: DELETE " + path, ex);
		}
	}

	@Override
	public List<PacingDelegation> listDelegations(HubAssertion assertion) {
		String header = assertionSigner.sign(assertion);
		try {
			DelegationListResponse response = restClient.get()
					.uri(DELEGATIONS_PATH)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.body(DelegationListResponse.class);
			// An empty list is an answer - nobody has delegated anything. Only a missing BODY is a
			// failure, and it is the same failure every other read here reports.
			if (response == null) {
				throw new PacingExternalException(
						PacingFailureReason.OTHER,
						"Pacing request failed: GET " + DELEGATIONS_PATH + " returned an empty body");
			}
			return response.delegations() == null ? List.of()
					: response.delegations().stream().map(this::toDelegation).toList();
		} catch (RestClientResponseException ex) {
			throw dashboardFailure("GET", DELEGATIONS_PATH, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: GET " + DELEGATIONS_PATH, ex);
		}
	}

	@Override
	public void createDelegation(HubAssertion assertion, PacingDelegationGrant grant) {
		String header = assertionSigner.sign(assertion);
		DelegationCreateRequest request = new DelegationCreateRequest(
				grant.delegateId(), grant.startsAt(), grant.expiresAt(), grant.reason(),
				grant.pacingIds() == null || grant.pacingIds().isEmpty() ? null : grant.pacingIds());
		try {
			restClient.post()
					.uri(DELEGATIONS_PATH)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.toBodilessEntity();
		} catch (RestClientResponseException ex) {
			throw delegationFailure("POST", DELEGATIONS_PATH, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: POST " + DELEGATIONS_PATH, ex);
		}
	}

	@Override
	public void extendDelegation(HubAssertion assertion, String delegationId, String expiresAt) {
		String header = assertionSigner.sign(assertion);
		String path = DELEGATIONS_PATH + "/" + delegationId;
		try {
			restClient.patch()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(new DelegationExtendRequest(expiresAt))
					.retrieve()
					.toBodilessEntity();
		} catch (RestClientResponseException ex) {
			throw delegationFailure("PATCH", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: PATCH " + path, ex);
		}
	}

	@Override
	public void revokeDelegation(HubAssertion assertion, String delegationId) {
		String header = assertionSigner.sign(assertion);
		String path = DELEGATIONS_PATH + "/" + delegationId;
		try {
			restClient.delete()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.toBodilessEntity();
		} catch (RestClientResponseException ex) {
			throw delegationFailure("DELETE", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: DELETE " + path, ex);
		}
	}

	/**
	 * Renames one delegation row from Pacing's snake_case wire shape.
	 *
	 * @param row the wire row
	 * @return the delegation
	 */
	private PacingDelegation toDelegation(DelegationRow row) {
		return new PacingDelegation(
				row.delegation_id(), row.delegator_id(), row.delegator_name(), row.delegator_email(),
				row.delegate_id(), row.delegate_name(), row.delegate_email(),
				row.starts_at(), row.expires_at(), row.reason(),
				row.pacing_id(), row.scope_pacing_name(), row.scope_dash_slug(), row.pacing_count());
	}

	/**
	 * Maps a non-2xx delegation response to a {@link PacingExternalException}.
	 *
	 * <p>Its own describer for one case the shared helper has no words for: 409
	 * {@code would_shorten_active}. Pacing refuses to quietly cut an active grant short and answers
	 * with the date the existing one runs to - and that date IS the message. "Conflict" without it
	 * tells the delegator nothing about what to do next, which is either to pick a later date or to
	 * revoke the grant they forgot they had made.
	 *
	 * <p>Everything else - the rule refusals on 400, the 403/404s - has a plain {@code error} code and
	 * an optional {@code detail}, exactly the shape {@link #dashboardFailure} already reads.
	 *
	 * @param method the HTTP method that was called
	 * @param path   the path that was called
	 * @param ex     the response exception
	 * @return the mapped exception, ready to throw
	 */
	private PacingExternalException delegationFailure(
			String method, String path, RestClientResponseException ex) {
		JsonNode body = readBody(ex);
		if (ex.getStatusCode().value() == 409) {
			String until = textField(body, "existing_expires_at");
			String pacing = textField(body, "pacing_name");
			String detail = "An active delegation already runs to " + (until == null ? "a later date" : until)
					+ (pacing == null ? "" : " for " + pacing)
					+ ". Revoke it first, or pick a date on or after that one.";
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_BAD_REQUEST,
					"Pacing request failed: " + method + " " + path + " returned HTTP 409 (would_shorten_active)",
					detail);
		}
		return dashboardFailure(method, path, ex, body);
	}

	/**
	 * Maps a non-2xx {@code POST /api/dashboards/:slug/settings} plan-only save to a
	 * {@link PacingExternalException}. Distinct from {@link #dashboardFailure} only for
	 * {@code bad_coef_config} (§9, US-125's "invalid combination is rejected with a message naming the
	 * field"): that error carries a structured {@code details} array, not a plain {@code detail}
	 * string, so it needs its own describer ({@link #describeCoefErrors}) - every other 400/401/403/
	 * 404/500 shape on this endpoint is identical to the display save's, so those fall through to the
	 * shared helper.
	 *
	 * @param path the path that was called
	 * @param ex   the response exception
	 * @return the mapped exception, ready to throw
	 */
	private PacingExternalException planSaveFailure(String path, RestClientResponseException ex) {
		int statusCode = ex.getStatusCode().value();
		JsonNode body = readBody(ex);
		if (statusCode == 400) {
			String error = textField(body, "error");
			String detail = "bad_coef_config".equals(error)
					? describeCoefErrors(body.get("details"))
					: (textField(body, "detail") != null ? textField(body, "detail") : describeErrorCode(error));
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_BAD_REQUEST,
					"Pacing request failed: POST " + path + " returned HTTP 400 (" + error + ")",
					detail);
		}
		return dashboardFailure("POST", path, ex, body);
	}

	/**
	 * Turns dash-gate's structured {@code bad_coef_config} error - one entry per offending line item,
	 * each carrying {@code PacingCore.validateCoefLi}'s own error codes ({@code coef_margin_range},
	 * {@code coef_margin_overlap}, {@code coef_not_boolean}) - into one human sentence per offense,
	 * naming both the line item and the exact field/location, per US-125's acceptance criteria. Falls
	 * back to a generic sentence only if the shape is not what dash-gate is documented to send, so a
	 * future code this describer does not yet know about still surfaces as something rather than
	 * nothing.
	 *
	 * @param details the response body's {@code details} array, or null
	 * @return a human-readable sentence naming every offending line item and field
	 */
	private String describeCoefErrors(JsonNode details) {
		if (details == null || !details.isArray() || details.isEmpty()) {
			return "one or more line items have an invalid coefficient-cost margin";
		}
		List<String> parts = new ArrayList<>();
		for (JsonNode entry : details) {
			String lineItemId = textField(entry, "line_item_id");
			JsonNode errors = entry.get("errors");
			if (errors == null || !errors.isArray()) {
				continue;
			}
			for (JsonNode err : errors) {
				String code = textField(err, "code");
				String where = textField(err, "where");
				String message;
				if ("coef_margin_range".equals(code)) {
					message = (where == null ? "its margin" : where)
							+ " is out of range (coefficient-cost margin must be 0-99.99)";
				} else if ("coef_margin_overlap".equals(code)) {
					message = "overlapping coefficient-cost margins on " + textField(err, "a") + " and "
							+ textField(err, "b");
				} else if ("coef_not_boolean".equals(code)) {
					message = "coefficient-cost flag must be true or false";
				} else {
					message = code == null ? "invalid coefficient-cost configuration" : code;
				}
				parts.add("line item " + lineItemId + ": " + message);
			}
		}
		return parts.isEmpty()
				? "one or more line items have an invalid coefficient-cost margin"
				: String.join("; ", parts);
	}

	@Override
	public PacingAddableLineItems getAddableLineItems(HubAssertion assertion, String slug) {
		String header = assertionSigner.sign(assertion);
		String path = DASHBOARDS_PATH + "/" + slug + "/addable-line-items";
		try {
			PacingAddableLineItems response = restClient.get()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.body(PacingAddableLineItems.class);
			if (response == null) {
				throw new PacingExternalException(
						PacingFailureReason.OTHER, "Pacing request failed: GET " + path + " returned an empty body");
			}
			return response;
		} catch (RestClientResponseException ex) {
			throw dashboardFailure("GET", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: GET " + path, ex);
		}
	}

	@Override
	public PacingValidateResult validateLineItems(HubAssertion assertion, List<String> lineItemIds) {
		String header = assertionSigner.sign(assertion);
		LineItemsValidateRequest request = new LineItemsValidateRequest(lineItemIds);
		try {
			PacingValidateResult response = restClient.post()
					.uri(VALIDATE_PATH)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.body(PacingValidateResult.class);
			if (response == null) {
				throw new PacingExternalException(
						PacingFailureReason.OTHER,
						"Pacing request failed: POST " + VALIDATE_PATH + " returned an empty body");
			}
			return response;
		} catch (RestClientResponseException ex) {
			throw pacingActionFailure("POST", VALIDATE_PATH, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: POST " + VALIDATE_PATH, ex);
		}
	}

	@Override
	public void updateStatus(HubAssertion assertion, String pacingId, String status) {
		String header = assertionSigner.sign(assertion);
		String path = PACINGS_PATH + "/" + pacingId + "/status";
		StatusUpdateRequest request = new StatusUpdateRequest(status);
		try {
			restClient.patch()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.toBodilessEntity();
		} catch (RestClientResponseException ex) {
			throw dashboardFailure("PATCH", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: PATCH " + path, ex);
		}
	}

	/**
	 * Reassigns a pacing to another person (§11, US-131).
	 *
	 * <p>Deliberately thin: Pacing checks that both the pacing and the recipient are inside the
	 * asserted scope, and journals who made the change. Repeating either check here would give two
	 * places for the answer to differ.
	 *
	 * @param assertion  who is calling and what they may see
	 * @param pacingId   the pacing id
	 * @param newOwnerId the recipient's Pacing user id
	 */
	@Override
	public void transferOwner(HubAssertion assertion, String pacingId, String newOwnerId) {
		String header = assertionSigner.sign(assertion);
		String path = PACINGS_PATH + "/" + pacingId + "/owner";
		OwnerTransferRequest request = new OwnerTransferRequest(newOwnerId);
		try {
			restClient.patch()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.toBodilessEntity();
		} catch (RestClientResponseException ex) {
			throw dashboardFailure("PATCH", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: PATCH " + path, ex);
		}
	}

	@Override
	public void deletePacing(HubAssertion assertion, String pacingId) {
		String header = assertionSigner.sign(assertion);
		String path = PACINGS_PATH + "/" + pacingId;
		try {
			restClient.delete()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.toBodilessEntity();
		} catch (RestClientResponseException ex) {
			throw adminActionFailure("DELETE", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: DELETE " + path, ex);
		}
	}

	@Override
	public PacingRefreshOutcome refreshAllDashboards(HubAssertion assertion) {
		String header = assertionSigner.sign(assertion);
		try {
			restClient.post()
					.uri(ADMIN_REFRESH_ALL_PATH)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.toBodilessEntity();
			return PacingRefreshOutcome.triggered();
		} catch (RestClientResponseException ex) {
			int statusCode = ex.getStatusCode().value();
			JsonNode body = readBody(ex);
			if (statusCode == 429) {
				// Same cooldown shape as refreshPacing - not a failure, the caller shows the countdown.
				int retryAfterSeconds = intField(body, "retry_after_sec", 320);
				return PacingRefreshOutcome.cooldown(retryAfterSeconds);
			}
			throw adminActionFailure("POST", ADMIN_REFRESH_ALL_PATH, ex, body);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: POST " + ADMIN_REFRESH_ALL_PATH, ex);
		}
	}

	@Override
	public PacingRevalidateResult revalidatePacing(HubAssertion assertion, String pacingId) {
		String header = assertionSigner.sign(assertion);
		String path = PACINGS_PATH + "/" + pacingId + "/revalidate";
		try {
			RevalidateResponse response = restClient.post()
					.uri(path)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.body(RevalidateResponse.class);
			if (response == null) {
				return new PacingRevalidateResult(false, List.of(), List.of());
			}
			return new PacingRevalidateResult(
					response.changed(),
					response.changes() == null ? List.of() : List.copyOf(response.changes()),
					response.warnings() == null ? List.of() : List.copyOf(response.warnings()));
		} catch (RestClientResponseException ex) {
			if (ex.getStatusCode().value() == 502) {
				// Pacing reached us fine; it is the NetSuite master behind it that did not answer. That
				// is an upstream-of-the-upstream outage, not a bug in the request - the caller should
				// see "try again later", which is what UNREACHABLE renders as (503).
				throw new PacingExternalException(
						PacingFailureReason.UNREACHABLE,
						"Pacing request failed: POST " + path + " returned HTTP 502 (ns_master_error)", ex);
			}
			throw adminActionFailure("POST", path, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: POST " + path, ex);
		}
	}

	@Override
	public PacingAccount getAccount(HubAssertion assertion) {
		String header = assertionSigner.sign(assertion);
		try {
			MeResponse response = restClient.get()
					.uri(ME_PATH)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.retrieve()
					.body(MeResponse.class);
			if (response == null) {
				throw new PacingExternalException(
						PacingFailureReason.OTHER, "Pacing request failed: GET " + ME_PATH + " returned an empty body");
			}
			// slackWarning is null here on purpose - Pacing never sets it on a GET, only on a PATCH
			// that just changed the value (see PacingAccount's own doc).
			return new PacingAccount(response.notify_destination(), nullToEmpty(response.slack_channel_id()), null);
		} catch (RestClientResponseException ex) {
			throw dashboardFailure("GET", ME_PATH, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: GET " + ME_PATH, ex);
		}
	}

	@Override
	public PacingAccount updateAccount(HubAssertion assertion, String notifyDestination, String slackChannelId) {
		String header = assertionSigner.sign(assertion);
		AccountUpdateRequest request = new AccountUpdateRequest(notifyDestination, slackChannelId);
		try {
			AccountUpdateResponse response = restClient.patch()
					.uri(ME_PATH)
					.header(HubAssertionSigner.HEADER_NAME, header)
					.contentType(MediaType.APPLICATION_JSON)
					.body(request)
					.retrieve()
					.body(AccountUpdateResponse.class);
			if (response == null) {
				return new PacingAccount(notifyDestination, nullToEmpty(slackChannelId), null);
			}
			return new PacingAccount(
					response.notify_destination(), nullToEmpty(response.slack_channel_id()), response.slack_warning());
		} catch (RestClientResponseException ex) {
			throw dashboardFailure("PATCH", ME_PATH, ex);
		} catch (RestClientException ex) {
			throw new PacingExternalException(
					PacingFailureReason.UNREACHABLE, "Pacing request failed: PATCH " + ME_PATH, ex);
		}
	}

	/**
	 * Pacing's {@code slack_channel_id} is SQL NULL until someone sets it; this contract's
	 * {@code PacingAccountV1.slackChannelId} is required and non-nullable, so every read coerces
	 * NULL to an empty string rather than pushing the nullability down into the generated model.
	 *
	 * @param value the raw value from Pacing, possibly null
	 * @return {@code value}, or {@code ""} if it was null
	 */
	private String nullToEmpty(String value) {
		return value == null ? "" : value;
	}

	private LineItemCreateRequest toWireLineItem(PacingCreateLineItem li) {
		return new LineItemCreateRequest(
				li.lineItemId(), li.channel(), li.flightStart(), li.flightEnd(), li.rateType(), li.nativeBudget(),
				li.description(), li.currency(), li.exchangeRate(), li.campaignId(), li.campaignName(),
				li.orderNumber(), li.mpoTeamLead(), li.targetImpressions(), li.marginPercent(), li.targetCtr(),
				li.targetVcr());
	}

	/**
	 * Maps a non-2xx {@code POST /api/pacings/validate} or {@code POST /api/pacings} response (§8 of
	 * the migration plan) to a {@link PacingExternalException}. A 403 here follows the same uniform
	 * rule every mapper in this class now applies (see {@link PacingFailureReason}): {@code unknown_user}
	 * (which only occurs on create, from {@code server.mjs}'s pre-routing user-mirror check) is a sync
	 * gap, not a refusal; any other reason - most notably {@code no_create_permission}, the caller's
	 * assertion not carrying {@code canCreate} - is a real authorization decision.
	 *
	 * <p>A 429 ({@code rate_limit_exceeded}) collapses to {@link PacingFailureReason#OTHER} (500) -
	 * unlike {@code libraryFailure}'s 429 handling, which now maps to the typed
	 * {@link PacingFailureReason#UPSTREAM_RATE_LIMITED}, this one stays generic: validate/create's rate
	 * limit is a per-minute abuse guard, not a "you just did this" cooldown with a countdown worth
	 * showing.
	 *
	 * @param method the HTTP method that was called
	 * @param path   the path that was called
	 * @param ex     the response exception
	 * @return the mapped exception, ready to throw
	 */
	private PacingExternalException pacingActionFailure(String method, String path, RestClientResponseException ex) {
		int statusCode = ex.getStatusCode().value();
		JsonNode body = readBody(ex);
		String error = textField(body, "error");
		if (statusCode == 403 && error != null && !"unknown_user".equals(error)) {
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_FORBIDDEN,
					"Pacing request failed: " + method + " " + path + " returned HTTP 403 (" + error + ")");
		}
		if (statusCode == 400) {
			// Some 400 bodies carry a proper `detail` (e.g. invalid_order_number/invalid_line_item_id);
			// others only carry `error`, and that value is itself already a full sentence for most of
			// this pair's own validation failures ("pacing_name and line_items required", "every line
			// item needs flight_start and flight_end (YYYY-MM-DD)") rather than a short machine code -
			// forwarded as-is when it reads like one, falling back to describeErrorCode only for the
			// genuine short codes (mixed_currency, bad_coef_config).
			String detail = textField(body, "detail");
			String message = detail != null ? detail : describePacingActionErrorCode(error);
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_BAD_REQUEST,
					"Pacing request failed: " + method + " " + path + " returned HTTP 400",
					message);
		}
		PacingFailureReason reason = switch (statusCode) {
			case 401 -> PacingFailureReason.UPSTREAM_UNAUTHORIZED;
			// Reached only when error was unknown_user (or unreadable) - the 403 branch above already
			// claimed every other reason.
			case 403 -> PacingFailureReason.UPSTREAM_USER_NOT_SYNCED;
			case 404 -> PacingFailureReason.UPSTREAM_NOT_FOUND;
			default -> PacingFailureReason.OTHER;
		};
		return new PacingExternalException(
				reason, "Pacing request failed: " + method + " " + path + " returned HTTP " + statusCode, ex);
	}

	/**
	 * Turns one of validate/create's short machine error codes into a human sentence fragment, for the
	 * few 400s whose {@code error} is not already a full sentence. Falls back to the raw code so a code
	 * added on the Pacing side without a Hub-side update still surfaces as something.
	 *
	 * @param errorCode Pacing's short machine error code, or null
	 * @return a human-readable fragment describing it
	 */
	private String describePacingActionErrorCode(String errorCode) {
		if (errorCode == null) {
			return "invalid request";
		}
		return switch (errorCode) {
			case "mixed_currency" ->
					"the selected line items span more than one non-USD currency; a pacing can only have one";
			case "bad_coef_config" -> "one or more line items have an invalid coefficient-cost margin";
			case "unknown_user" -> "unknown_user";
			default -> errorCode;
		};
	}

	/**
	 * Dash-gate's fixed v2 widget-writer capability marker, required by {@code libWriterGate} on
	 * every library write. The Hub only ever writes v2 widget shapes, so this is a constant, never
	 * negotiated at runtime.
	 */
	private static final Map<String, Object> V2_WRITER = Map.of("contextWidgetSpec", 2, "contextWidgetUnification", 2);

	/**
	 * Parses a non-2xx response body as JSON, for the endpoints whose failure body carries structured
	 * data the caller needs (a countdown, a revision, a conflict stamp). Returns an empty object node
	 * (never null) so field lookups on the result don't need their own null-check - Pacing's error
	 * bodies are always JSON, but a malformed/empty body degrades to "no fields present" rather than a
	 * second exception masking the first.
	 *
	 * @param ex the response exception whose body to parse
	 * @return the parsed body, or an empty object node if it was missing/unparseable
	 */
	private JsonNode readBody(RestClientResponseException ex) {
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

	private String textField(JsonNode node, String field) {
		JsonNode value = node.get(field);
		return value == null || value.isNull() ? null : value.asText();
	}

	private int intField(JsonNode node, String field, int fallback) {
		JsonNode value = node.get(field);
		return value == null || value.isNull() ? fallback : value.asInt(fallback);
	}

	private Integer intFieldOrNull(JsonNode node, String field) {
		JsonNode value = node.get(field);
		return value == null || value.isNull() ? null : value.asInt();
	}

	/**
	 * Maps a non-2xx {@code /api/dashboards/*} or {@code /api/pacings/:id/refresh} response to a
	 * {@link PacingExternalException}, forwarding Pacing's own {@code error}/{@code detail} for a 400
	 * so the caller sees which part of the request was rejected. A 403 follows the uniform rule
	 * documented on {@link PacingFailureReason}: {@code unknown_user} is a sync gap
	 * ({@link PacingFailureReason#UPSTREAM_USER_NOT_SYNCED}), any other reason is a real authorization
	 * decision ({@link PacingFailureReason#UPSTREAM_FORBIDDEN}).
	 *
	 * @param method the HTTP method that was called
	 * @param path   the path that was called
	 * @param ex     the response exception
	 * @return the mapped exception, ready to throw
	 */
	private PacingExternalException dashboardFailure(String method, String path, RestClientResponseException ex) {
		return dashboardFailure(method, path, ex, readBody(ex));
	}

	/**
	 * As {@link #dashboardFailure(String, String, RestClientResponseException)}, but reusing a body
	 * already parsed by the caller instead of parsing it again.
	 *
	 * @param method the HTTP method that was called
	 * @param path   the path that was called
	 * @param ex     the response exception
	 * @param body   the already-parsed response body
	 * @return the mapped exception, ready to throw
	 */
	private PacingExternalException dashboardFailure(
			String method, String path, RestClientResponseException ex, JsonNode body) {
		int statusCode = ex.getStatusCode().value();
		String error = textField(body, "error");
		if (statusCode == 400) {
			String detail = textField(body, "detail");
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_BAD_REQUEST,
					"Pacing request failed: " + method + " " + path + " returned HTTP 400",
					detail != null ? detail : describeErrorCode(error));
		}
		if (statusCode == 403 && error != null && !"unknown_user".equals(error)) {
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_FORBIDDEN,
					"Pacing request failed: " + method + " " + path + " returned HTTP 403 (" + error + ")");
		}
		PacingFailureReason reason = switch (statusCode) {
			case 401 -> PacingFailureReason.UPSTREAM_UNAUTHORIZED;
			case 403 -> PacingFailureReason.UPSTREAM_USER_NOT_SYNCED;
			case 404 -> PacingFailureReason.UPSTREAM_NOT_FOUND;
			default -> PacingFailureReason.OTHER;
		};
		return new PacingExternalException(
				reason, "Pacing request failed: " + method + " " + path + " returned HTTP " + statusCode, ex);
	}

	/**
	 * Maps a non-2xx {@code /api/dashboards/:slug/journal[/:entryId]} response (§15, US-139) to a
	 * {@link PacingExternalException}. A 403 follows the same uniform rule as the rest of this class
	 * (see {@link PacingFailureReason}): {@code unknown_user} is a sync gap
	 * ({@link PacingFailureReason#UPSTREAM_USER_NOT_SYNCED}); anything else - {@code no_access} (the
	 * caller has no dashboard access to this pacing at all), or on the edit path "neither this entry's
	 * author nor an admin" - is a real authorization decision
	 * ({@link PacingFailureReason#UPSTREAM_FORBIDDEN}).
	 *
	 * <p>A 429 ({@code too_fast}, the {@code journal} bucket's 6/min-per-user cap - POST and PATCH only,
	 * dash-gate does not rate-limit DELETE) maps to {@link PacingFailureReason#UPSTREAM_RATE_LIMITED}, not
	 * {@link PacingFailureReason#OTHER}: a person writing a seventh note in a minute should see "wait a
	 * moment", not "something went wrong" ({@link #libraryFailure}'s 429 now maps the same way). The
	 * countdown itself ({@code retry_after}) is not surfaced here: the typed cooldown outcome
	 * {@link #refreshPacing} uses would require changing this method's return type, which is out of
	 * scope for this fix.
	 *
	 * @param method the HTTP method that was called
	 * @param path   the path that was called
	 * @param ex     the response exception
	 * @return the mapped exception, ready to throw
	 */
	PacingExternalException journalFailure(String method, String path, RestClientResponseException ex) {
		int statusCode = ex.getStatusCode().value();
		JsonNode body = readBody(ex);
		String error = textField(body, "error");
		if (statusCode == 400) {
			String detail = textField(body, "detail");
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_BAD_REQUEST,
					"Pacing request failed: " + method + " " + path + " returned HTTP 400",
					detail != null ? detail : describeErrorCode(error));
		}
		if (statusCode == 403 && error != null && !"unknown_user".equals(error)) {
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_FORBIDDEN,
					"Pacing request failed: " + method + " " + path + " returned HTTP 403 (" + error + ")");
		}
		if (statusCode == 429) {
			int retryAfterSeconds = intField(body, "retry_after", 60);
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_RATE_LIMITED,
					"Pacing request failed: " + method + " " + path
							+ " returned HTTP 429 (too_fast, retry after " + retryAfterSeconds + "s)");
		}
		PacingFailureReason reason = switch (statusCode) {
			case 401 -> PacingFailureReason.UPSTREAM_UNAUTHORIZED;
			case 403 -> PacingFailureReason.UPSTREAM_USER_NOT_SYNCED;
			case 404 -> PacingFailureReason.UPSTREAM_NOT_FOUND;
			default -> PacingFailureReason.OTHER;
		};
		return new PacingExternalException(
				reason, "Pacing request failed: " + method + " " + path + " returned HTTP " + statusCode, ex);
	}

	/**
	 * Maps a non-2xx {@code /api/pacings/:id} (delete) or {@code /api/admin/*} response to a
	 * {@link PacingExternalException}. A 403 follows the same uniform rule as the rest of this class
	 * (see {@link PacingFailureReason}): {@code unknown_user} - {@code server.mjs}'s pre-routing
	 * user-mirror check, which can land on any endpoint - is a sync gap
	 * ({@link PacingFailureReason#UPSTREAM_USER_NOT_SYNCED}); any other reason, most commonly this
	 * pair's own {@code admin_only} gate, is a real authorization decision
	 * ({@link PacingFailureReason#UPSTREAM_FORBIDDEN}).
	 *
	 * @param method the HTTP method that was called
	 * @param path   the path that was called
	 * @param ex     the response exception
	 * @return the mapped exception, ready to throw
	 */
	private PacingExternalException adminActionFailure(String method, String path, RestClientResponseException ex) {
		return adminActionFailure(method, path, ex, readBody(ex));
	}

	/**
	 * As {@link #adminActionFailure(String, String, RestClientResponseException)}, but reusing a body
	 * already parsed by the caller instead of parsing it again.
	 *
	 * @param method the HTTP method that was called
	 * @param path   the path that was called
	 * @param ex     the response exception
	 * @param body   the already-parsed response body
	 * @return the mapped exception, ready to throw
	 */
	private PacingExternalException adminActionFailure(
			String method, String path, RestClientResponseException ex, JsonNode body) {
		int statusCode = ex.getStatusCode().value();
		if (statusCode == 403) {
			String error = textField(body, "error");
			if (error != null && !"unknown_user".equals(error)) {
				return new PacingExternalException(
						PacingFailureReason.UPSTREAM_FORBIDDEN,
						"Pacing request failed: " + method + " " + path + " returned HTTP 403 (" + error + ")");
			}
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_USER_NOT_SYNCED,
					"Pacing request failed: " + method + " " + path + " returned HTTP 403", ex);
		}
		if (statusCode == 404) {
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_NOT_FOUND,
					"Pacing request failed: " + method + " " + path + " returned HTTP 404");
		}
		if (statusCode == 400) {
			String detail = textField(body, "detail");
			String error = textField(body, "error");
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_BAD_REQUEST,
					"Pacing request failed: " + method + " " + path + " returned HTTP 400",
					detail != null ? detail : describeErrorCode(error));
		}
		PacingFailureReason reason =
				statusCode == 401 ? PacingFailureReason.UPSTREAM_UNAUTHORIZED : PacingFailureReason.OTHER;
		return new PacingExternalException(
				reason, "Pacing request failed: " + method + " " + path + " returned HTTP " + statusCode, ex);
	}

	/**
	 * Maps a non-2xx {@code /api/library*} response that is not one of the structured conflicts
	 * {@link #libraryConflict} already peeled off (a plain validation failure, an author check, a not
	 * found, a rate limit or anything unrecognized) to a {@link PacingExternalException}. A 403 follows
	 * the uniform rule documented on {@link PacingFailureReason}: {@code unknown_user} is a sync gap
	 * ({@link PacingFailureReason#UPSTREAM_USER_NOT_SYNCED}), any other reason is a real authorization
	 * decision ({@link PacingFailureReason#UPSTREAM_FORBIDDEN}).
	 *
	 * <p>A 429 ({@code too_fast}) maps to {@link PacingFailureReason#UPSTREAM_RATE_LIMITED}, not the
	 * generic default: a library save/create/update/delete/like that is merely rate-limited is not a
	 * server error, and the caller should see a typed cooldown rather than a 500.
	 *
	 * @param method the HTTP method that was called
	 * @param path   the path that was called
	 * @param ex     the response exception
	 * @return the mapped exception, ready to throw
	 */
	private PacingExternalException libraryFailure(String method, String path, RestClientResponseException ex) {
		int statusCode = ex.getStatusCode().value();
		JsonNode body = readBody(ex);
		String error = textField(body, "error");
		if (statusCode == 400) {
			String detail = textField(body, "detail");
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_BAD_REQUEST,
					"Pacing request failed: " + method + " " + path + " returned HTTP 400",
					detail != null ? detail : describeErrorCode(error));
		}
		if (statusCode == 403 && error != null && !"unknown_user".equals(error)) {
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_FORBIDDEN,
					"Pacing request failed: " + method + " " + path + " returned HTTP 403 (" + error + ")");
		}
		if (statusCode == 429) {
			int retryAfterSeconds = intField(body, "retry_after", 60);
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_RATE_LIMITED,
					"Pacing request failed: " + method + " " + path
							+ " returned HTTP 429 (too_fast, retry after " + retryAfterSeconds + "s)");
		}
		PacingFailureReason reason = switch (statusCode) {
			case 401 -> PacingFailureReason.UPSTREAM_UNAUTHORIZED;
			case 403 -> PacingFailureReason.UPSTREAM_USER_NOT_SYNCED;
			case 404 -> PacingFailureReason.UPSTREAM_NOT_FOUND;
			default -> PacingFailureReason.OTHER;
		};
		return new PacingExternalException(
				reason, "Pacing request failed: " + method + " " + path + " returned HTTP " + statusCode, ex);
	}

	/**
	 * Peels off the three structured library conflicts ({@code stale_entry}, {@code library_full},
	 * {@code v2_writer_required}) that a caller needs to react to distinctly (US-118) - returns null
	 * for every other status/error, so the caller falls through to {@link #libraryFailure}.
	 *
	 * @param ex the response exception
	 * @return the matching conflict outcome, or null if this is not one of the three
	 */
	private PacingLibrarySaveOutcome libraryConflict(RestClientResponseException ex) {
		if (ex.getStatusCode().value() != 409) {
			return null;
		}
		JsonNode body = readBody(ex);
		String error = textField(body, "error");
		if ("stale_entry".equals(error)) {
			return PacingLibrarySaveOutcome.staleEntry(textField(body, "updated_at"));
		}
		if ("library_full".equals(error)) {
			return PacingLibrarySaveOutcome.libraryFull();
		}
		if ("v2_writer_required".equals(error)) {
			return PacingLibrarySaveOutcome.writerRequired();
		}
		return null;
	}

	/**
	 * Turns one of Pacing's short machine codes into a human sentence fragment, for the (rare) errors
	 * that carry no {@code detail} string of their own. Falls back to the raw code so a code added on
	 * the Pacing side without a Hub-side update still surfaces as something, not a blank message.
	 *
	 * @param errorCode Pacing's short machine error code, or null
	 * @return a human-readable fragment describing it
	 */
	private String describeErrorCode(String errorCode) {
		if (errorCode == null) {
			return "invalid request";
		}
		return switch (errorCode) {
			case "pacing_not_live" -> "the pacing is not Live, so it cannot be refreshed";
			case "mapping_not_portable" ->
					"this widget's mapping is pinned to a specific pacing and cannot be shared";
			case "bad_seed_display" -> "the pacing's default layout could not be seeded";
			case "invalid_notify_destination" -> "the Daily Summary delivery option must be auto, dm or off";
			default -> errorCode;
		};
	}
}
