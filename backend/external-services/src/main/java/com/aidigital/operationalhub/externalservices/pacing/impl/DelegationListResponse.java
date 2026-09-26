package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.List;

/**
 * The {@code GET /api/delegations} envelope.
 *
 * @param delegations the rows
 */
@com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
record DelegationListResponse(List<DelegationRow> delegations) {
}
