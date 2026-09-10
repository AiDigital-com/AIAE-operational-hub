package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.PacingListResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.PacingScopeV1;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * Bridges the service-layer {@link PacingEntitlement} (RBAC domain) and the Pacing HTTP client's
 * transport-level {@link HubAssertion} to the generated {@code /api/v1/pacing/pacings} contract.
 */
@Component
public class PacingContractMapper {

	/**
	 * Builds the transport-level assertion request the Pacing client signs and sends.
	 *
	 * @param user        the current user, for the asserted email
	 * @param entitlement the resolved Pacing entitlement
	 * @return the assertion to sign
	 */
	public HubAssertion toAssertion(CurrentUserModel user, PacingEntitlement entitlement) {
		PacingScope scope = entitlement.scope();
		return new HubAssertion(user.email(), scope.kind(), scope.ids(), entitlement.canCreate());
	}

	/**
	 * Builds the {@code GET /api/v1/pacing/pacings} response from the resolved entitlement and the rows
	 * Pacing returned.
	 *
	 * @param entitlement the resolved Pacing entitlement (surfaced back so a caller can see why)
	 * @param pacings     the pacings Pacing returned, passed through row-for-row
	 * @return the generated {@link PacingListResponseV1}
	 */
	public PacingListResponseV1 toV1(PacingEntitlement entitlement, List<Map<String, Object>> pacings) {
		return new PacingListResponseV1().scope(toScopeV1(entitlement)).pacings(pacings);
	}

	private PacingScopeV1 toScopeV1(PacingEntitlement entitlement) {
		PacingScope scope = entitlement.scope();
		return new PacingScopeV1()
				.kind(PacingScopeV1.KindEnum.fromValue(scope.kind()))
				.ids(scope.ids())
				.canCreate(entitlement.canCreate());
	}
}
