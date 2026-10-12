package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * The body of {@code POST /api/dashboards/:slug/sheet-probe}: the spreadsheet link as pasted.
 *
 * <p>Sent as the link rather than as an extracted id on purpose - Pacing owns the rule for what
 * shapes of Google URL are acceptable, and a second extractor here would be a copy that drifts.
 *
 * @param url the Google Sheets link
 */
public record SheetProbeRequest(String url) {
}
