package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingAddableLineItems;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateLineItem;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLineItemPlanUpdate;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDashboardData;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDataSettings;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDelegation;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDelegationGrant;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDisplaySaveOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibraryEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibrarySaveOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLikeResult;
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
import com.fasterxml.jackson.annotation.JsonProperty;
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

	private LineItemCreateRequest toWireLineItem(PacingCreateLineItem li) {
		return new LineItemCreateRequest(
				li.lineItemId(), li.channel(), li.flightStart(), li.flightEnd(), li.rateType(), li.nativeBudget(),
				li.description(), li.currency(), li.exchangeRate(), li.campaignId(), li.campaignName(),
				li.orderNumber(), li.mpoTeamLead(), li.targetImpressions(), li.marginPercent(), li.targetCtr(),
				li.targetVcr());
	}

	/**
	 * Maps a non-2xx {@code POST /api/pacings/validate} or {@code POST /api/pacings} response (§8 of
	 * the migration plan) to a {@link PacingExternalException}. Distinct from {@link #dashboardFailure}
	 * because a 403 here is a REAL authorization decision ({@code no_create_permission}: the caller's
	 * assertion does not carry {@code canCreate}) alongside the usual sync-gap one
	 * ({@code unknown_user}, create only) - unlike the dashboard/refresh endpoints, where every 403
	 * means the latter.
	 *
	 * <p>A 429 ({@code rate_limit_exceeded}) collapses to {@link PacingFailureReason#OTHER} (500) same
	 * as {@code libraryFailure}'s 429 handling - not the nicer typed cooldown outcome
	 * {@link #refreshPacing} returns, since validate/create's rate limit is a per-minute abuse guard,
	 * not a "you just did this" cooldown with a countdown worth showing.
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
		if (statusCode == 403 && "no_create_permission".equals(error)) {
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_FORBIDDEN,
					"Pacing request failed: " + method + " " + path + " returned HTTP 403 (no_create_permission)");
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
			// unknown_user only occurs on create (the user-row lookup) - no_create_permission (checked
			// above) is validate/create's other, unrelated 403.
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
	 * so the caller sees which part of the request was rejected.
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
		if (statusCode == 400) {
			String detail = textField(body, "detail");
			String error = textField(body, "error");
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_BAD_REQUEST,
					"Pacing request failed: " + method + " " + path + " returned HTTP 400",
					detail != null ? detail : describeErrorCode(error));
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
	 * {@link PacingExternalException}. Unlike {@link #dashboardFailure}, a plain 403 here is treated as
	 * a real authorization decision ({@link PacingFailureReason#UPSTREAM_FORBIDDEN}, i.e.
	 * {@code admin_only}) rather than {@code UPSTREAM_USER_NOT_SYNCED} - these endpoints have no
	 * unsynced-user 403 case at all, only the admin gate, so there is no sync-gap reading to protect.
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
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_FORBIDDEN,
					"Pacing request failed: " + method + " " + path + " returned HTTP 403 (admin_only)");
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
	 * found, a rate limit or anything unrecognized) to a {@link PacingExternalException}.
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
		if (statusCode == 403 && !"unknown_user".equals(error)) {
			return new PacingExternalException(
					PacingFailureReason.UPSTREAM_FORBIDDEN,
					"Pacing request failed: " + method + " " + path + " returned HTTP 403 (" + error + ")");
		}
		if (statusCode == 429) {
			int retryAfterSeconds = intField(body, "retry_after", 60);
			return new PacingExternalException(
					PacingFailureReason.OTHER,
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
			default -> errorCode;
		};
	}

	/**
	 * Shape of Pacing's {@code POST /api/dashboards/:slug/settings} request body, for a display-only
	 * save (the Hub never writes any of the other config fields that endpoint also accepts).
	 *
	 * @param display     the display patch being saved
	 * @param display_rev the revision this save was read at, matched against Pacing's own CAS counter
	 * @param display_writer which display grammar this client can write. Transport, never stored, and
	 *                       NOT optional: a save that changes a v2 widget without it comes back 409
	 *                       {@code v2_writer_required}, which reads to a user as "the editor needs to
	 *                       reload" — a stale-bundle message for a bundle that is not stale. The
	 *                       values are Pacing's own, echoed from the dashboard payload's
	 *                       {@code capabilities}, so this client never asserts a version it invented.
	 */
	private record DisplaySettingsRequest(
			Map<String, Object> display, int display_rev, Map<String, Object> display_writer) {
	}

	/**
	 * Shape of the parts of Pacing's settings-save success response the Hub reads.
	 *
	 * @param display the saved display, echoed back by Pacing
	 */
	private record DisplaySettingsResponse(Map<String, Object> display) {
	}

	/**
	 * Shape of the {@code POST /api/library} request body.
	 *
	 * @param kind        {@code widget}, {@code block} or {@code layout}
	 * @param name        entry display name
	 * @param description entry description, or null
	 * @param definition  the canonical widget/block/layout definition
	 * @param writer      the fixed v2 writer capability marker, see {@link #V2_WRITER}
	 */
	private record LibraryCreateRequest(
			String kind, String name, String description, Map<String, Object> definition, Map<String, Object> writer) {
	}

	/**
	 * Shape of the {@code PUT /api/library/:id} request body.
	 *
	 * @param name        entry display name
	 * @param description entry description, or null
	 * @param definition  the canonical widget definition
	 * @param updated_at  the entry's {@code updatedAt} as last read by the caller (the CAS stamp)
	 */
	private record LibraryUpdateRequest(
			String name, String description, Map<String, Object> definition, String updated_at) {
	}

	/**
	 * Shape of the {@code DELETE /api/library/:id} request body.
	 *
	 * @param updated_at the entry's {@code updatedAt} as last read by the caller (the CAS stamp)
	 */
	private record LibraryDeleteRequest(String updated_at) {
	}

	/**
	 * Shape of a library create/update success response.
	 *
	 * @param entry the saved entry
	 */
	private record LibraryEntryResponse(PacingLibraryEntry entry) {
	}

	/**
	 * Shape of a library delete success response.
	 *
	 * @param id the removed entry's id
	 */
	private record LibraryDeleteResponse(String id) {
	}

	/**
	 * Shape of Pacing's {@code GET /api/library} response body.
	 *
	 * @param entries the matching library entries
	 */
	private record LibraryListResponse(List<PacingLibraryEntry> entries) {
	}

	/**
	 * Shape of Pacing's {@code POST /api/pacings/:pacingId/revalidate} response body. Pacing also
	 * returns {@code ok}; it carries no information beyond the 200 itself and is not read here.
	 *
	 * @param changed  whether anything was written back to the pacing's configuration
	 * @param changes  the field names and line item ids that were updated
	 * @param warnings non-fatal problems met during the re-pull
	 */
	private record RevalidateResponse(boolean changed, List<String> changes, List<String> warnings) {
	}

	/**
	 * Shape of Pacing's {@code GET /api/pacings} response body.
	 *
	 * @param pacings the visible pacings, each row as returned by Pacing
	 */
	private record PacingsResponse(List<PacingRow> pacings) {
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

	/**
	 * Shape of the {@code POST /api/pacings/validate} request body for the campaign-scoped selector
	 * (§8 of the migration plan) - the only selector the Hub uses.
	 *
	 * @param campaign_id the NetSuite campaign id to validate
	 */
	private record ValidateRequest(String campaign_id) {
	}

	/**
	 * Shape of one line item in the {@code POST /api/pacings} request body (§8, US-123/124) - field
	 * names match dash-gate's own create route exactly, same snake_case-field convention as the other
	 * outbound request records in this class (e.g. {@link DisplaySettingsRequest}).
	 *
	 * @param line_item_id        NetSuite line item id
	 * @param channel             delivery channel / media tactic
	 * @param flight_start        flight start date (YYYY-MM-DD)
	 * @param flight_end          flight end date (YYYY-MM-DD)
	 * @param rate_type           billing rate type (CPM/CPC/CPV/Flat)
	 * @param native_budget       the budget in its native currency
	 * @param description         line item description
	 * @param currency            the line item's native currency
	 * @param exchange_rate       the exchange rate for {@code currency}
	 * @param campaign_id         NetSuite campaign id
	 * @param campaign_name       NetSuite campaign name
	 * @param order_number        NetSuite insertion order number
	 * @param mpo_team_lead       who NetSuite records as running the campaign (§11, US-132), stored so
	 *                            the new pacing can show the owner-vs-NetSuite comparison at once
	 * @param target_impressions  the plan's target impressions, as confirmed by the caller
	 * @param margin_percent      the plan's target margin percentage, as confirmed by the caller
	 * @param target_ctr          the plan's target CTR percentage, as confirmed by the caller
	 * @param target_vcr          the plan's target VCR percentage, as confirmed by the caller
	 */
	private record LineItemCreateRequest(
			String line_item_id,
			String channel,
			String flight_start,
			String flight_end,
			String rate_type,
			Double native_budget,
			String description,
			String currency,
			Double exchange_rate,
			String campaign_id,
			String campaign_name,
			String order_number,
			String mpo_team_lead,
			Double target_impressions,
			Double margin_percent,
			Double target_ctr,
			Double target_vcr) {
	}

	/**
	 * Shape of the {@code POST /api/pacings} request body (§8, US-123).
	 *
	 * @param pacing_name display name for the new pacing
	 * @param line_items  the selected line items
	 */
	private record CreateRequest(String pacing_name, List<LineItemCreateRequest> line_items) {
	}

	/**
	 * Shape of Pacing's {@code POST /api/pacings} success (201) response body.
	 *
	 * @param pacingId serialized as {@code pacing_id}
	 * @param dashSlug serialized as {@code dash_slug}
	 */
	private record CreateResponse(
			@JsonProperty("pacing_id") String pacingId, @JsonProperty("dash_slug") String dashSlug) {
	}

	/**
	 * Shape of one line item in the plan-only {@code POST /api/dashboards/:slug/settings} request body
	 * (§9, US-125/126/127) - field names match dash-gate's own settings route exactly, same
	 * snake_case-field convention as {@link LineItemCreateRequest}. {@code containers} rides through
	 * as opaque JSON: Jackson serializes each entry's {@code Map<String, Object>} verbatim, so a
	 * client-built {@code __action}/{@code __source_id}/{@code __scale} duplicate-container marker
	 * (dash-gate's own existing duplicate mechanism) reaches Pacing unchanged.
	 *
	 * @param line_item_id        NetSuite line item id
	 * @param channel             delivery channel / media tactic; required when adding a new id
	 * @param description         line item description
	 * @param campaign_id         NetSuite campaign id
	 * @param campaign_name       NetSuite campaign name
	 * @param order_number        NetSuite insertion order number
	 * @param rate_type           billing rate type (CPM/CPC/CPV/Flat)
	 * @param native_budget       the plan's target spend, in the line item's native currency
	 * @param target_impressions  the plan's target impressions
	 * @param margin_percent      the plan's target margin percentage
	 * @param target_ctr          the plan's target CTR percentage
	 * @param target_vcr          the plan's target VCR percentage
	 * @param flight_start        flight start date (YYYY-MM-DD); required when adding a new id
	 * @param flight_end          flight end date (YYYY-MM-DD); required when adding a new id
	 * @param containers          date-based plan overrides (§9), opaque - forwarded byte-for-byte
	 */
	// NON_NULL (not the class-wide default of always-include): dash-gate's own merge checks
	// `'channel' in newLi` / `'description' in newLi` / `'campaign_id' in newLi` /
	// `'campaign_name' in newLi` to decide whether to PRESERVE the stored value for an id already on
	// the pacing (db.mjs saveSettings) - a JSON key present with an explicit null answers that check
	// true and would overwrite the stored value with null, the opposite of "the Hub never edits this
	// field for an existing line item" (PacingLineItemPlanUpdateV1's own contract). The Hub leaves
	// these four null for every id it did not just look up fresh (an existing line item's plan edit),
	// so they must be OMITTED, not nulled, whenever that happens.
	@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
	private record LineItemPlanUpdateRequest(
			String line_item_id,
			String channel,
			String description,
			String campaign_id,
			String campaign_name,
			String order_number,
			String rate_type,
			Double native_budget,
			Double target_impressions,
			Double margin_percent,
			Double target_ctr,
			Double target_vcr,
			String flight_start,
			String flight_end,
			List<Map<String, Object>> containers) {
	}

	/**
	 * Shape of the plan-only {@code POST /api/dashboards/:slug/settings} request body (§9,
	 * US-125/126/127) - carries {@code line_items} only, never {@code display}, so a plan save can
	 * never accidentally touch the widget/layout configuration §6's display save owns.
	 *
	 * @param line_items the whole line-item set to persist
	 */
	private record PlanSettingsRequest(List<LineItemPlanUpdateRequest> line_items) {
	}

	/**
	 * One delegation as Pacing's {@code GET /api/delegations} returns it - {@code SELECT d.*} plus the
	 * joined names, so the field names are the column names.
	 *
	 * @param delegation_id     the grant's id
	 * @param delegator_id      who gave the access
	 * @param delegator_name    their name
	 * @param delegator_email   their email
	 * @param delegate_id       who received it
	 * @param delegate_name     their name
	 * @param delegate_email    their email
	 * @param starts_at         when the grant opens
	 * @param expires_at        when it closes
	 * @param reason            free text, or null
	 * @param pacing_id         the scoped pacing, or null for everything the delegator owns
	 * @param scope_pacing_name that pacing's name
	 * @param scope_dash_slug   that pacing's slug
	 * @param pacing_count      how many pacings the delegator owns
	 */
	@com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
	private record DelegationRow(
			String delegation_id,
			String delegator_id,
			String delegator_name,
			String delegator_email,
			String delegate_id,
			String delegate_name,
			String delegate_email,
			String starts_at,
			String expires_at,
			String reason,
			String pacing_id,
			String scope_pacing_name,
			String scope_dash_slug,
			Integer pacing_count) {
	}

	/**
	 * The {@code GET /api/delegations} envelope.
	 *
	 * @param delegations the rows
	 */
	@com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
	private record DelegationListResponse(List<DelegationRow> delegations) {
	}

	/**
	 * The {@code POST /api/delegations} body.
	 *
	 * <p>NON_NULL for {@link LineItemPlanUpdateRequest}'s reason: Pacing reads an ABSENT
	 * {@code starts_at} as "now" and an absent {@code pacing_ids} as "everything I own", and both of
	 * those are decisions - sending them as explicit nulls would have Pacing parse a null date and
	 * scope a grant to nothing.
	 *
	 * @param delegate_id who receives the access
	 * @param starts_at   date-only, or absent for now
	 * @param expires_at  date-only and inclusive
	 * @param reason      free text, or absent
	 * @param pacing_ids  the scoped pacings, or absent for everything the delegator owns
	 */
	@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
	private record DelegationCreateRequest(
			String delegate_id,
			String starts_at,
			String expires_at,
			String reason,
			List<String> pacing_ids) {
	}

	/**
	 * The {@code PATCH /api/delegations/:id} body - only the end date can move.
	 *
	 * @param expires_at the new end date, date-only and inclusive
	 */
	private record DelegationExtendRequest(String expires_at) {
	}

	/**
	 * Shape of the {@code data} object inside a data-settings save, under the snake_case names
	 * Pacing's {@code config.data} namespace stores.
	 *
	 * <p>NON_NULL, and load-bearing for the same reason {@link LineItemPlanUpdateRequest} carries it:
	 * Pacing's merge gates each key on {@code hasOwnProperty}, so a key present with an explicit null
	 * is an instruction to WRITE null, not an absent field. The Hub sends nulls for every setting its
	 * caller did not touch, so they have to be omitted rather than serialized - otherwise saving the
	 * BigQuery source alone would blank the pacing's fetch toggles and delete its dimension sources.
	 *
	 * @param source            the BigQuery table delivery is read from
	 * @param fetch_creatives   whether DSP creative assets are fetched with it
	 * @param fetch_conversions whether conversions are fetched with it
	 * @param dim_sources       the whole dimension-source list, opaque - forwarded byte-for-byte
	 */
	@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
	private record DataNamespaceRequest(
			String source,
			Boolean fetch_creatives,
			Boolean fetch_conversions,
			List<Map<String, Object>> dim_sources) {
	}

	/**
	 * Shape of the data-only {@code POST /api/dashboards/:slug/settings} request body - carries
	 * {@code data} only, never {@code display} or {@code line_items}, so a settings save can never
	 * accidentally touch the widget configuration or the plan.
	 *
	 * @param data the data namespace to merge into the stored one
	 */
	private record DataSettingsRequest(DataNamespaceRequest data) {
	}

	/**
	 * Shape of the {@code POST /api/pacings/validate} request body for the line-item-id selector (§9,
	 * US-126's add-by-id path) - the sibling of {@link ValidateRequest}'s {@code campaign_id} selector.
	 *
	 * @param line_item_ids the line item ids to look up
	 */
	private record LineItemsValidateRequest(List<String> line_item_ids) {
	}

	/**
	 * Shape of the {@code PATCH /api/pacings/:id/status} request body (§9, US-128).
	 *
	 * @param status {@code Live}, {@code Paused}, {@code Complete} or {@code Archive}
	 */
	private record StatusUpdateRequest(String status) {
	}

	/**
	 * Shape of the {@code PATCH /api/pacings/:id/owner} request body (§11, US-131). Snake_case on the
	 * wire: Pacing reads {@code body.new_owner_id}.
	 *
	 * @param new_owner_id the recipient's Pacing user id (UUID)
	 */
	private record OwnerTransferRequest(String new_owner_id) {
	}
}
