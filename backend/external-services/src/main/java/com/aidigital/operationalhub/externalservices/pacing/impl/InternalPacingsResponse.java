package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingOwnerEntry;

import java.util.List;

/**
 * Shape of Pacing's {@code GET /api/internal/pacings} response body.
 *
 * @param pacings every pacing's id and owner
 */
record InternalPacingsResponse(List<PacingOwnerEntry> pacings) {
}
