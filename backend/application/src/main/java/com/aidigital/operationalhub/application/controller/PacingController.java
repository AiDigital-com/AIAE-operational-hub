package com.aidigital.operationalhub.application.controller;

import com.aidigital.operationalhub.application.api.v1.generated.PacingApi;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCreateResultV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingCreateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingDraftV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingLineItemValidateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingListResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.AssignableOwnerListV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingOwnerUpdateV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingStatusUpdateV1;
import com.aidigital.operationalhub.application.mapper.PacingContractMapper;
import com.aidigital.operationalhub.application.mapper.PacingCreateContractMapper;
import com.aidigital.operationalhub.externalservices.pacing.PacingClient;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateLineItem;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateOptions;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateResult;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignRef;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingRow;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingValidateResult;
import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.pacinglinks.CampaignLinksValidator;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.rbac.CurrentUserService;
import com.aidigital.operationalhub.service.rbac.PacingScopeResolver;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.AssignableOwnerService;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * REST controller for {@code GET /api/v1/pacing/pacings}.
 *
 * <p>Implements the OpenAPI-generated {@link PacingApi}. Contains no business logic: resolves the
 * current user, asks {@link PacingScopeResolver} for their Pacing entitlement, signs and sends it to
 * Pacing via {@link PacingClient}, and returns the pacings alongside the entitlement that produced
 * them.
 */
@RestController
@RequiredArgsConstructor
public class PacingController implements PacingApi {

	private final CurrentUserService currentUserService;
	private final PacingScopeResolver pacingScopeResolver;
	private final PacingClient pacingClient;
	private final PacingContractMapper mapper;
	private final PacingCreateContractMapper createMapper;
	private final AssignableOwnerService assignableOwnerService;
	private final CampaignService campaignService;
	private final CampaignLinksValidator campaignLinksValidator;

	@Override
	public ResponseEntity<PacingListResponseV1> listPacings() {
		// Resolve user from authN:
		CurrentUserModel user = currentUserService.resolveCurrentUser();

		// Do resolve the Hub RBAC entitlement into a Pacing assertion, and fetch:
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		HubAssertion assertion = mapper.toAssertion(user, entitlement);
		List<PacingRow> pacings = pacingClient.listPacings(assertion);

		// Do map&response, with each row's campaigns enriched with their Hub-resolved agency/client
		// (what the Overview's agency filter runs on) - one bulk lookup for the whole list:
		return ResponseEntity.ok(mapper.toV1(entitlement, pacings, resolveCampaignsById(user, pacings)));
	}

	/**
	 * Resolves the Hub campaign identity (agency/client) of every campaign referenced across the
	 * given pacing rows, in ONE BigQuery round trip — never one per pacing. Pacing's campaign ids
	 * are NetSuite campaign ids, the same id space as the Hub's own campaigns.
	 *
	 * <p>Ids the campaign service does not answer for (unknown, non-numeric, or outside the caller's
	 * agency visibility — the service enforces that itself) are simply absent from the map; the
	 * mapper then leaves those campaign references unenriched rather than inventing an agency.
	 *
	 * @param user    the current user, whose agency visibility scopes the lookup
	 * @param pacings the pacing rows whose campaign references need resolving
	 * @return the visible campaigns by id; empty when no row references any campaign
	 */
	Map<Long, CampaignModel> resolveCampaignsById(CurrentUserModel user, List<PacingRow> pacings) {
		List<Long> campaignIds = pacings.stream()
				.flatMap(row -> row.campaigns() == null ? Stream.<PacingCampaignRef>empty() : row.campaigns().stream())
				.map(ref -> mapper.parseCampaignId(ref.id()))
				.filter(Objects::nonNull)
				.distinct()
				.toList();
		if (campaignIds.isEmpty()) {
			return Map.of();
		}
		return campaignService.getVisibleCampaignIdentities(user, campaignIds).stream()
				.filter(campaign -> campaign.id() != null)
				.collect(Collectors.toMap(CampaignModel::id, Function.identity(), (a, b) -> a));
	}

