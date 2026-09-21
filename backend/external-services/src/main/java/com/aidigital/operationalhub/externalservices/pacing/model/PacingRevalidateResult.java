package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.List;

/**
 * What a re-pull from the NetSuite master changed, as {@code POST /api/pacings/:pacingId/revalidate}
 * returns it. {@code changed == false} is a normal outcome, not a failure: the pacing already matched
 * the master and nothing was written.
 *
 * @param changed  whether anything was written back to the pacing's configuration
 * @param changes  the field names and line item ids that were updated ("client", "agency",
 *                 "campaigns", "currency", or a line item id); empty when {@code changed} is false
 * @param warnings non-fatal problems met during the re-pull; the changes above were still applied
 */
public record PacingRevalidateResult(boolean changed, List<String> changes, List<String> warnings) {
}
