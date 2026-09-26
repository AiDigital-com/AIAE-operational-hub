package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.PacingJournalApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingJournalEntryWriteV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingJournalListV1;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingDashboardContractMapper;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingJournalEntry;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * REST controller for the {@code /api/v1/pacing/dashboards/{slug}/journal[/{entryId}]} endpoints (§15
 * of the migration plan, US-139).
 *
 * <p>Implements the OpenAPI-generated {@link PacingJournalApi}. Contains no business logic: resolves
 * the current user, asks {@link PacingScopeResolver} for their Pacing entitlement exactly as
 * {@link PacingDashboardController} does, signs and sends the write to Pacing via {@link PacingClient},
 * and maps the whole fresh journal Pacing returns - author-or-admin editing and the permissive
 * anyone-may-delete rule are both enforced on the Pacing side, never repeated here.
 */
@RestController
@RequiredArgsConstructor
public class PacingJournalController implements PacingJournalApi {

	private final CurrentUserService currentUserService;
	private final PacingScopeResolver pacingScopeResolver;
	private final PacingClient pacingClient;
	private final PacingContractMapper assertionMapper;
	private final PacingDashboardContractMapper mapper;
	private final HubUserService hubUserService;

	@Override
	public ResponseEntity<PacingJournalListV1> addPacingJournalEntry(String slug, PacingJournalEntryWriteV1 body) {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		HubAssertion assertion = assertionMapper.toAssertion(user, entitlement);
		List<PacingJournalEntry> journal =
				pacingClient.addJournalEntry(assertion, slug, body.getMessage(), formatDate(body));
		return ResponseEntity.ok(toListV1(journal, user, entitlement));
	}

	@Override
	public ResponseEntity<PacingJournalListV1> updatePacingJournalEntry(
			String slug, String entryId, PacingJournalEntryWriteV1 body) {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		HubAssertion assertion = assertionMapper.toAssertion(user, entitlement);
		List<PacingJournalEntry> journal =
				pacingClient.updateJournalEntry(assertion, slug, entryId, body.getMessage(), formatDate(body));
		return ResponseEntity.ok(toListV1(journal, user, entitlement));
	}

	@Override
	public ResponseEntity<PacingJournalListV1> deletePacingJournalEntry(String slug, String entryId) {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		HubAssertion assertion = assertionMapper.toAssertion(user, entitlement);
		List<PacingJournalEntry> journal = pacingClient.deleteJournalEntry(assertion, slug, entryId);
		return ResponseEntity.ok(toListV1(journal, user, entitlement));
	}

	/**
	 * Reads a write request's {@code date} back to Pacing's plain {@code YYYY-MM-DD} wire format; null
	 * stays null.
	 *
	 * @param body the write request
	 * @return the formatted date, or null
	 */
	String formatDate(PacingJournalEntryWriteV1 body) {
		return body.getDate() == null ? null : body.getDate().toString();
	}

	/**
	 * Maps Pacing's fresh journal onto the generated response, computing each entry's {@code canEdit}
	 * from the caller's own identity - the same computation {@link PacingDashboardController} applies to
	 * the dashboard's embedded journal, so a client sees one consistent answer regardless of which
	 * endpoint it came from.
	 *
	 * @param journal     the whole fresh journal Pacing returned
	 * @param user        the current user
	 * @param entitlement the current user's resolved Pacing entitlement
	 * @return the generated {@link PacingJournalListV1}
	 */
	PacingJournalListV1 toListV1(
			List<PacingJournalEntry> journal, CurrentUserModel user, PacingEntitlement entitlement) {
		String ownPacingUserId = resolveOwnPacingUserId(user);
		boolean unrestrictedScope = PacingScope.KIND_ALL.equals(entitlement.scope().kind());
		return new PacingJournalListV1().journal(mapper.toJournalV1(journal, ownPacingUserId, unrestrictedScope));
	}

	/**
	 * The current user's own Pacing {@code user_id} ({@code hub_users.pacing_user_id}), for the
	 * journal's {@code canEdit} computation - null when the §2 employee sync has not reached them yet.
	 *
	 * @param user the current user
	 * @return the Pacing user id, or null if unresolved
	 */
	String resolveOwnPacingUserId(CurrentUserModel user) {
		return hubUserService.findByClerkUserId(user.clerkUserId()).map(HubUser::getPacingUserId).orElse(null);
	}
}
