package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingJournalEntry;

import java.util.List;

/**
 * Shape of the journal success response body, shared by the add, edit and delete
 * {@code /api/dashboards/:slug/journal[/:entryId]} endpoints (§15, US-139).
 *
 * @param journal the pacing's whole journal after the write
 */
record JournalResponse(List<PacingJournalEntry> journal) {
}
