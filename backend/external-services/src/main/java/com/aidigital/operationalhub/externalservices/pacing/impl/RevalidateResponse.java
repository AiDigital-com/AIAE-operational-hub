package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.List;

/**
 * Shape of Pacing's {@code POST /api/pacings/:pacingId/revalidate} response body. Pacing also
 * returns {@code ok}; it carries no information beyond the 200 itself and is not read here.
 *
 * @param changed  whether anything was written back to the pacing's configuration
 * @param changes  the field names and line item ids that were updated
 * @param warnings non-fatal problems met during the re-pull
 */
record RevalidateResponse(boolean changed, List<String> changes, List<String> warnings) {
}
