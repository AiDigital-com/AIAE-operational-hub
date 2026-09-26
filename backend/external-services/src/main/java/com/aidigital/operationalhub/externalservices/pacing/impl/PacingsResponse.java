package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingRow;

import java.util.List;

/**
 * Shape of Pacing's {@code GET /api/pacings} response body.
 *
 * @param pacings the visible pacings, each row as returned by Pacing
 */
record PacingsResponse(List<PacingRow> pacings) {
}
