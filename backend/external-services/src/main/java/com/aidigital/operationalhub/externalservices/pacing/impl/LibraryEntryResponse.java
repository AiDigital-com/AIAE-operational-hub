package com.aidigital.operationalhub.externalservices.pacing.impl;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingLibraryEntry;

/**
 * Shape of a library create/update success response.
 *
 * @param entry the saved entry
 */
record LibraryEntryResponse(PacingLibraryEntry entry) {
}
