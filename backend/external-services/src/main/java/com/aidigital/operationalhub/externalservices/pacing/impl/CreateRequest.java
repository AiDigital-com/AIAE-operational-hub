package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.List;

/**
 * Shape of the {@code POST /api/pacings} request body (§8, US-123).
 *
 * @param pacing_name display name for the new pacing
 * @param line_items  the selected line items
 */
record CreateRequest(String pacing_name, List<LineItemCreateRequest> line_items) {
}
