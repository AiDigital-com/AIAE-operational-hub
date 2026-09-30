package com.aidigital.operationalhub.externalservices.pacing.impl;

/**
 * Shape of the {@code POST /api/pacings/validate} request body for the insertion-order selector -
 * the third sibling of {@link ValidateRequest}'s {@code campaign_id} selector and
 * {@link LineItemsValidateRequest}'s {@code line_item_ids} selector. Used by the standalone create
 * screen's insertion-order entry mode.
 *
 * @param insertion_order_id the NetSuite insertion-order number whose line items to look up
 */
record InsertionOrderValidateRequest(String insertion_order_id) {
}