	/**
	 * §8 of the migration plan (US-123/124): creates a pacing from the caller's reviewed, selected
	 * line items plus the optional create-time extras (client/agency, pinned campaign order, data
	 * settings, rate override, links, notes). Near-zero business logic - Pacing is the one that
	 * enforces {@code canCreate} (carried on the signed assertion) and every other create rule; the
	 * one Hub-side check is {@link CampaignLinksValidator} over {@code campaignLinks}, because Pacing
	 * stores links verbatim while the Hub renders them clickable - the exact reasoning of the
	 * settings-save links path, applied to the same data arriving one screen earlier.
	 */
	@Override
	public ResponseEntity<PacingCreateResultV1> createPacing(PacingCreateV1 body) {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		HubAssertion assertion = mapper.toAssertion(user, entitlement);
		List<PacingCreateLineItem> lineItems =
				body.getLineItems().stream().map(createMapper::toCreateLineItem).toList();
		PacingCreateOptions options = createMapper.toCreateOptions(body);
		if (options.campaignLinks() != null) {
			campaignLinksValidator.validate(options.campaignLinks());
		}
		PacingCreateResult result =
				pacingClient.createPacing(assertion, body.getPacingName(), lineItems, options);
		return ResponseEntity.status(HttpStatus.CREATED).body(createMapper.toCreateResultV1(result));
	}

	/**
	 * Changes a pacing's administrative lifecycle status (§9 of the migration plan, US-128). No
	 * business logic here either - Pacing journals the change and fires its own Slack line; this only
	 * signs, forwards and maps the (bodiless) result.
	 */
	@Override
	public ResponseEntity<Void> updatePacingStatus(String pacingId, PacingStatusUpdateV1 body) {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		HubAssertion assertion = mapper.toAssertion(user, entitlement);
		pacingClient.updateStatus(assertion, pacingId, body.getStatus().getValue());
		// 204, not a bodiless 200 - see the endpoint's own note in openapi.yaml. A 200 with
		// `produces: application/json` and nothing in it is a response the browser client tries to
		// parse the moment a proxy drops its Content-Length.
		return ResponseEntity.noContent().build();
	}

	/**
	 * Reassigns a pacing to another person (§11 of the migration plan, US-131).
	 *
	 * <p>No logic here either: Pacing checks that both the pacing and the recipient sit inside the
	 * asserted scope, and journals who made the change. This signs and forwards.
	 */
	@Override
	public ResponseEntity<Void> transferPacingOwner(String pacingId, PacingOwnerUpdateV1 body) {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		HubAssertion assertion = mapper.toAssertion(user, entitlement);
		pacingClient.transferOwner(assertion, pacingId, body.getNewOwnerId());
		// 204 for {@link #updatePacingStatus}'s reason.
		return ResponseEntity.noContent().build();
	}

	/**
	 * Who the current user may hand a pacing to (§11, US-131).
	 *
	 * <p>Resolved from the same entitlement that filters the overview, so the picker and the list
	 * agree by construction rather than by two implementations staying in step.
	 */
	@Override
	public ResponseEntity<AssignableOwnerListV1> listAssignableOwners() {
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		return ResponseEntity.ok(mapper.toAssignableOwnerListV1(assignableOwnerService.resolveFor(entitlement)));
	}

	/**
	 * Looks up line items directly, by exactly one of two selectors - {@code lineItemIds} (§9 of the
	 * migration plan, US-126's add-by-id path) or {@code insertionOrderId} (the standalone create
	 * screen's insertion-order mode). The same validate endpoint {@link #createPacing}'s draft screen
	 * (§8) uses with a campaign selector, and therefore the exact same {@code canCreate} requirement.
	 * Both selectors present, or neither, is a 400 here before Pacing is called - the contract says
	 * exactly one, and guessing which one the caller meant is how a typo turns into a wrong lookup.
	 */
	@Override
	public ResponseEntity<PacingDraftV1> validatePacingLineItems(PacingLineItemValidateV1 body) {
		boolean hasIds = body.getLineItemIds() != null && !body.getLineItemIds().isEmpty();
		boolean hasOrder = body.getInsertionOrderId() != null && !body.getInsertionOrderId().isBlank();
		if (hasIds == hasOrder) {
			throw new BusinessException(OperationalHubErrorReason.OPH_065);
		}
		CurrentUserModel user = currentUserService.resolveCurrentUser();
		PacingEntitlement entitlement = pacingScopeResolver.resolveForCurrentUser(user);
		HubAssertion assertion = mapper.toAssertion(user, entitlement);
		PacingValidateResult result = hasIds
				? pacingClient.validateLineItems(assertion, body.getLineItemIds())
				: pacingClient.validateInsertionOrder(assertion, body.getInsertionOrderId().trim());
		return ResponseEntity.ok(createMapper.toDraftV1(result));
	}
}
