package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.PacingLibraryApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryConflictReasonV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryConflictV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryCreateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryDeleteResultV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryDeleteV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryEntryV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryKindV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryListResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLibraryUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLikeResultV1;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingDashboardContractMapper;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibraryEntry;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibrarySaveOutcome;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLikeResult;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * REST controller for the {@code /api/v1/pacing/library/*} endpoints (§6 of the migration plan,
 * US-116/US-118).
 *
 * <p>Implements the OpenAPI-generated {@link PacingLibraryApi}. Contains no business logic: resolves
 * the current user, asks {@link PacingScopeResolver} for their Pacing entitlement exactly as
 * {@link PacingController} does, signs and sends it to Pacing via {@link PacingClient}, and maps the
 * result. A concurrent edit or a full library is a normal outcome the mapper turns into the matching
 * typed 409, never an exception and never silently overwritten.
 */
@RestController
@RequiredArgsConstructor
public class PacingLibraryController implements PacingLibraryApi {

	private final CurrentUserService currentUserService;
	private final PacingScopeResolver pacingScopeResolver;
	private final PacingClient pacingClient;
	private final PacingContractMapper assertionMapper;
	private final PacingDashboardContractMapper mapper;

	@Override
	public ResponseEntity<PacingLibraryListResponseV1> listPacingLibrary(
			String q, String sort, String shelf, PacingLibraryKindV1 kind) {
		HubAssertion assertion = signCurrentUser();
		List<PacingLibraryEntry> entries =
				pacingClient.listLibrary(assertion, q, sort, shelf, kind == null ? null : kind.getValue());
		return ResponseEntity.ok(mapper.toListV1(entries));
	}

	@Override
	public ResponseEntity<PacingLibraryEntryV1> createPacingLibraryEntry(PacingLibraryCreateV1 body) {
		HubAssertion assertion = signCurrentUser();
		PacingLibrarySaveOutcome outcome = pacingClient.createLibraryEntry(
				assertion, body.getKind().getValue(), body.getName(), body.getDescription(), body.getDefinition());
		if (!outcome.ok()) {
			return conflictResponse(outcome);
		}
		return ResponseEntity.status(HttpStatus.CREATED).body(mapper.toV1(outcome.entry()));
	}

	@Override
	public ResponseEntity<PacingLibraryEntryV1> updatePacingLibraryEntry(String id, PacingLibraryUpdateV1 body) {
		HubAssertion assertion = signCurrentUser();
		PacingLibrarySaveOutcome outcome = pacingClient.updateLibraryEntry(
				assertion, id, body.getName(), body.getDescription(), body.getDefinition(),
				body.getExpectedUpdatedAt());
		if (!outcome.ok()) {
			return conflictResponse(outcome);
		}
		return ResponseEntity.ok(mapper.toV1(outcome.entry()));
	}

	@Override
	public ResponseEntity<PacingLibraryDeleteResultV1> deletePacingLibraryEntry(String id, PacingLibraryDeleteV1 body) {
		HubAssertion assertion = signCurrentUser();
		PacingLibrarySaveOutcome outcome = pacingClient.deleteLibraryEntry(assertion, id, body.getExpectedUpdatedAt());
		if (!outcome.ok()) {
			return conflictResponse(outcome);
		}
		return ResponseEntity.ok(new PacingLibraryDeleteResultV1().id(outcome.deletedId()));
	}

	@Override
	public ResponseEntity<PacingLikeResultV1> likePacingLibraryEntry(String id) {
		return like(id, true);
	}

	@Override
	public ResponseEntity<PacingLikeResultV1> unlikePacingLibraryEntry(String id) {
		return like(id, false);
	}

	private ResponseEntity<PacingLikeResultV1> like(String id, boolean liked) {
		HubAssertion assertion = signCurrentUser();
		PacingLikeResult result = pacingClient.likeLibraryEntry(assertion, id, liked);
		return ResponseEntity.ok(new PacingLikeResultV1().liked(result.liked()).likes(result.likes()));
	}

	/**
	 * Builds the shared 409 conflict response for create/update/delete (US-118): the reason is always
	 * one of {@code stale_entry}/{@code library_full}/{@code v2_writer_required} here - every other
	 * non-2xx from {@link PacingClient} already throws and is handled by {@code GlobalExceptionHandler}
	 * before reaching this controller.
	 *
	 * @param outcome the rejected save outcome
	 * @param <T>     the caller's own generated success-body type, never actually returned here
	 * @return a 409 response carrying {@link PacingLibraryConflictV1}, cast to the caller's return type
	 */
	@SuppressWarnings("unchecked")
	private <T> ResponseEntity<T> conflictResponse(PacingLibrarySaveOutcome outcome) {
		PacingLibraryConflictV1 conflict = new PacingLibraryConflictV1()
				.reason(PacingLibraryConflictReasonV1.fromValue(outcome.conflictReason()))
				.currentUpdatedAt(outcome.currentUpdatedAt());
		return (ResponseEntity<T>) ResponseEntity.status(HttpStatus.CONFLICT).body(conflict);
	}

	private HubAssertion signCurrentUser() {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		return assertionMapper.toAssertion(user, entitlement);
	}
}
