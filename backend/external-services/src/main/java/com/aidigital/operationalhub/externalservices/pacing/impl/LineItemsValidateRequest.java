package com.aidigital.operationalhub.externalservices.pacing.impl;

import java.util.List;

/**
 * Shape of the {@code POST /api/pacings/validate} request body for the line-item-id selector (§9,
 * US-126's add-by-id path) - the sibling of {@link ValidateRequest}'s {@code campaign_id} selector.
 *
 * @param line_item_ids the line item ids to look up
 */
record LineItemsValidateRequest(List<String> line_item_ids) {
}
