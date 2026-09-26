package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Shape of the journal-write request body, shared by {@code POST /api/dashboards/:slug/journal}
 * (add) and {@code PATCH /api/dashboards/:slug/journal/:entryId} (edit) (§15, US-139).
 *
 * @param message the journal entry text
 * @param date    the entry date (YYYY-MM-DD)
 */
record JournalWriteRequest(String message, String date) {
}
