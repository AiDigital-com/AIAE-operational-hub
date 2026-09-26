package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibraryEntry;

import java.util.List;

/**
 * Shape of Pacing's {@code GET /api/library} response body.
 *
 * @param entries the matching library entries
 */
record LibraryListResponse(List<PacingLibraryEntry> entries) {
}
